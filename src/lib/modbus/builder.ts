/**
 * @file Modbus frame builder.
 *
 * Constructs valid RTU / ASCII / TCP frames from a high-level
 * {@link BuildOptions} struct, computing CRC / LRC / MBAP length
 * automatically. Used by the constructor UI.
 *
 * The builder supports the common read/write FCs (0x01–0x06, 0x0F, 0x10) as
 * structured inputs; less common FCs (0x07–0x18, 0x2B) accept a raw
 * `responseData` byte array.
 */

import { appendCrc } from './crc';
import { appendLrc, lrc8 } from './lrc';
import type { ModbusProtocol } from './types';

/* ------------------------------------------------------------------ */
/* Public options                                                     */
/* ------------------------------------------------------------------ */

/**
 * Options accepted by the frame builder.
 */
export interface BuildOptions {
  /** Wire protocol. */
  protocol: ModbusProtocol;
  /** Slave address (RTU/ASCII). */
  slaveAddress: number;
  /** Unit ID (TCP — also used as `slaveAddress` equivalent). */
  unitId: number;
  /** Function code (0x01–0xFF). */
  functionCode: number;
  /** Start address for read / write FCs. */
  startAddress?: number;
  /** Quantity for read / write FCs. */
  quantity?: number;
  /** Register values for write FCs (each value is a 16-bit unsigned int). */
  values?: number[];
  /** Coil values for FC 0x0F. */
  coilValues?: boolean[];
  /** MBAP transaction ID (TCP, default 0). */
  transactionId?: number;
  /** Build an exception response (FC high bit set). */
  isException?: boolean;
  /** Exception code (required if `isException`). */
  exceptionCode?: number;
  /** Byte count override for read responses. */
  byteCount?: number;
  /** Raw response data bytes (for read responses / less-common FCs). */
  responseData?: number[];
}

/* ------------------------------------------------------------------ */
/* Public builders                                                    */
/* ------------------------------------------------------------------ */

/**
 * Build a Modbus RTU frame as a `Uint8Array`.
 *
 * @param opts - Build options.
 * @returns Binary RTU frame including the trailing 2-byte CRC.
 */
export function buildRtuFrame(opts: BuildOptions): Uint8Array {
  const { fc, data } = buildPdu(opts);
  const addr = opts.slaveAddress & 0xff;
  const body = new Uint8Array(1 + 1 + data.length);
  body[0] = addr;
  body[1] = fc;
  for (let i = 0; i < data.length; i++) body[2 + i] = data[i] & 0xff;
  return appendCrc(body);
}

/**
 * Build a Modbus ASCII frame as a string.
 *
 * Returns the full `:0103…FB\r\n` representation (uppercase hex, with LRC
 * and CRLF terminator).
 *
 * @param opts - Build options.
 * @returns ASCII frame string.
 */
export function buildAsciiFrame(opts: BuildOptions): string {
  const { fc, data } = buildPdu(opts);
  const addr = opts.slaveAddress & 0xff;
  // Body for LRC: address + function + data.
  const body = new Uint8Array(1 + 1 + data.length);
  body[0] = addr;
  body[1] = fc;
  for (let i = 0; i < data.length; i++) body[2 + i] = data[i] & 0xff;
  const withLrc = appendLrc(body);
  // Encode as `:` + hex pairs + CRLF.
  let out = ':';
  for (let i = 0; i < withLrc.length; i++) {
    out += (withLrc[i] & 0xff).toString(16).padStart(2, '0').toUpperCase();
  }
  return out + '\r\n';
}

/**
 * Build a Modbus TCP frame (MBAP + PDU) as a `Uint8Array`.
 *
 * @param opts - Build options.
 * @returns Binary TCP frame including the 7-byte MBAP header.
 */
export function buildTcpFrame(opts: BuildOptions): Uint8Array {
  const { fc, data } = buildPdu(opts);
  const unitId = opts.unitId & 0xff;
  const txnId = opts.transactionId ?? 0;
  const length = 1 + 1 + data.length; // unit + function + data
  const out = new Uint8Array(6 + length);
  out[0] = (txnId >>> 8) & 0xff;
  out[1] = txnId & 0xff;
  out[2] = 0; // protocol ID high
  out[3] = 0; // protocol ID low
  out[4] = (length >>> 8) & 0xff;
  out[5] = length & 0xff;
  out[6] = unitId;
  out[7] = fc;
  for (let i = 0; i < data.length; i++) out[8 + i] = data[i] & 0xff;
  return out;
}

/**
 * Build a frame for any protocol. Returns `string` for ASCII, `Uint8Array`
 * for RTU/TCP.
 */
export function buildFrame(opts: BuildOptions): Uint8Array | string {
  switch (opts.protocol) {
    case 'rtu':
      return buildRtuFrame(opts);
    case 'ascii':
      return buildAsciiFrame(opts);
    case 'tcp':
      return buildTcpFrame(opts);
  }
}

/* ------------------------------------------------------------------ */
/* PDU assembly                                                       */
/* ------------------------------------------------------------------ */

