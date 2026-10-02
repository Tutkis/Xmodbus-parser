/**
 * @fileoverview TCP header parser and per-flow reassembler.
 *
 * Design decision: one {@link TcpFlow} per direction. The key is
 * `"srcIp:srcPort->dstIp:dstPort"` (NOT sorted), so the master→slave and
 * slave→master streams appear as two separate flows. The UI can pair them
 * by reversing the key string. This keeps the reassembled byte stream of
 * each direction unambiguous, which matters for Modbus (requests vs
 * responses have different shapes).
 *
 * Reassembly algorithm:
 *   1. Sort segments by `(seq - baseSeq) mod 2^32`, where `baseSeq` is the
 *      SYN segment's sequence number (or, lacking a SYN, the smallest seq
 *      observed). This handles 32-bit wraparound.
 *   2. Walk segments in order, copying their payloads into a single output
 *      buffer. Overlaps (retransmissions) are deduped by taking the first
 *      occurrence of each byte — i.e. we only copy bytes that fall past the
 *      current write cursor.
 *   3. Gaps in the sequence (missing data) are skipped; the output stream is
 *      contiguous up to the last contiguous byte before the gap. A warning
 *      is recorded via the optional `warningsOut` parameter.
 *
 * The `srcIp`/`dstIp` arguments to {@link parseTcp} are stashed on the
 * returned segment as non-enumerable-looking underscore-prefixed fields
 * (`_srcIp`, `_srcPort`, `_dstIp`, `_dstPort`) so that
 * {@link groupAndReassembleFlows} can build flow keys without re-parsing
 * the IP header. These fields are typed via the {@link AddressedTcpSegment}
 * extension and are not part of the public {@link TcpSegment} interface.
 */

import { flowKey, u32Sub } from './util';
import type { TcpFlow, TcpSegment } from './types';

/** TCP flag bit masks (offset 13 of the TCP header). */
export const TCP_FLAG_FIN = 0x01;
export const TCP_FLAG_SYN = 0x02;
export const TCP_FLAG_RST = 0x04;
export const TCP_FLAG_PSH = 0x08;
export const TCP_FLAG_ACK = 0x10;
export const TCP_FLAG_URG = 0x20;
export const TCP_FLAG_ECE = 0x40;
export const TCP_FLAG_CWR = 0x80;

/** Minimum TCP header length (no options). */
const TCP_MIN_HEADER_LEN = 20;

/**
 * A {@link TcpSegment} extended with the L3 addressing that {@link parseTcp}
 * attaches. Used internally for flow grouping; callers can cast to this type
 * to read the addressing.
 */
export interface AddressedTcpSegment extends TcpSegment {
  /** Source IP (echoed from {@link parseTcp} input). */
  _srcIp: string;
  /** Destination IP (echoed from {@link parseTcp} input). */
  _dstIp: string;
  /** Source port (parsed from TCP header bytes 0-1). */
  _srcPort: number;
  /** Destination port (parsed from TCP header bytes 2-3). */
  _dstPort: number;
}

/**
 * Parse a TCP header.
 *
 * @param data Bytes starting at the TCP header.
 * @param srcIp Source IP (stashed on the returned segment as `_srcIp`).
 * @param dstIp Destination IP (stashed on the returned segment as `_dstIp`).
 * @param timestampMs Capture timestamp in milliseconds since Unix epoch. Defaults to 0.
 * @returns Parsed segment with a payload view into the input buffer. The
 *          returned object also carries `_srcIp`/`_dstIp`/`_srcPort`/`_dstPort`
 *          for flow grouping; cast to {@link AddressedTcpSegment} to read them.
 */
export function parseTcp(data: Uint8Array, srcIp: string, dstIp: string, timestampMs = 0): TcpSegment {
  if (data.length < TCP_MIN_HEADER_LEN) {
    throw new Error(`TCP header too short: ${data.length} bytes (need >= ${TCP_MIN_HEADER_LEN})`);
  }
  // All TCP header fields are big-endian (network byte order).
  const srcPort = (data[0] << 8) | data[1];
  const dstPort = (data[2] << 8) | data[3];
  const seq = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7];
  const ack = (data[8] << 24) | (data[9] << 16) | (data[10] << 8) | data[11];
  const dataOffset = (data[12] >> 4) * 4;
  const flags = data[13];

  if (dataOffset < TCP_MIN_HEADER_LEN) {
    throw new Error(`Invalid TCP data offset: ${dataOffset / 4} (need >= 5)`);
  }
  const payload = dataOffset <= data.length ? data.subarray(dataOffset) : new Uint8Array(0);

  const seg: AddressedTcpSegment = {
    timestamp: timestampMs,
    seq: seq >>> 0,
    ack: ack >>> 0,
    flags,
    payload,
    _srcIp: srcIp,
    _dstIp: dstIp,
    _srcPort: srcPort,
    _dstPort: dstPort,
  };
  // Return as the public TcpSegment type — the extra fields are accessible
  // via `as AddressedTcpSegment` cast.
  return seg;
}

