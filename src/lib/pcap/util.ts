/**
 * @fileoverview Low-level byte readers and formatting helpers used across the
 * pcap/pcapng parser. All readers operate on a {@link DataView} for safe,
 * portable byte access, and never allocate intermediate strings.
 */

/**
 * Read an unsigned 16-bit little-endian integer at `offset`.
 */
export function readU16LE(dv: DataView, offset: number): number {
  return dv.getUint16(offset, true);
}

/**
 * Read an unsigned 16-bit big-endian integer at `offset`.
 */
export function readU16BE(dv: DataView, offset: number): number {
  return dv.getUint16(offset, false);
}

/**
 * Read an unsigned 32-bit little-endian integer at `offset`.
 */
export function readU32LE(dv: DataView, offset: number): number {
  return dv.getUint32(offset, true);
}

/**
 * Read an unsigned 32-bit big-endian integer at `offset`.
 */
export function readU32BE(dv: DataView, offset: number): number {
  return dv.getUint32(offset, false);
}

/**
 * Read a signed 32-bit little-endian integer at `offset`.
 */
export function readI32LE(dv: DataView, offset: number): number {
  return dv.getInt32(offset, true);
}

/**
 * Read an unsigned 64-bit little-endian integer at `offset` as a `bigint`.
 *
 * Using `bigint` avoids the precision loss that would occur when stuffing
 * a full u64 into a JS `number`. Callers that know the value fits in 53 bits
 * can coerce with `Number(...)`.
 */
export function readU64LE(dv: DataView, offset: number): bigint {
  return dv.getBigUint64(offset, true);
}

/**
 * Read an unsigned 64-bit big-endian integer at `offset` as a `bigint`.
 */
export function readU64BE(dv: DataView, offset: number): bigint {
  return dv.getBigUint64(offset, false);
}

/**
 * Endian-aware reader with a moving cursor. Used to walk structured headers
 * without juggling offset variables everywhere.
 */
export class Reader {
  readonly dv: DataView;
  readonly littleEndian: boolean;
  /** Current read position. */
  pos: number;

  constructor(buffer: ArrayBuffer | Uint8Array, littleEndian: boolean, byteOffset = 0, byteLength?: number) {
    if (buffer instanceof Uint8Array) {
      this.dv = new DataView(buffer.buffer, buffer.byteOffset + byteOffset, byteLength ?? buffer.byteLength - byteOffset);
    } else {
      this.dv = new DataView(buffer, byteOffset, byteLength ?? buffer.byteLength - byteOffset);
    }
    this.littleEndian = littleEndian;
    this.pos = 0;
  }

  /** Remaining bytes from the cursor. */
  remaining(): number {
    return this.dv.byteLength - this.pos;
  }

  /** Whether `n` more bytes can be read. */
  has(n: number): boolean {
    return this.pos + n <= this.dv.byteLength;
  }

  u16(): number {
    const v = this.dv.getUint16(this.pos, this.littleEndian);
    this.pos += 2;
    return v;
  }

  u32(): number {
    const v = this.dv.getUint32(this.pos, this.littleEndian);
    this.pos += 4;
    return v;
  }

  i32(): number {
    const v = this.dv.getInt32(this.pos, this.littleEndian);
    this.pos += 4;
    return v;
  }

  u64(): bigint {
    const v = this.dv.getBigUint64(this.pos, this.littleEndian);
    this.pos += 8;
    return v;
  }

  /** Raw byte at cursor. */
  u8(): number {
    const v = this.dv.getUint8(this.pos);
    this.pos += 1;
    return v;
  }

  /** Advance cursor by `n` bytes. */
  skip(n: number): void {
    this.pos += n;
  }

  /** Slice a view of `n` bytes starting at the cursor; advances cursor. */
  bytes(n: number): Uint8Array {
    const slice = new Uint8Array(this.dv.buffer, this.dv.byteOffset + this.pos, n);
    this.pos += n;
    return slice;
  }
}

/**
 * Format 6 MAC bytes as `aa:bb:cc:dd:ee:ff` (lowercase hex).
 */
export function formatMac(bytes: Uint8Array, offset = 0): string {
  const out: string[] = [];
  for (let i = 0; i < 6; i++) {
    out.push(bytes[offset + i].toString(16).padStart(2, '0'));
  }
  return out.join(':');
}

/**
 * Format 4 bytes as a dotted-quad IPv4 string.
 */
export function formatIpv4(bytes: Uint8Array, offset = 0): string {
  return `${bytes[offset]}.${bytes[offset + 1]}.${bytes[offset + 2]}.${bytes[offset + 3]}`;
}

/**
 * Format 16 bytes as a canonical (RFC 5952) IPv6 string with `::` compression.
 */
export function formatIpv6(bytes: Uint8Array, offset = 0): string {
  const groups: number[] = [];
  for (let i = 0; i < 16; i += 2) {
    groups.push((bytes[offset + i] << 8) | bytes[offset + i + 1]);
  }
  // Find longest run of zero groups (length >= 2) to compress.
  let bestStart = -1;
  let bestLen = 0;
  let runStart = -1;
  let runLen = 0;
  for (let i = 0; i < groups.length; i++) {
    if (groups[i] === 0) {
      if (runStart === -1) {
        runStart = i;
        runLen = 1;
      } else {
        runLen++;
      }
      if (runLen > bestLen) {
        bestLen = runLen;
        bestStart = runStart;
      }
    } else {
      runStart = -1;
      runLen = 0;
    }
  }
  if (bestLen < 2) {
    return groups.map((g) => g.toString(16)).join(':');
  }
  const before = groups.slice(0, bestStart).map((g) => g.toString(16));
  const after = groups.slice(bestStart + bestLen).map((g) => g.toString(16));
  return `${before.join(':')}::${after.join(':')}`;
}

/**
 * Round `n` up to the next multiple of `align`. Returns `n` unchanged if
 * already aligned.
 */
export function align4(n: number): number {
  return (n + 3) & ~3;
}

/**
 * Build a direction-aware TCP flow key. NOT sorted — A→B and B→A produce
 * different keys, by design.
 */
export function flowKey(srcIp: string, srcPort: number, dstIp: string, dstPort: number): string {
  return `${srcIp}:${srcPort}->${dstIp}:${dstPort}`;
}

/**
 * Reverse a flow key (swap src and dst). Returns null if the input doesn't
 * match the `a:b->c:d` shape.
 */
export function reverseFlowKey(key: string): string | null {
  const m = key.match(/^(.+):(\d+)->(.+):(\d+)$/);
  if (!m) return null;
  return `${m[3]}:${m[4]}->${m[1]}:${m[2]}`;
}

/** Mask the low 32 bits of a number (used for TCP seq arithmetic). */
export const U32_MASK = 0xffffffff;

/**
 * Unsigned 32-bit subtraction (`a - b`) mod 2^32. Used for sequence-number
 * relative ordering with wraparound handling.
 */
export function u32Sub(a: number, b: number): number {
  return (a - b) >>> 0;
}