/**
 * Build the function-code byte + data section (the "PDU" for TCP, or the
 * post-address portion of an RTU/ASCII frame).
 *
 * Returns `{ fc, data }` where `fc` is the FC byte (with the exception bit
 * set if applicable) and `data` is the data section as a regular array.
 */
function buildPdu(opts: BuildOptions): { fc: number; data: number[] } {
  if (opts.isException) {
    const fc = (opts.functionCode & 0x7f) | 0x80;
    return { fc, data: [(opts.exceptionCode ?? 0) & 0xff] };
  }

  const fc = opts.functionCode & 0xff;
  const data: number[] = [];

  switch (fc) {
    case 0x01:
    case 0x02:
    case 0x03:
    case 0x04: {
      // Read Coils / Discrete Inputs / Holding Registers / Input Registers.
      if (opts.responseData && opts.responseData.length > 0) {
        // Response.
        const bc = opts.byteCount ?? opts.responseData.length;
        data.push(bc & 0xff);
        for (const b of opts.responseData) data.push(b & 0xff);
      } else {
        // Request.
        pushU16(data, opts.startAddress ?? 0);
        pushU16(data, opts.quantity ?? 1);
      }
      break;
    }
    case 0x05: {
      // Write Single Coil — echo request/response.
      pushU16(data, opts.startAddress ?? 0);
      const on = opts.coilValues?.[0] === true;
      pushU16(data, on ? 0xff00 : 0x0000);
      break;
    }
    case 0x06: {
      // Write Single Register — echo request/response.
      pushU16(data, opts.startAddress ?? 0);
      pushU16(data, (opts.values?.[0] ?? 0) & 0xffff);
      break;
    }
    case 0x07:
    case 0x0b:
    case 0x0c:
    case 0x11: {
      // Request has no data; response is variable.
      if (opts.responseData) {
        for (const b of opts.responseData) data.push(b & 0xff);
      }
      break;
    }
    case 0x08:
    case 0x2b: {
      // Diagnostics / MEI: pass through sub-function + data.
      if (opts.responseData) {
        for (const b of opts.responseData) data.push(b & 0xff);
      }
      break;
    }
    case 0x0f: {
      // Write Multiple Coils — request only; response is the addr+qty echo.
      if (opts.responseData) {
        // Treat as response (start_addr + quantity).
        pushU16(data, opts.startAddress ?? 0);
        pushU16(data, opts.quantity ?? opts.coilValues?.length ?? 0);
      } else {
        pushU16(data, opts.startAddress ?? 0);
        const coils = opts.coilValues ?? [];
        const qty = opts.quantity ?? coils.length;
        pushU16(data, qty);
        const packed = packCoils(coils);
        data.push(packed.length & 0xff);
        for (const b of packed) data.push(b & 0xff);
      }
      break;
    }
    case 0x10: {
      // Write Multiple Registers — request only; response is the addr+qty echo.
      if (opts.responseData) {
        pushU16(data, opts.startAddress ?? 0);
        pushU16(data, opts.quantity ?? opts.values?.length ?? 0);
      } else {
        pushU16(data, opts.startAddress ?? 0);
        const values = opts.values ?? [];
        const qty = opts.quantity ?? values.length;
        pushU16(data, qty);
        const regBytes: number[] = [];
        for (const v of values) {
          regBytes.push((v >>> 8) & 0xff);
          regBytes.push(v & 0xff);
        }
        data.push(regBytes.length & 0xff);
        for (const b of regBytes) data.push(b & 0xff);
      }
      break;
    }
    case 0x14:
    case 0x15:
    case 0x16:
    case 0x17:
    case 0x18: {
      // Less-common FCs: pass through raw `responseData`.
      if (opts.responseData) {
        for (const b of opts.responseData) data.push(b & 0xff);
      }
      break;
    }
    default: {
      // Unknown FC: pass through raw `responseData`.
      if (opts.responseData) {
        for (const b of opts.responseData) data.push(b & 0xff);
      }
    }
  }

  return { fc, data };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Push a 16-bit big-endian value into an array (high byte first).
 */
function pushU16(arr: number[], val: number): void {
  arr.push((val >>> 8) & 0xff);
  arr.push(val & 0xff);
}

/**
 * Pack a boolean array of coil values into bytes (LSB first per byte,
 * matching the Modbus spec for FC 0x0F).
 *
 * @param coils - Coil values (coils[0] is the lowest address).
 * @returns Packed bytes (length = ceil(coils.length / 8)).
 */
export function packCoils(coils: boolean[]): number[] {
  const byteCount = Math.ceil(coils.length / 8);
  const out: number[] = new Array(byteCount).fill(0);
  for (let i = 0; i < coils.length; i++) {
    if (coils[i]) {
      out[Math.floor(i / 8)] |= 1 << (i % 8);
    }
  }
  return out;
}

/**
 * Compute the LRC byte for a sequence of bytes. Re-exported for callers
 * that want to verify their own buffers.
 */
export { lrc8 };
