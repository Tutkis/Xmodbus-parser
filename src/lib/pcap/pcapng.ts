/**
 * @fileoverview pcap-ng (.pcapng) file format parser.
 *
 * pcapng is a block-structured container. Every block has the shape:
 *
 * ```
 * +------------------------+
 * | Block Type        (4B) |
 * | Block Total Length (4B)|
 * | Body (variable)        |  ← length = Total Length - 12, padded to 4
 * | Block Total Length (4B)|  ← repeat (integrity check)
 * +------------------------+
 * ```
 *
 * The Section Header Block (SHB, type 0x0A0D0D0A) is always first and
 * contains a byte-order magic (0x1A2B3C4D) that fixes the endianness for the
 * rest of the section. We assume a single section per file (the common case)
 * and warn if multiple SHBs are encountered.
 *
 * Block types handled:
 *   - 0x0A0D0D0A  SHB  (Section Header)
 *   - 0x00000001  IDB  (Interface Description — supplies DLT + snaplen + if_tsresol)
 *   - 0x00000006  EPB  (Enhanced Packet — modern, with interface_id)
 *   - 0x00000003  SPB  (Simple Packet — no iface_id, no timestamp)
 *   - 0x00000005  ISB  (Interface Statistics — skipped)
 *   - 0x00000004  NRB  (Name Resolution — skipped)
 *   - 0x00000002  PB   (obsolete Packet Block — handled like EPB without iface_id)
 *   - others      skipped safely
 */

import { Reader, align4 } from './util';
import { walkPackets } from './pipeline';
import type { ParsedPcap, PcapPacket } from './types';

/** pcapng block type codes. */
const BT_SHB = 0x0a0d0d0a;
const BT_IDB = 0x00000001;
const BT_PB = 0x00000002; // obsolete "Packet Block"
const BT_SPB = 0x00000003;
const BT_NRB = 0x00000004;
const BT_ISB = 0x00000005;
const BT_EPB = 0x00000006;

/** Byte-order magic inside the SHB body. */
const BYTE_ORDER_MAGIC = 0x1a2b3c4d;

/** IDB option code for interface timestamp resolution. */
const OPT_IF_TSRESOL = 9;
/** IDB option end-of-list marker. */
const OPT_EOFO = 0;

/** Default timestamp resolution: 10^-6 sec (microseconds). */
const DEFAULT_TSRESOL_EXP = 6;

/** Read first 4 bytes of `buf` as a little-endian u32. */
function sniffU32LE(buffer: ArrayBuffer, offset: number): number {
  return new DataView(buffer, offset, 4).getUint32(0, true);
}

/**
 * Convert an if_tsresol option byte to "units per second".
 *
 * Bit 7 selects the base (0 → powers of 10, 1 → powers of 2); the low 4 bits
 * are the exponent. For example, `0x06` → 10^6 = 1,000,000 (microseconds),
 * `0x09` → 10^9 (nanoseconds).
 */
function tsResolToUnitsPerSec(resolByte: number): number {
  const base = (resolByte & 0x80) !== 0 ? 2 : 10;
  const exp = resolByte & 0x0f;
  return Math.pow(base, exp);
}

/** Per-interface state carried across blocks within a section. */
interface InterfaceState {
  /** Link-layer type (DLT_*). */
  linkType: number;
  /** Snaplen. */
  snaplen: number;
  /** Timestamp units per second (e.g. 1e6 for usec). */
  unitsPerSec: number;
}

/**
 * Parse a pcap-ng (.pcapng) file.
 *
 * @param buffer Raw file contents.
 * @returns Parsed pcap with packets, TCP flows, and detected Modbus ports.
 * @throws if the file doesn't start with an SHB or the byte-order magic is bad.
 */
