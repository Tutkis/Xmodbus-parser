/**
 * @fileoverview Classic libpcap (.pcap) file format parser.
 *
 * File layout:
 *
 * ```
 * +-------------------------+
 * |   Global header (24B)   |
 * +-------------------------+
 * |   Packet record 1       |  (16B header + incl_len bytes)
 * +-------------------------+
 * |   Packet record 2       |
 * +-------------------------+
 * |          ...            |
 * +-------------------------+
 * ```
 *
 * Endianness is determined by the magic number:
 *   - bytes `d4 c3 b2 a1` on disk → file is little-endian, microsecond resolution
 *   - bytes `a1 b2 c3 d4` on disk → file is big-endian, microsecond resolution
 *   - bytes `4d 3c b2 a1` on disk → file is little-endian, nanosecond resolution
 *   - bytes `a1 b2 3c 4d` on disk → file is big-endian, nanosecond resolution
 *
 * We read the first 4 bytes as a little-endian u32 and dispatch:
 *   - 0xa1b2c3d4 → LE, usec
 *   - 0xd4c3b2a1 → BE, usec
 *   - 0xa1b23c4d → LE, nsec
 *   - 0x4d3cb2a1 → BE, nsec
 */

import { Reader } from './util';
import { walkPackets } from './pipeline';
import type { ParsedPcap, PcapFileHeader, PcapPacket } from './types';

/** Canonical magic numbers (in host-readable form). */
const PCAP_MAGIC_USEC = 0xa1b2c3d4;
const PCAP_MAGIC_NSEC = 0xa1b23c4d;

/** Read first 4 bytes of `buf` as a little-endian u32. */
function sniffMagicLE(buf: ArrayBuffer): number {
  if (buf.byteLength < 4) {
    throw new Error(`Buffer too short to be a pcap file: ${buf.byteLength} bytes`);
  }
  return new DataView(buf, 0, 4).getUint32(0, true);
}

/**
 * Parse a classic libpcap (.pcap) file.
 *
 * @param buffer Raw file contents (an ArrayBuffer or ArrayBufferView backing).
 * @returns Parsed pcap with packets, TCP flows, and detected Modbus ports.
 * @throws if the magic is not a recognized libpcap magic number.
 */
export function parsePcap(buffer: ArrayBuffer): ParsedPcap {
  const warnings: string[] = [];

  const magicLE = sniffMagicLE(buffer);
  let littleEndian: boolean;
  let nsec: boolean;
  let canonicalMagic: number;

  switch (magicLE) {
    case PCAP_MAGIC_USEC:
      littleEndian = true;
      nsec = false;
      canonicalMagic = PCAP_MAGIC_USEC;
      break;
    case 0xd4c3b2a1: // bytes on disk were a1 b2 c3 d4 → BE
      littleEndian = false;
      nsec = false;
      canonicalMagic = PCAP_MAGIC_USEC;
      break;
    case PCAP_MAGIC_NSEC:
      littleEndian = true;
      nsec = true;
      canonicalMagic = PCAP_MAGIC_NSEC;
      break;
    case 0x4d3cb2a1: // bytes on disk were a1 b2 3c 4d → BE
      littleEndian = false;
      nsec = true;
      canonicalMagic = PCAP_MAGIC_NSEC;
      break;
    default:
      throw new Error(
        `Not a classic pcap file: unrecognized magic 0x${magicLE.toString(16).padStart(8, '0')} (read as LE)`,
      );
  }

  const reader = new Reader(buffer, littleEndian, 0, buffer.byteLength);
  // Consume the magic (already inspected).
  reader.skip(4);

  const versionMajor = reader.u16();
  const versionMinor = reader.u16();
  const thiszone = reader.i32();
  const sigfigs = reader.u32();
  const snaplen = reader.u32();
  const network = reader.u32();

  const fileHeader: PcapFileHeader = {
    magicNumber: canonicalMagic,
    versionMajor,
    versionMinor,
    thiszone,
    sigfigs,
    snaplen,
    network,
  };

  // Walk packet records. Each: ts_sec(4) ts_frac(4) incl_len(4) orig_len(4) data(incl_len).
  const packets: PcapPacket[] = [];
  let packetIndex = 0;
  while (reader.remaining() >= 16) {
    const tsSec = reader.u32();
    const tsFrac = reader.u32();
    const inclLen = reader.u32();
    const origLen = reader.u32();

    if (inclLen > reader.remaining()) {
      warnings.push(
        `pkt#${packetIndex}: truncated record (incl_len=${inclLen}, remaining=${reader.remaining()}); stopping`,
      );
      break;
    }
    if (inclLen > snaplen + 65535) {
      // Sanity check: snaplen is normally <= 65535, but be lenient. If inclLen
      // is implausibly large, the file is likely corrupt — bail.
      warnings.push(
        `pkt#${packetIndex}: implausible incl_len=${inclLen} (snaplen=${snaplen}); stopping`,
      );
      break;
    }

    const data = reader.bytes(inclLen);
    packets.push({
      timestampSeconds: tsSec,
      timestampMicroseconds: tsFrac, // usec OR nsec depending on magic — caller knows from fileHeader
      capturedLength: inclLen,
      originalLength: origLen,
      data,
    });
    packetIndex++;
    // pcap records are NOT padded to a boundary in classic format; reader is
    // already at the next record.
  }

  if (reader.remaining() > 0) {
    warnings.push(`${reader.remaining()} trailing bytes after last packet record (ignored)`);
  }

  // The `nsec` flag affects how callers interpret `timestampMicroseconds`
  // for the nsec-magic variant — we don't normalize here, preserving the raw
  // sub-second value (consistent with the spec's note that the field is
  // "usec or nsec for ng").
  void nsec;

  const walk = walkPackets(packets, () => network, warnings);

  return {
    format: 'pcap',
    fileHeader,
    packets,
    tcpFlows: walk.flows,
    detectedModbusPorts: walk.modbusPorts,
    warnings,
  };
}

/**
 * Returns true if `buffer` starts with a classic libpcap magic number.
 * Used by the index module's auto-detection.
 */
export function isPcap(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 4) return false;
  const m = sniffMagicLE(buffer);
  return (
    m === PCAP_MAGIC_USEC ||
    m === 0xd4c3b2a1 ||
    m === PCAP_MAGIC_NSEC ||
    m === 0x4d3cb2a1
  );
}