/**
 * Reassemble an ordered byte stream from a list of TCP segments belonging to
 * a single direction.
 *
 * Sorts by sequence number (with wraparound handling), dedupes overlaps by
 * keeping the first occurrence of each byte, and returns a contiguous buffer.
 * Stops at the first gap (missing data) — anything past the gap is dropped,
 * and a warning is pushed to `warningsOut` if provided.
 *
 * @param segments Segments in arrival order. NOT mutated (sorts a copy).
 * @param warningsOut Optional array to receive warning strings.
 * @returns Reassembled contiguous application stream.
 */
export function reassembleTcpFlow(segments: TcpSegment[], warningsOut?: string[]): Uint8Array {
  if (segments.length === 0) {
    return new Uint8Array(0);
  }

  // Copy before sorting so we don't mutate the caller's array.
  const sorted = segments.slice();

  // Determine the base sequence number. Prefer a SYN segment's seq (the ISN).
  // Otherwise use the segment with the smallest modular distance from the
  // first segment.
  let baseSeq: number | null = null;
  for (const seg of sorted) {
    if ((seg.flags & TCP_FLAG_SYN) !== 0) {
      baseSeq = seg.seq;
      break;
    }
  }
  if (baseSeq === null) {
    baseSeq = sorted[0].seq;
    for (const seg of sorted) {
      const d = u32Sub(seg.seq, baseSeq);
      // Smallest unsigned distance from base; ignore wraparound edge cases
      // by treating values > 2^31 as "behind" base.
      if (d < 0x80000000 && d !== 0) {
        baseSeq = seg.seq;
      }
    }
  }

  // Sort by (seq - baseSeq) mod 2^32.
  const base = baseSeq as number;
  sorted.sort((a, b) => {
    const ra = u32Sub(a.seq, base);
    const rb = u32Sub(b.seq, base);
    if (ra < rb) return -1;
    if (ra > rb) return 1;
    return 0;
  });

  // First pass: compute the contiguous stream length and detect gaps.
  let nextByte = 0;
  let totalLen = 0;
  const placements: Array<{ seg: TcpSegment; copyFrom: number; copyLen: number; outOff: number }> = [];
  for (const seg of sorted) {
    if (seg.payload.length === 0) continue;
    const startRel = u32Sub(seg.seq, base);
    // SYN occupies seq=base (0 bytes of payload but conceptually 1 byte for
    // sequence accounting). For SYN-without-payload this loop skips via the
    // `length === 0` check above. For SYN-with-payload (TCP Fast Open) we'd
    // need to subtract 1 from startRel — left as a known v1 limitation.
    const endRel = startRel + seg.payload.length;

    if (startRel > nextByte) {
      // Gap detected. Stop contiguity here — we only reassemble the prefix
      // with no gaps. Record a warning and break.
      warningsOut?.push(
        `TCP gap: expected rel offset ${nextByte}, got ${startRel} (seq=${seg.seq}, ${startRel - nextByte} bytes missing)`,
      );
      break;
    }
    if (endRel <= nextByte) {
      // Fully overlapping retransmission — ignore.
      continue;
    }
    const usefulStart = nextByte - startRel;
    const usefulLen = endRel - nextByte;
    placements.push({ seg, copyFrom: usefulStart, copyLen: usefulLen, outOff: nextByte });
    nextByte = endRel;
    totalLen = nextByte;
  }

  // Second pass: copy useful bytes into the output buffer.
  const out = new Uint8Array(totalLen);
  for (const p of placements) {
    out.set(p.seg.payload.subarray(p.copyFrom, p.copyFrom + p.copyLen), p.outOff);
  }

  return out;
}

/**
 * Group addressed TCP segments into per-direction flows and reassemble each.
 *
 * @param segments Segments in arrival order. Each must carry the
 *                 `_srcIp`/`_srcPort`/`_dstIp`/`_dstPort` side-data attached
 *                 by {@link parseTcp}.
 * @param warningsOut Optional array to receive reassembly warnings.
 * @returns One {@link TcpFlow} per direction, in arrival order of first packet.
 */
export function groupAndReassembleFlows(segments: TcpSegment[], warningsOut?: string[]): TcpFlow[] {
  const flows = new Map<string, TcpFlow>();
  const orderedKeys: string[] = [];

  for (const seg of segments) {
    const s = seg as AddressedTcpSegment;
    const key = flowKey(s._srcIp, s._srcPort, s._dstIp, s._dstPort);
    let flow = flows.get(key);
    if (!flow) {
      flow = {
        flowKey: key,
        srcIp: s._srcIp,
        srcPort: s._srcPort,
        dstIp: s._dstIp,
        dstPort: s._dstPort,
        segments: [],
        reassembled: new Uint8Array(0),
      };
      flows.set(key, flow);
      orderedKeys.push(key);
    }
    flow.segments.push(seg);
  }

  const result: TcpFlow[] = [];
  for (const key of orderedKeys) {
    const flow = flows.get(key);
    if (!flow) continue;
    flow.reassembled = reassembleTcpFlow(flow.segments, warningsOut);
    result.push(flow);
  }
  return result;
}