export function parsePcapng(buffer: ArrayBuffer): ParsedPcap {
  const warnings: string[] = [];

  // ----- 1. Sniff endianness from the first SHB's byte-order magic -----
  // The first 4 bytes are the SHB block type 0x0A0D0D0A — palindromic, so we
  // can safely read them as either endian. The next 4 bytes are the block
  // total length; bytes 8-11 are the byte-order magic.
  if (buffer.byteLength < 12) {
    throw new Error(`Buffer too short to be a pcapng file: ${buffer.byteLength} bytes`);
  }
  const firstTypeLE = sniffU32LE(buffer, 0);
  if (firstTypeLE !== BT_SHB) {
    // SHB type is symmetric, so it reads the same in either endianness. If it
    // doesn't match, this isn't pcapng.
    throw new Error(
      `Not a pcapng file: first block type 0x${firstTypeLE.toString(16).padStart(8, '0')} != 0x0a0d0d0a`,
    );
  }

  const bomLE = sniffU32LE(buffer, 8);
  let littleEndian: boolean;
  if (bomLE === BYTE_ORDER_MAGIC) {
    littleEndian = true;
  } else if (bomLE === 0x4d3c2b1a) {
    // Read as LE we get the byte-swapped value → file is BE.
    littleEndian = false;
  } else {
    throw new Error(`Invalid pcapng byte-order magic: 0x${bomLE.toString(16).padStart(8, '0')}`);
  }

  // ----- 2. Walk blocks -----
  const reader = new Reader(buffer, littleEndian, 0, buffer.byteLength);
  const interfaces: InterfaceState[] = [];
  const packets: PcapPacket[] = [];
  let shbCount = 0;

  while (reader.remaining() >= 12) {
    const blockStart = reader.pos;
    const blockType = reader.u32();
    const blockTotalLen = reader.u32();

    if (blockTotalLen < 12 || blockTotalLen > reader.remaining() + 8) {
      warnings.push(
        `Bad block at offset ${blockStart}: type=0x${blockType.toString(16)} totalLen=${blockTotalLen}; stopping`,
      );
      break;
    }

    // Body = totalLen - 12 bytes (8 for header, 4 for trailing length repeat).
    const bodyLen = blockTotalLen - 12;
    if (bodyLen > reader.remaining() - 4) {
      warnings.push(`Block body truncated at offset ${blockStart}; stopping`);
      break;
    }
    const bodyStart = reader.pos;
    // We use a sub-reader for each body so per-block parsers can't run past
    // the trailing length field.
    const body = new Reader(buffer, littleEndian, bodyStart, bodyLen);

    switch (blockType) {
      case BT_SHB:
        shbCount++;
        if (shbCount > 1) {
          warnings.push('Multiple Section Header Blocks found; only the first section is honored');
        }
        // Body: BOM(4) major(2) minor(2) section_len(8) options...
        // We already sniffed the BOM; skip the rest.
        // No state to extract for v1 (version is informational only).
        break;

      case BT_IDB: {
        // Body: linktype(2) reserved(2) snaplen(4) options...
        const linkType = body.u16();
        body.skip(2); // reserved
        const snaplen = body.u32();
        // Parse options to find if_tsresol (code 9). Default = usec.
        let unitsPerSec = Math.pow(10, DEFAULT_TSRESOL_EXP);
        parseOptions(body, (code, value) => {
          if (code === OPT_IF_TSRESOL && value.length >= 1) {
            unitsPerSec = tsResolToUnitsPerSec(value[0]);
          }
        });
        interfaces.push({ linkType, snaplen, unitsPerSec });
        break;
      }

      case BT_EPB: {
        // Body: iface_id(4) ts_high(4) ts_low(4) cap_len(4) orig_len(4) data(pad4) options
        const ifaceId = body.u32();
        const tsHigh = body.u32();
        const tsLow = body.u32();
        const capLen = body.u32();
        const origLen = body.u32();

        const iface = interfaces[ifaceId];
        if (!iface) {
          warnings.push(`EPB references unknown interface_id=${ifaceId}; skipping packet`);
          break;
        }
        if (capLen > body.remaining()) {
          warnings.push(`EPB cap_len=${capLen} exceeds body remaining=${body.remaining()}; skipping`);
          break;
        }
        const data = body.bytes(capLen);
        // Body data is padded to 4 bytes; skip the padding before options.
        const padded = align4(capLen);
        if (padded > capLen) body.skip(padded - capLen);

        const { seconds, frac } = splitTimestamp(tsHigh, tsLow, iface.unitsPerSec);
        packets.push({
          timestampSeconds: seconds,
          timestampMicroseconds: frac,
          capturedLength: capLen,
          originalLength: origLen,
          data,
        });
        break;
      }

      case BT_PB: {
        // Obsolete Packet Block. Body: iface_id(2) drops(1) packet-type(1) ts_high(4) ts_low(4) cap_len(4) orig_len(4) data(pad4) options
        const ifaceId = body.u16();
        body.skip(2); // drops + packet-type
        const tsHigh = body.u32();
        const tsLow = body.u32();
        const capLen = body.u32();
        const origLen = body.u32();
        const iface = interfaces[ifaceId];
        if (!iface) {
          warnings.push(`PB references unknown interface_id=${ifaceId}; skipping packet`);
          break;
        }
        if (capLen > body.remaining()) {
          warnings.push(`PB cap_len=${capLen} exceeds body remaining=${body.remaining()}; skipping`);
          break;
        }
        const data = body.bytes(capLen);
        const padded = align4(capLen);
        if (padded > capLen) body.skip(padded - capLen);
        const { seconds, frac } = splitTimestamp(tsHigh, tsLow, iface.unitsPerSec);
        packets.push({
          timestampSeconds: seconds,
          timestampMicroseconds: frac,
          capturedLength: capLen,
          originalLength: origLen,
          data,
        });
        break;
      }

      case BT_SPB: {
        // Simple Packet Block. Body: orig_len(4) data(pad4)
        const origLen = body.u32();
        const capLen = Math.min(body.remaining(), origLen);
        const data = body.bytes(capLen);
        // SPB has no interface_id; use interface 0 if present.
        const iface = interfaces[0];
        const unitsPerSec = iface?.unitsPerSec ?? Math.pow(10, DEFAULT_TSRESOL_EXP);
        const { seconds, frac } = splitTimestamp(0, 0, unitsPerSec);
        packets.push({
          timestampSeconds: seconds,
          timestampMicroseconds: frac,
          capturedLength: capLen,
          originalLength: origLen,
          data,
        });
        break;
      }

      case BT_NRB:
      case BT_ISB:
        // Skipped — no per-packet data we need.
        break;

      default:
        // Unknown block — skip silently. The block total length tells us how
        // far to advance; we already read it.
        break;
    }

    // Advance past body + options + trailing 4-byte length repeat.
    // bodyLen was totalLen - 12; we need to skip the remaining body bytes
    // (body parser may not have consumed them all) + 4 trailing bytes.
    const consumedInBody = reader.pos - bodyStart;
    const remainingInBody = bodyLen - consumedInBody;
    if (remainingInBody > 0) reader.skip(remainingInBody);
    reader.skip(4); // trailing block total length repeat
  }

  if (reader.remaining() > 0) {
    warnings.push(`${reader.remaining()} trailing bytes after last block (ignored)`);
  }

  if (interfaces.length === 0 && packets.length > 0) {
    warnings.push('No IDB seen before packet blocks; assuming DLT_EN10MB for all packets');
  }

  // Walk packets through the L2→L3→L4→Modbus pipeline.
  const defaultLinkType = interfaces[0]?.linkType ?? 1; // DLT_EN10MB fallback
  const walk = walkPackets(
    packets,
    (i) => {
      // For EPB/PB we attached the right iface's linkType implicitly via
      // decodeLinkLayer — but we don't store per-packet iface here. For v1,
      // use interface 0's link type (the common single-interface case).
      void i;
      return defaultLinkType;
    },
    warnings,
  );

  return {
    format: 'pcapng',
    packets,
    tcpFlows: walk.flows,
    detectedModbusPorts: walk.modbusPorts,
    warnings,
  };
}

