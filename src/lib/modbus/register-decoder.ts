/**
 * @file Register value decoder.
 *
 * Converts raw register bytes (2, 4, or 8 bytes — typically one or more
 * consecutive holding / input registers) into a typed value, applying the
 * chosen {@link ByteOrder} convention.
 *
 * All four byte orders are supported for 32- and 64-bit values:
 *
 * | Order | Permutation (input → output indices) | Description              |
 * |-------|--------------------------------------|--------------------------|
 * | ABCD  | 0,1,2,3                              | big-endian (Modbus spec) |
 * | DCBA  | 3,2,1,0                              | little-endian            |
 * | BADC  | 1,0,3,2                              | byte-swap within register|
 * | CDAB  | 2,3,0,1                              | register-swap            |
 *
 * For 16-bit values the permutations reduce to: ABCD ≡ CDAB (big-endian),
 * DCBA ≡ BADC (little-endian). For 64-bit values the patterns extend
 * naturally across the four registers (see {@link applyByteOrder}).
 */

import type { ByteOrder, DataType } from './types';

/* ------------------------------------------------------------------ */
/* Byte order permutation                                             */
/* ------------------------------------------------------------------ */

/**
 * Apply a {@link ByteOrder} permutation to `bytes` and return a new array.
 *
 * Works for any byte count that is a multiple of 2; the permutation is
 * tiled across register pairs. For a single 16-bit register the result is
 * either the identity (`ABCD`/`CDAB`) or a byte swap (`DCBA`/`BADC`).
 *
 * @param bytes - Raw bytes (length must be ≥ 2 and even).
 * @param order - Byte order convention.
 * @returns Permuted bytes (new array).
 */