/**
 * Convert a (tsHigh, tsLow) pcapng timestamp to (seconds, frac) using the
 * interface's `unitsPerSec`. `frac` is the sub-second part in the SAME units
 * as the file's native resolution (usec or nsec) — preserved as-is so the
 * caller can decide how to display it.
 */
function splitTimestamp(tsHigh: number, tsLow: number, unitsPerSec: number): {
  seconds: number;
  frac: number;
} {
  // Combine high*2^32 + low. Use BigInt to avoid 53-bit precision loss at
  // large epoch values (tsLow is u32; tsHigh*u32 may exceed 2^53).
  const ts64 = BigInt(tsHigh) * BigInt(0x100000000) + BigInt(tsLow >>> 0);
  const unitsPerSecBig = BigInt(Math.trunc(unitsPerSec));
  const seconds = Number(ts64 / unitsPerSecBig);
  const frac = Number(ts64 % unitsPerSecBig);
  return { seconds, frac };
}

/**
 * Walk an options list inside a block body, calling `cb` for each option.
 * Options layout: code(2B) length(2B) value(length B, padded to 4). The list
 * ends at code 0 (end-of-options) or when the body is exhausted.
 */
function parseOptions(
  body: Reader,
  cb: (code: number, value: Uint8Array) => void,
): void {
  while (body.remaining() >= 4) {
    const code = body.u16();
    const len = body.u16();
    if (code === OPT_EOFO) break;
    if (len > body.remaining()) break;
    const value = body.bytes(len);
    const padded = align4(len);
    if (padded > len && body.remaining() >= padded - len) {
      body.skip(padded - len);
    }
    cb(code, value);
  }
}

/**
 * Returns true if `buffer` looks like a pcapng file (first block is SHB).
 * Used by the index module's auto-detection.
 */
export function isPcapng(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 4) return false;
  // SHB type 0x0A0D0D0A is palindromic — same in either endianness.
  return sniffU32LE(buffer, 0) === BT_SHB;
}