export function applyByteOrder(bytes: number[], order: ByteOrder): number[] {
  const n = bytes.length;
  if (n < 2) return bytes.slice();
  const out = new Array<number>(n);

  // Permutation table for a 4-byte (2-register) unit, indexed by byte order.
  // For 16-bit we use only the first two entries; for 64-bit we tile across
  // 4 registers (8 bytes).
  const perm: Record<ByteOrder, number[]> = {
    ABCD: [0, 1, 2, 3],
    DCBA: [3, 2, 1, 0],
    BADC: [1, 0, 3, 2],
    CDAB: [2, 3, 0, 1],
  };
  const p = perm[order];

  // Process the input register-pair by register-pair (4 bytes at a time).
  // Any trailing 2-byte single register is handled as a special case.
  let base = 0;
  while (base < n) {
    if (base + 4 <= n) {
      // Full 4-byte (2-register) window.
      out[base + 0] = bytes[base + p[0]];
      out[base + 1] = bytes[base + p[1]];
      out[base + 2] = bytes[base + p[2]];
      out[base + 3] = bytes[base + p[3]];
      base += 4;
    } else if (base + 2 <= n) {
      // 2-byte (1-register) window: ABCD/CDAB → identity; DCBA/BADC → swap.
      const swap = order === 'DCBA' || order === 'BADC';
      out[base + 0] = swap ? bytes[base + 1] : bytes[base + 0];
      out[base + 1] = swap ? bytes[base + 0] : bytes[base + 1];
      base += 2;
    } else {
      // Single leftover byte (only possible if input was odd length).
      out[base] = bytes[base];
      base += 1;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Bit interpretation                                                 */
/* ------------------------------------------------------------------ */

/**
 * Options for bit decoding.
 */
export interface BitOptions {
  /**
   * If `true` (default), bit 0 of the first byte is the LSB of the register
   * (i.e. bits returned MSB-first within each register: bit15 … bit0).
   *
   * If `false`, bits are returned LSB-first (bit0 … bit15).
   */
  msbFirst?: boolean;
}

/**
 * Decode a sequence of bytes into an array of booleans (one per bit).
 *
 * Each register (2 bytes) produces 16 booleans. The default `msbFirst=true`
 * returns the high bit of the first byte as `bits[0]`, matching the most
 * common Modbus coil-display convention (bit 0 = MSB of register).
 */
export function decodeBits(
  bytes: number[],
  opts: BitOptions = {},
): boolean[] {
  const msbFirst = opts.msbFirst !== false;
  const bits: boolean[] = new Array(bytes.length * 8);
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] & 0xff;
    for (let bit = 0; bit < 8; bit++) {
      const idx = msbFirst ? i * 8 + bit : i * 8 + (7 - bit);
      // msbFirst: bit 0 = MSB (0x80); lsbFirst: bit 0 = LSB (0x01).
      const mask = msbFirst ? 0x80 >>> bit : 1 << bit;
      bits[idx] = (b & mask) !== 0;
    }
  }
  return bits;
}

/* ------------------------------------------------------------------ */
/* ASCII interpretation                                               */
/* ------------------------------------------------------------------ */

/**
 * Decode bytes as ASCII text. Non-printable bytes (outside 0x20–0x7E) are
 * replaced with `.` for display. Trailing NULs are stripped.
 */
export function decodeAscii(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] & 0xff;
    if (b >= 0x20 && b <= 0x7e) {
      out += String.fromCharCode(b);
    } else if (b === 0x00) {
      // stop at first NUL
      break;
    } else {
      out += '.';
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Core decoder                                                       */
/* ------------------------------------------------------------------ */

/**
 * Decode a sequence of register bytes into a typed value.
 *
 * @param bytes     - Raw bytes (length typically 2, 4, or 8).
 * @param dataType  - Target data type.
 * @param byteOrder - Byte order convention (default `ABCD`).
 * @returns Decoded value:
 *   - `number` for `uint16`, `int16`, `uint32`, `int32`, `float32`, `float64`
 *   - `string` for `ascii`
 *   - `boolean[]` for `bits` (length = bytes.length * 8)
 */
export function decodeRegister(
  bytes: number[],
  dataType: DataType,
  byteOrder: ByteOrder = 'ABCD',
): number | string | boolean[] {
  if (bytes.length === 0) {
    return dataType === 'bits' ? [] : dataType === 'ascii' ? '' : 0;
  }

  switch (dataType) {
    case 'uint16':
      return readUint16(applyByteOrder(bytes, byteOrder), 0);
    case 'int16':
      return readInt16(applyByteOrder(bytes, byteOrder), 0);
    case 'uint32':
      return readUint32(applyByteOrder(bytes, byteOrder), 0);
    case 'int32':
      return readInt32(applyByteOrder(bytes, byteOrder), 0);
    case 'float32':
      return readFloat32(applyByteOrder(bytes, byteOrder), 0);
    case 'float64':
      return readFloat64(applyByteOrder(bytes, byteOrder), 0);
    case 'bits':
      return decodeBits(bytes);
    case 'ascii':
      return decodeAscii(bytes);
  }
}

/* ------------------------------------------------------------------ */
/* Low-level readers (big-endian — caller pre-permutes)               */
/* ------------------------------------------------------------------ */

function readUint16(b: number[], off: number): number {
  return ((b[off] & 0xff) << 8) | (b[off + 1] & 0xff);
}
function readInt16(b: number[], off: number): number {
  const v = readUint16(b, off);
  return v > 0x7fff ? v - 0x10000 : v;
}
function readUint32(b: number[], off: number): number {
  return (
    ((b[off] & 0xff) * 0x1000000) +
    ((b[off + 1] & 0xff) << 16) +
    ((b[off + 2] & 0xff) << 8) +
    (b[off + 3] & 0xff)
  );
}
function readInt32(b: number[], off: number): number {
  const v = readUint32(b, off);
  return v > 0x7fffffff ? v - 0x100000000 : v;
}

/**
 * Read an IEEE-754 float32 from 4 big-endian bytes.
 *
 * Uses a DataView over a fresh 4-byte buffer. Allocation cost is acceptable
 * given that this is not the hot path for whole-stream parsing.
 */
function readFloat32(b: number[], off: number): number {
  const buf = new ArrayBuffer(4);
  const view = new DataView(buf);
  view.setUint8(0, b[off] & 0xff);
  view.setUint8(1, b[off + 1] & 0xff);
  view.setUint8(2, b[off + 2] & 0xff);
  view.setUint8(3, b[off + 3] & 0xff);
  return view.getFloat32(0, false);
}

/**
 * Read an IEEE-754 float64 from 8 big-endian bytes.
 */
function readFloat64(b: number[], off: number): number {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  for (let i = 0; i < 8; i++) view.setUint8(i, b[off + i] & 0xff);
  return view.getFloat64(0, false);
}

/* ------------------------------------------------------------------ */
/* Formatting                                                         */
/* ------------------------------------------------------------------ */

/**
 * Options for {@link formatValue}.
 */
export interface FormatValueOptions {
  /** Render numeric values as hex (e.g. `0x0123`). */
  hex?: boolean;
  /** Multiply the raw numeric value by `scale` before formatting. */
  scale?: number;
  /** Add `offset` after scaling. */
  offset?: number;
  /** Decimal places for floating-point output (default 3 for floats). */
  precision?: number;
  /** Optional unit suffix, e.g. `°C`. */
  unit?: string;
}

/**
 * Format a decoded register value for display.
 *
 * @param value    - Decoded value (number, string, or boolean[]).
 * @param dataType - The data type that produced `value`.
 * @param opts     - Formatting options.
 */
export function formatValue(
  value: number | string | boolean[],
  dataType: DataType,
  opts: FormatValueOptions = {},
): string {
  if (dataType === 'ascii' || typeof value === 'string') {
    return typeof value === 'string' ? value : String(value);
  }
  if (dataType === 'bits' || Array.isArray(value)) {
    const bits = value as boolean[];
    return bits.map((b) => (b ? '1' : '0')).join('');
  }

  // Numeric path.
  let n = typeof value === 'number' ? value : Number(value);
  if (opts.scale !== undefined) n = n * opts.scale;
  if (opts.offset !== undefined) n = n + opts.offset;

  if (opts.hex && dataType !== 'float32' && dataType !== 'float64') {
    // Integer hex display.
    let hex: string;
    if (n >= 0) {
      hex = Math.floor(n).toString(16).toUpperCase().padStart(hexWidth(dataType), '0');
    } else {
      // Two's-complement representation.
      const width = dataType === 'uint16' || dataType === 'int16' ? 16 : 32;
      hex = (n >>> 0).toString(16).toUpperCase().padStart(width / 4, '0').slice(-width / 4);
    }
    const s = `0x${hex}`;
    return opts.unit ? `${s} ${opts.unit}` : s;
  }

  let s: string;
  if (dataType === 'float32' || dataType === 'float64') {
    const p = opts.precision ?? 3;
    s = Number.isFinite(n) ? n.toFixed(p) : String(n);
  } else {
    s = Math.round(n).toString();
  }
  return opts.unit ? `${s} ${opts.unit}` : s;
}

function hexWidth(dataType: DataType): number {
  switch (dataType) {
    case 'uint16':
    case 'int16':
      return 4;
    case 'uint32':
    case 'int32':
      return 8;
    default:
      return 4;
  }
}

/* ------------------------------------------------------------------ */
/* Byte-order auto detection                                          */
/* ------------------------------------------------------------------ */

/**
 * Try to detect the most plausible byte order for a 4-byte sequence that
 * is expected to represent a sane float32 value.
 *
 * @param bytes - 4 bytes (2 registers).
 * @returns The preferred byte order, or `null` if none produce a finite,
 *          non-NaN, non-Infinite, "reasonable" float (|v| < 1e9).
 */
export function detectFloatByteOrder(bytes: number[]): ByteOrder | null {
  if (bytes.length < 4) return null;
  const orders: ByteOrder[] = ['ABCD', 'DCBA', 'BADC', 'CDAB'];
  let best: ByteOrder | null = null;
  let bestMag = Infinity;
  for (const order of orders) {
    const v = readFloat32(applyByteOrder(bytes, order), 0);
    if (!Number.isFinite(v)) continue;
    // Reject absurd magnitudes; these are usually misaligned word swaps.
    if (Math.abs(v) > 1e9) continue;
    // Prefer the smallest non-zero magnitude? No — prefer ABCD when ties.
    // We use the order in `orders` (ABCD first) so the first sane value wins.
    if (best === null) {
      best = order;
      bestMag = Math.abs(v);
    }
    // ABCD wins ties (it's first in the list).
    // We only update if a much smaller magnitude is found (likely the "real" one).
    const mag = Math.abs(v);
    if (mag > 0 && mag < bestMag * 1e-6) {
      best = order;
      bestMag = mag;
    }
  }
  return best;
}
