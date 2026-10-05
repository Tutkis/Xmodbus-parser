/**
 * @file Modbus frame parser — main entry point.
 *
 * Supports three wire protocols (RTU, ASCII, TCP) with automatic detection,
 * per-byte semantic tokenisation, logical field extraction, and best-effort
 * request/response direction inference.
 *
 * All functions are pure and side-effect free. They never throw on malformed
 * input — instead they return a {@link ParsedFrame} with an appropriate
 * `status` (`'truncated'`, `'invalid_crc'`, `'invalid_lrc'`, `'malformed'`).
 */

import { crc16, verifyCrc } from './crc';
import { lrc8, verifyLrc } from './lrc';
import {
  FUNCTION_CODES,
  EXCEPTION_CODES,
  getFunctionCodeInfo,
  getExceptionInfo,
  functionCodeName,
  exceptionCodeName,
  type FunctionCodeInfo,
  type SchemaField,
} from './function-codes';
import { applyByteOrder, decodeRegister, formatValue, detectFloatByteOrder } from './register-decoder';
import type {
  ByteToken,
  ByteRole,
  ModbusDirection,
  ModbusFrameStatus,
  ModbusProtocol,
  ParsedField,
  ParsedFrame,
  ParseOptions,
  RegisterValue,
  RegisterMapEntry,
  ByteOrder,
  DataType,
} from './types';

/* ------------------------------------------------------------------ */
/* Minimum frame sizes                                                */
/* ------------------------------------------------------------------ */

const MIN_RTU_LEN = 4; // addr + func + crc_lo + crc_hi (degenerate)
const MIN_ASCII_LEN = 3; // addr + func + lrc
const MIN_TCP_LEN = 8; // mbap(7) + function(1) ... but minimum useful is 8
const MAX_RTU_FRAME = 256; // PDU + addr + crc upper bound per spec

/* ------------------------------------------------------------------ */
/* Input normalisation                                                */
/* ------------------------------------------------------------------ */

/**
 * Coerce a `Uint8Array | string` into a `Uint8Array`.
 *
 * Strings are interpreted as a hex dump (with whitespace / `0x` / commas
 * stripped) unless they begin with `:` (ASCII mode) — in which case they
 * are passed through to {@link asciiStringToBytes}.
 *
 * If the input cannot be decoded, an empty `Uint8Array` is returned.
 */
export function toBytes(input: Uint8Array | string): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (typeof input !== 'string') return new Uint8Array(0);
  const trimmed = input.trim();
  if (trimmed.startsWith(':')) {
    return asciiStringToBytes(trimmed);
  }
  return hexStringToBytes(trimmed);
}

/**
 * Decode a hex-dump string (with optional whitespace / separators) into
 * bytes. Returns an empty array if the hex is malformed (odd length).
 *
 * Supports `//` and `#` line comments — everything from the comment marker
 * to the end of the line is ignored. This lets users paste annotated hex
 * dumps like:
 *
 * ```
 * 01 03 00 00 00 0A C5 CD  // read 10 holding registers from slave 1
 * 02 83 02 C1 71  # exception: illegal address
 * ```
 */
export function hexStringToBytes(s: string): Uint8Array {
  // Strip line comments first (// or #), then keep only hex digits.
  let cleaned = '';
  let i = 0;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    // Detect line comments: `//` or `#`
    if ((c === 0x2f && i + 1 < s.length && s.charCodeAt(i + 1) === 0x2f) || c === 0x23) {
      // Skip to end of line.
      while (i < s.length && s.charCodeAt(i) !== 0x0a && s.charCodeAt(i) !== 0x0d) i++;
      continue;
    }
    if (
      (c >= 0x30 && c <= 0x39) ||
      (c >= 0x41 && c <= 0x46) ||
      (c >= 0x61 && c <= 0x66)
    ) {
      cleaned += s[i];
    }
    i++;
  }
  if (cleaned.length === 0 || cleaned.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(cleaned.length / 2);
  for (let j = 0; j < out.length; j++) {
    out[j] = parseInt(cleaned.substr(j * 2, 2), 16);
  }
  return out;
}

/**
 * Decode a single ASCII frame string (`:01...FB\r\n`) into its binary
 * content (excluding the leading `:` and trailing CRLF, and **excluding**
 * the LRC byte — the LRC is part of the returned bytes for downstream
 * verification, so we include it).
 *
 * Actually we keep the LRC as the last byte so {@link verifyLrc} works.
 */
export function asciiStringToBytes(s: string): Uint8Array {
  const colon = s.indexOf(':');
  if (colon < 0) return new Uint8Array(0);
  let hex = '';
  for (let i = colon + 1; i < s.length; i++) {
    const c = s[i];
    if (/[0-9a-fA-F]/.test(c)) {
      hex += c;
    } else if (c === '\r' || c === '\n') {
      break;
    } else if (c === ' ' || c === '\t') {
      continue;
    } else {
      break;
    }
  }
  if (hex.length === 0 || hex.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Protocol detection                                                 */
/* ------------------------------------------------------------------ */

/**
 * Detect the most likely wire protocol of `input`.
 *
 * Heuristics, in order:
 *  1. If `input` is a string starting with `:`, → `'ascii'`.
 *  2. If bytes start with a plausible MBAP header (protocol = 0x0000 and
 *     length field matches remaining bytes), → `'tcp'`.
 *  3. If the last 2 bytes match the CRC-16 of everything before them,
 *     → `'rtu'`.
 *  4. Otherwise `null`.
 */
export function detectProtocol(input: Uint8Array | string): ModbusProtocol | null {
  // String starting with ':' is ASCII.
  if (typeof input === 'string' && input.trim().startsWith(':')) {
    return 'ascii';
  }

  const bytes = input instanceof Uint8Array ? input : hexStringToBytes(input.trim());
  if (bytes.length === 0) return null;

  // Try TCP / MBAP first (it is the most structurally constrained).
  if (looksLikeTcp(bytes)) return 'tcp';

  // Then RTU via CRC check.
  if (bytes.length >= MIN_RTU_LEN && verifyCrc(bytes)) return 'rtu';

  return null;
}

/**
 * Quick MBAP-header sanity check.
 *
 * - Bytes 2..3 must be 0x00 0x00 (Modbus protocol identifier).
 * - Bytes 4..5 give the number of bytes following (unit + PDU), so the
 *   total frame length should equal `6 + length`.
 */
function looksLikeTcp(bytes: Uint8Array): boolean {
  if (bytes.length < MIN_TCP_LEN) return false;
  // Protocol ID must be 0.
  if (bytes[2] !== 0 || bytes[3] !== 0) return false;
  const length = (bytes[4] << 8) | bytes[5];
  if (length < 2) return false; // at least unit_id + function
  if (6 + length === bytes.length) return true;
  // Allow trailing bytes (multiple frames in one buffer) — caller should
  // use parseStream for that. For a single-frame detect, require exact match.
  return false;
}

/* ------------------------------------------------------------------ */
/* Direction inference                                                */
/* ------------------------------------------------------------------ */

/**
 * Infer the direction (request vs response) of a non-exception frame from
 * its function code and data-section length.
 *
 * Returns `'unknown'` for echo-symmetric FCs (0x05, 0x06, 0x16) and for
 * structurally symmetric FCs (0x08 diagnostics, 0x2B MEI).
 *
 * @param fc    - Function code byte (low 7 bits — exception bit ignored).
 * @param dataLen - Length of the data section (excluding addr/func/checksum).
 */
export function inferDirection(fc: number, dataLen: number): ModbusDirection {
  const base = fc & 0x7f;
  switch (base) {
    case 0x01:
    case 0x02:
    case 0x03:
    case 0x04:
      // Request: [start_addr(2)][quantity(2)] = 4 bytes
      // Response: [byte_count(1)][data(N)] >= 1 byte
      if (dataLen === 4) return 'request';
      return 'response';
    case 0x05:
    case 0x06:
    case 0x16:
      // Echo FCs: request and response are byte-identical.
      return 'unknown';
    case 0x07:
      return dataLen === 0 ? 'request' : 'response';
    case 0x08:
    case 0x2b:
      // Symmetric structure.
      return 'unknown';
    case 0x0b:
      return dataLen === 0 ? 'request' : 'response';
    case 0x0c:
      return dataLen === 0 ? 'request' : 'response';
    case 0x0f:
    case 0x10:
      // Request: [start(2)][qty(2)][byte_count(1)][data(N)] >= 5
      // Response: [start(2)][qty(2)] = 4
      if (dataLen === 4) return 'response';
      if (dataLen >= 5) return 'request';
      return 'unknown';
    case 0x11:
      return dataLen === 0 ? 'request' : 'response';
    case 0x14:
    case 0x15:
      // Symmetric: [byte_count(1)][sub-requests/responses(N)]
      return 'unknown';
    case 0x17:
      // Request: [read_start(2)][read_qty(2)][write_start(2)][write_qty(2)][bc(1)][data(N)] >= 9
      // Response: [byte_count(1)][data(N)] >= 1
      if (dataLen >= 9) return 'request';
      return 'response';
    case 0x18:
      // Request: [fifo_addr(2)] = 2
      // Response: [byte_count(2)][fifo_count(2)][data(N)] >= 4
      if (dataLen === 2) return 'request';
      return 'response';
    default:
      return 'unknown';
  }
}

/* ------------------------------------------------------------------ */
/* Main parseFrame                                                    */
/* ------------------------------------------------------------------ */

/**
 * Parse a single Modbus frame.
 *
 * If `opts.protocol` is set, that protocol is assumed; otherwise the
 * protocol is auto-detected. For ASCII strings starting with `:`, ASCII
 * mode is always used regardless of `opts.protocol`.
 *
 * @param input - Frame as `Uint8Array` (binary) or hex/ASCII `string`.
 * @param opts  - Parser options.
 * @returns A {@link ParsedFrame}. Never throws; malformed input is reported
 *          via `frame.status`.
 */
export function parseFrame(
  input: Uint8Array | string,
  opts: ParseOptions = {},
): ParsedFrame {
  const protocol = opts.protocol ?? detectProtocol(input) ?? 'rtu';
  const sourceLabel = opts.sourceLabel;
  const timestamp = opts.timestamp;

  if (protocol === 'ascii') {
    return parseAsciiFrame(input, opts, sourceLabel, timestamp);
  }
  if (protocol === 'tcp') {
    return parseTcpFrame(input, opts, sourceLabel, timestamp);
  }
  return parseRtuFrame(input, opts, sourceLabel, timestamp);
}

/* ------------------------------------------------------------------ */
/* RTU                                                                */
/* ------------------------------------------------------------------ */

function parseRtuFrame(
  input: Uint8Array | string,
  opts: ParseOptions,
  sourceLabel?: string,
  timestamp?: number,
): ParsedFrame {
  const bytes = input instanceof Uint8Array ? input : toBytes(input);
  const notes: string[] = [];

  if (bytes.length < MIN_RTU_LEN) {
    return makeTruncated('rtu', bytes, sourceLabel, timestamp, notes);
  }

  // CRC verification — compute once and reuse for both verification and reporting.
  const crcLo = bytes[bytes.length - 2];
  const crcHi = bytes[bytes.length - 1];
  const crcStored = (crcHi << 8) | crcLo;
  const crcComputed = bytes.length >= 4 ? crc16(bytes.subarray(0, bytes.length - 2)) : 0;
  const crcOk = bytes.length >= 4 && (crcComputed & 0xff) === crcLo && (crcComputed >>> 8) === crcHi;

  // The data section excludes addr + func + crc(2).
  const slaveAddress = bytes[0];
  const fcByte = bytes[1];
  const isException = (fcByte & 0x80) !== 0;
  const fc = fcByte & 0x7f;
  const dataSection = bytes.subarray(2, bytes.length - 2);
  const dataStartOffset = 2;

  const direction =
    opts.direction ?? (isException ? 'response' : inferDirection(fc, dataSection.length));

  // Fast path: skip tokenisation / field extraction for high-throughput streams.
  if (opts.minimal) {
    return makeMinimalRtuFrame(bytes, fc, fcByte, isException, slaveAddress, crcStored, crcOk, direction, dataSection, sourceLabel, timestamp);
  }

  const { tokens, fields } = tokenizeDataSection(
    fc,
    isException,
    direction,
    dataSection,
    dataStartOffset,
    opts,
  );

  // Prepend address + function tokens, append CRC tokens.
  const allTokens: ByteToken[] = [
    {
      offset: 0,
      value: slaveAddress,
      role: 'address',
      field: 'field.slave_address',
      description: `Slave Address 0x${slaveAddress.toString(16).padStart(2, '0').toUpperCase()}`,
    },
    {
      offset: 1,
      value: fcByte,
      role: isException ? 'exception_flag' : 'function',
      field: 'field.function_code',
      description: formatFunctionDescription(fcByte),
    },
    ...tokens,
    {
      offset: bytes.length - 2,
      value: crcLo,
      role: 'crc_lo',
      field: 'field.crc',
      description: 'CRC Lo',
    },
    {
      offset: bytes.length - 1,
      value: crcHi,
      role: 'crc_hi',
      field: 'field.crc',
      description: 'CRC Hi',
    },
  ];

  // Logical fields: prepend address + function, append CRC.
  const allFields: ParsedField[] = [
    {
      name: 'field.slave_address',
      label: 'Slave Address',
      startOffset: 0,
      endOffset: 1,
      value: slaveAddress,
      displayValue: `0x${slaveAddress.toString(16).padStart(2, '0').toUpperCase()} (${slaveAddress})`,
      bytes: [slaveAddress],
    },
    {
      name: 'field.function_code',
      label: 'Function Code',
      startOffset: 1,
      endOffset: 2,
      value: fcByte,
      displayValue: formatFunctionDescription(fcByte),
      bytes: [fcByte],
    },
    ...fields,
    {
      name: 'field.crc',
      label: 'CRC',
      startOffset: bytes.length - 2,
      endOffset: bytes.length,
      value: crcStored,
      displayValue: `0x${crcStored.toString(16).padStart(4, '0').toUpperCase()} (${crcOk ? 'OK' : 'BAD'})`,
      bytes: [crcLo, crcHi],
    },
  ];

  let status: ModbusFrameStatus;
  if (!crcOk) status = 'invalid_crc';
  else if (isException) status = 'exception';
  else if (!getFunctionCodeInfo(fc)) status = 'malformed';
  else status = 'valid';

  if (!crcOk) {
    notes.push(
      `CRC mismatch: stored 0x${crcStored.toString(16).padStart(4, '0').toUpperCase()}, computed 0x${crcComputed.toString(16).padStart(4, '0').toUpperCase()}`,
    );
  }

  const frame: ParsedFrame = {
    protocol: 'rtu',
    direction,
    status,
    raw: bytes,
    tokens: allTokens,
    fields: allFields,
    functionCode: fc,
    isException,
    slaveAddress,
    crc: crcStored,
    crcValid: crcOk,
    notes,
  };
  if (isException) frame.exceptionCode = dataSection[0];
  if (sourceLabel !== undefined) frame.sourceLabel = sourceLabel;
  if (timestamp !== undefined) frame.timestamp = timestamp;
  return frame;
}

/* ------------------------------------------------------------------ */
/* ASCII                                                              */
/* ------------------------------------------------------------------ */

function parseAsciiFrame(
  input: Uint8Array | string,
  opts: ParseOptions,
  sourceLabel?: string,
  timestamp?: number,
): ParsedFrame {
  const bytes =
    typeof input === 'string'
      ? asciiStringToBytes(input)
      : asciiBytesToBinary(input);
  const notes: string[] = [];

  if (bytes.length < MIN_ASCII_LEN) {
    return makeTruncated('ascii', bytes, sourceLabel, timestamp, notes);
  }

  const lrcOk = verifyLrc(bytes);
  const lrcByte = bytes[bytes.length - 1];
  const lrcComputed = lrc8(bytes.subarray(0, bytes.length - 1));

  const slaveAddress = bytes[0];
  const fcByte = bytes[1];
  const isException = (fcByte & 0x80) !== 0;
  const fc = fcByte & 0x7f;
  const dataSection = bytes.subarray(2, bytes.length - 1);
  const dataStartOffset = 2;

  const direction =
    opts.direction ?? (isException ? 'response' : inferDirection(fc, dataSection.length));

  // Fast path: skip tokenisation / field extraction for high-throughput streams.
  if (opts.minimal) {
    return makeMinimalAsciiFrame(bytes, fc, fcByte, isException, slaveAddress, lrcByte, lrcOk, direction, dataSection, sourceLabel, timestamp);
  }

  const { tokens, fields } = tokenizeDataSection(
    fc,
    isException,
    direction,
    dataSection,
    dataStartOffset,
    opts,
  );

  const allTokens: ByteToken[] = [
    {
      offset: 0,
      value: slaveAddress,
      role: 'address',
      field: 'field.slave_address',
      description: `Slave Address 0x${slaveAddress.toString(16).padStart(2, '0').toUpperCase()}`,
    },
    {
      offset: 1,
      value: fcByte,
      role: isException ? 'exception_flag' : 'function',
      field: 'field.function_code',
      description: formatFunctionDescription(fcByte),
    },
    ...tokens,
    {
      offset: bytes.length - 1,
      value: lrcByte,
      role: 'lrc',
      field: 'field.lrc',
      description: 'LRC',
    },
  ];

  const allFields: ParsedField[] = [
    {
      name: 'field.slave_address',
      label: 'Slave Address',
      startOffset: 0,
      endOffset: 1,
      value: slaveAddress,
      displayValue: `0x${slaveAddress.toString(16).padStart(2, '0').toUpperCase()} (${slaveAddress})`,
      bytes: [slaveAddress],
    },
    {
      name: 'field.function_code',
      label: 'Function Code',
      startOffset: 1,
      endOffset: 2,
      value: fcByte,
      displayValue: formatFunctionDescription(fcByte),
      bytes: [fcByte],
    },
    ...fields,
    {
      name: 'field.lrc',
      label: 'LRC',
      startOffset: bytes.length - 1,
      endOffset: bytes.length,
      value: lrcByte,
      displayValue: `0x${lrcByte.toString(16).padStart(2, '0').toUpperCase()} (${lrcOk ? 'OK' : 'BAD'})`,
      bytes: [lrcByte],
    },
  ];

  let status: ModbusFrameStatus;
  if (!lrcOk) status = 'invalid_lrc';
  else if (isException) status = 'exception';
  else if (!getFunctionCodeInfo(fc)) status = 'malformed';
  else status = 'valid';

  if (!lrcOk) {
    notes.push(
      `LRC mismatch: stored 0x${lrcByte.toString(16).padStart(2, '0').toUpperCase()}, computed 0x${lrcComputed.toString(16).padStart(2, '0').toUpperCase()}`,
    );
  }

  const frame: ParsedFrame = {
    protocol: 'ascii',
    direction,
    status,
    raw: bytes,
    tokens: allTokens,
    fields: allFields,
    functionCode: fc,
    isException,
    slaveAddress,
    lrc: lrcByte,
    lrcValid: lrcOk,
    notes,
  };
  if (isException) frame.exceptionCode = dataSection[0];
  if (sourceLabel !== undefined) frame.sourceLabel = sourceLabel;
  if (timestamp !== undefined) frame.timestamp = timestamp;
  return frame;
}

/**
 * If the ASCII bytes were supplied as a `Uint8Array` (i.e. the raw ASCII
 * hex characters including the `:`), decode them to binary.
 */
function asciiBytesToBinary(input: Uint8Array): Uint8Array {
  // Find the ':' (0x3A) and decode hex from there.
  let start = -1;
  for (let i = 0; i < input.length; i++) {
    if (input[i] === 0x3a) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return new Uint8Array(0);
  const hex: number[] = [];
  for (let i = start; i < input.length; i++) {
    const b = input[i];
    if (isHexByte(b)) {
      hex.push(b);
    } else if (b === 0x0d || b === 0x0a) {
      break;
    } else if (b === 0x20 || b === 0x09) {
      continue;
    } else {
      break;
    }
  }
  if (hex.length === 0 || hex.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(String.fromCharCode(hex[i * 2], hex[i * 2 + 1]), 16);
  }
  return out;
}

function isHexByte(b: number): boolean {
  return (
    (b >= 0x30 && b <= 0x39) ||
    (b >= 0x41 && b <= 0x46) ||
    (b >= 0x61 && b <= 0x66)
  );
}

/* ------------------------------------------------------------------ */
/* TCP                                                                */
/* ------------------------------------------------------------------ */

function parseTcpFrame(
  input: Uint8Array | string,
  opts: ParseOptions,
  sourceLabel?: string,
  timestamp?: number,
): ParsedFrame {
  const bytes = input instanceof Uint8Array ? input : toBytes(input);
  const notes: string[] = [];

  if (bytes.length < MIN_TCP_LEN) {
    return makeTruncated('tcp', bytes, sourceLabel, timestamp, notes);
  }

  const transactionId = (bytes[0] << 8) | bytes[1];
  const protocolId = (bytes[2] << 8) | bytes[3];
  const lengthField = (bytes[4] << 8) | bytes[5];
  const unitId = bytes[6];
  const fcByte = bytes[7];
  const isException = (fcByte & 0x80) !== 0;
  const fc = fcByte & 0x7f;

  // Per MBAP, the data section is bytes[8 .. 6+lengthField-1].
  // We'll use the actual buffer end if length is inconsistent.
  const expectedEnd = Math.min(6 + lengthField, bytes.length);
  const dataSection = bytes.subarray(8, expectedEnd);
  const dataStartOffset = 8;

  if (protocolId !== 0) {
    notes.push(`Unexpected protocol ID ${protocolId} (expected 0)`);
  }
  if (6 + lengthField !== bytes.length) {
    notes.push(
      `MBAP length ${lengthField} does not match buffer (${bytes.length} bytes; expected ${6 + lengthField})`,
    );
  }

  const direction =
    opts.direction ?? (isException ? 'response' : inferDirection(fc, dataSection.length));

  // Fast path: skip tokenisation / field extraction for high-throughput streams.
  if (opts.minimal) {
    return makeMinimalTcpFrame(bytes, fc, fcByte, isException, unitId, transactionId, direction, dataSection, sourceLabel, timestamp);
  }

  const { tokens, fields } = tokenizeDataSection(
    fc,
    isException,
    direction,
    dataSection,
    dataStartOffset,
    opts,
  );

  // MBAP tokens (7 bytes) + function + data.
  const allTokens: ByteToken[] = [
    { offset: 0, value: bytes[0], role: 'mbap_transaction_hi', field: 'field.transaction_id', description: 'Transaction ID (Hi)' },
    { offset: 1, value: bytes[1], role: 'mbap_transaction_lo', field: 'field.transaction_id', description: 'Transaction ID (Lo)' },
    { offset: 2, value: bytes[2], role: 'mbap_protocol_hi', field: 'field.protocol_id', description: 'Protocol ID (Hi)' },
    { offset: 3, value: bytes[3], role: 'mbap_protocol_lo', field: 'field.protocol_id', description: 'Protocol ID (Lo)' },
    { offset: 4, value: bytes[4], role: 'mbap_length_hi', field: 'field.length', description: 'Length (Hi)' },
    { offset: 5, value: bytes[5], role: 'mbap_length_lo', field: 'field.length', description: 'Length (Lo)' },
    { offset: 6, value: unitId, role: 'unit_id', field: 'field.unit_id', description: `Unit ID 0x${unitId.toString(16).padStart(2, '0').toUpperCase()}` },
    { offset: 7, value: fcByte, role: isException ? 'exception_flag' : 'function', field: 'field.function_code', description: formatFunctionDescription(fcByte) },
    ...tokens,
  ];

  const allFields: ParsedField[] = [
    {
      name: 'field.transaction_id',
      label: 'Transaction ID',
      startOffset: 0,
      endOffset: 2,
      value: transactionId,
      displayValue: `0x${transactionId.toString(16).padStart(4, '0').toUpperCase()} (${transactionId})`,
      bytes: [bytes[0], bytes[1]],
    },
    {
      name: 'field.protocol_id',
      label: 'Protocol ID',
      startOffset: 2,
      endOffset: 4,
      value: protocolId,
      displayValue: `0x${protocolId.toString(16).padStart(4, '0').toUpperCase()}`,
      bytes: [bytes[2], bytes[3]],
    },
    {
      name: 'field.length',
      label: 'Length',
      startOffset: 4,
      endOffset: 6,
      value: lengthField,
      displayValue: `${lengthField} bytes`,
      bytes: [bytes[4], bytes[5]],
    },
    {
      name: 'field.unit_id',
      label: 'Unit ID',
      startOffset: 6,
      endOffset: 7,
      value: unitId,
      displayValue: `0x${unitId.toString(16).padStart(2, '0').toUpperCase()} (${unitId})`,
      bytes: [unitId],
    },
    {
      name: 'field.function_code',
      label: 'Function Code',
      startOffset: 7,
      endOffset: 8,
      value: fcByte,
      displayValue: formatFunctionDescription(fcByte),
      bytes: [fcByte],
    },
    ...fields,
  ];

  let status: ModbusFrameStatus;
  if (isException) status = 'exception';
  else if (!getFunctionCodeInfo(fc)) status = 'malformed';
  else status = 'valid';

  const frame: ParsedFrame = {
    protocol: 'tcp',
    direction,
    status,
    raw: bytes,
    tokens: allTokens,
    fields: allFields,
    functionCode: fc,
    isException,
    unitId,
    transactionId,
    notes,
  };
  if (isException) frame.exceptionCode = dataSection[0];
  if (sourceLabel !== undefined) frame.sourceLabel = sourceLabel;
  if (timestamp !== undefined) frame.timestamp = timestamp;
  return frame;
}

/* ------------------------------------------------------------------ */
/* Tokenisation helper                                                */
/* ------------------------------------------------------------------ */

/**
 * Walk the appropriate schema for `fc` / `direction` / `isException` and
 * produce per-byte tokens plus logical fields for the data section only.
 *
 * `dataStartOffset` is the absolute offset of `dataSection[0]` within the
 * full frame, used to populate `ByteToken.offset` and `ParsedField.startOffset`.
 */
function tokenizeDataSection(
  fc: number,
  isException: boolean,
  direction: ModbusDirection,
  dataSection: Uint8Array,
  dataStartOffset: number,
  opts: ParseOptions = {},
): { tokens: ByteToken[]; fields: ParsedField[] } {
  const tokens: ByteToken[] = [];
  const fields: ParsedField[] = [];

  const info: FunctionCodeInfo | undefined = getFunctionCodeInfo(fc);
  if (!info) {
    // Unknown FC — mark all data bytes as 'unknown'.
    for (let i = 0; i < dataSection.length; i++) {
      tokens.push({ offset: dataStartOffset + i, value: dataSection[i], role: 'unknown' });
    }
    if (dataSection.length > 0) {
      fields.push({
        name: 'field.data',
        label: 'Data',
        startOffset: dataStartOffset,
        endOffset: dataStartOffset + dataSection.length,
        value: bytesToHex(dataSection),
        displayValue: bytesToHex(dataSection),
        bytes: Array.from(dataSection),
      });
    }
    return { tokens, fields };
  }

  let schema: SchemaField[];
  if (isException) {
    schema = info.exceptionSchema;
  } else if (direction === 'request') {
    schema = info.requestSchema;
  } else if (direction === 'response') {
    schema = info.responseSchema;
  } else {
    // 'unknown' — prefer request schema if it matches the size exactly,
    // else fall back to response.
    const reqSize = schemaFixedSize(info.requestSchema);
    if (reqSize !== null && reqSize === dataSection.length) {
      schema = info.requestSchema;
    } else {
      schema = info.responseSchema;
    }
  }

  walkSchema(schema, dataSection, dataStartOffset, tokens, fields, info, isException, opts);
  return { tokens, fields };
}

/**
 * Walk `schema` over `dataSection`, producing tokens and grouped fields.
 *
 * A schema field with `size === 0` consumes the rest of the data section.
 * Any trailing bytes beyond the schema are emitted as `'unknown'` tokens.
 */
function walkSchema(
  schema: SchemaField[],
  dataSection: Uint8Array,
  dataStartOffset: number,
  tokens: ByteToken[],
  fields: ParsedField[],
  info: FunctionCodeInfo,
  isException: boolean,
  opts: ParseOptions = {},
): void {
  let pos = 0;
  const n = dataSection.length;
  let i = 0;
  while (i < schema.length) {
    const field = schema[i];
    // Detect hi/lo pair: current is *_hi, next is *_lo with same field name.
    const next = schema[i + 1];
    const isHiLoPair =
      next &&
      field.field === next.field &&
      ((field.role === 'start_addr_hi' && next.role === 'start_addr_lo') ||
        (field.role === 'quantity_hi' && next.role === 'quantity_lo') ||
        (field.role === 'byte_count' && next.role === 'byte_count') // unlikely but handle
      );

    if (isHiLoPair) {
      // Consume both bytes as a single 16-bit field.
      const size = 2;
      if (pos + size > n) {
        // truncated — fall through to single-byte handling
      } else {
        const fieldBytes: number[] = [dataSection[pos], dataSection[pos + 1]];
        const startOff = dataStartOffset + pos;
        // Tokens for both bytes (preserves byte-level coloring).
        for (let j = 0; j < size; j++) {
          tokens.push({
            offset: dataStartOffset + pos + j,
            value: dataSection[pos + j],
            role: j === 0 ? field.role : next.role,
            field: field.field,
            description: field.label,
          });
        }
        pos += size;
        const endOff = dataStartOffset + pos;
        const combined = (fieldBytes[0] << 8) | fieldBytes[1];
        fields.push({
          name: field.field,
          label: field.label,
          startOffset: startOff,
          endOffset: endOff,
          bytes: fieldBytes,
          value: combined,
          displayValue: formatCombinedValue(field.role, combined, opts),
        });
        i += 2;
        continue;
      }
    }

    let size = field.size;
    if (size === 0) {
      // Variable: rest of the data section.
      size = n - pos;
    }
    if (size <= 0) break;
    if (pos + size > n) size = n - pos; // truncated

    const fieldBytes: number[] = [];
    const startOff = dataStartOffset + pos;
    for (let j = 0; j < size; j++) {
      const b = dataSection[pos];
      tokens.push({
        offset: dataStartOffset + pos,
        value: b,
        role: field.role,
        field: field.field,
        description: field.label,
      });
      fieldBytes.push(b);
      pos++;
    }
    const endOff = dataStartOffset + pos;
    fields.push({
      name: field.field,
      label: field.label,
      startOffset: startOff,
      endOffset: endOff,
      bytes: fieldBytes,
      value: computeFieldValue(field, fieldBytes, info, isException),
      displayValue: formatFieldValue(field, fieldBytes, info, isException),
    });
    i++;
  }

  // Trailing bytes beyond the schema (truncated variable tail).
  while (pos < n) {
    tokens.push({
      offset: dataStartOffset + pos,
      value: dataSection[pos],
      role: 'unknown',
    });
    pos++;
  }
}

/**
 * Format a combined 16-bit value (hi/lo pair) with addressing settings.
 *
 * - For start_addr: shows hex + decimal + absolute address (40001/30001/…)
 *   if `addressFormat === 'absolute'` per Modbus memory-area convention.
 * - For quantity / byte_count: shows hex + decimal only.
 */
function formatCombinedValue(
  hiRole: string,
  combined: number,
  opts: ParseOptions,
): string {
  const hex16 = '0x' + combined.toString(16).padStart(4, '0').toUpperCase();
  const dec = combined.toString(10);

  if (hiRole === 'start_addr_hi') {
    // Apply addressing settings.
    const baseOffset = opts.baseOffset ?? 0;
    const addrFormat = opts.addressFormat ?? 'relative';
    if (addrFormat === 'absolute') {
      // Modbus memory area mapping:
      //   FC 01/02 (coils/discrete) → 0x0000-0xFFFF maps to 1-9999
      //   FC 03 (holding)           → 40001-49999
      //   FC 04 (input)             → 30001-39999
      // We don't have FC here; show generic 40001-style for holding (most common).
      // The UI can refine via register map. Just apply baseOffset + 40001 offset.
      const abs = combined + baseOffset + 40001;
      return `${hex16} (${dec}) → ${abs}`;
    }
    // relative
    const shown = combined + baseOffset;
    return shown === combined
      ? `${hex16} (${dec})`
      : `${hex16} (${dec}) → ${shown}`;
  }

  // quantity / byte_count — just hex + decimal.
  return `${hex16} (${dec})`;
}

/**
 * Compute the raw value for a schema field (e.g. a 2-byte start address
 * becomes a number 0–65535).
 */
function computeFieldValue(
  field: SchemaField,
  bytes: number[],
  info: FunctionCodeInfo,
  isException: boolean,
): number | string {
  if (isException && field.role === 'exception_code') {
    return bytes[0] ?? 0;
  }
  if (bytes.length === 0) return '';
  if (field.role === 'start_addr_hi' || field.role === 'start_addr_lo') {
    // Will be combined into a 2-byte value by the caller via formatFieldValue.
    return bytes[0];
  }
  if (bytes.length === 1) return bytes[0];
  return bytesToHex(new Uint8Array(bytes));
}

/**
 * Format a field's display value, combining hi/lo pairs into a single value
 * where appropriate.
 */
function formatFieldValue(
  field: SchemaField,
  bytes: number[],
  info: FunctionCodeInfo,
  isException: boolean,
): string | undefined {
  if (isException && field.role === 'exception_code') {
    const code = bytes[0] ?? 0;
    return `0x${code.toString(16).padStart(2, '0').toUpperCase()} / ${exceptionCodeName(code)}`;
  }
  if (bytes.length === 0) return '';

  // For pairs (start_addr_hi/lo, quantity_hi/lo), combine into 16-bit.
  if (field.role === 'start_addr_hi' || field.role === 'quantity_hi') {
    // Combine with the next byte (which is the lo counterpart).
    // The caller has already laid out the schema so the next field is the lo.
    // Here we only have this field's bytes; we can't peek forward.
    // So instead, we format this byte as a hex value.
    return `0x${bytes[0].toString(16).padStart(2, '0').toUpperCase()}`;
  }
  if (field.role === 'start_addr_lo' || field.role === 'quantity_lo') {
    return `0x${bytes[0].toString(16).padStart(2, '0').toUpperCase()}`;
  }

  return bytesToHex(new Uint8Array(bytes));
}

/**
 * Compute the fixed size of a schema (sum of all `size` values, ignoring
 * variable `size === 0` fields). Returns `null` if the schema contains a
 * variable field (i.e. is not fully fixed).
 */
function schemaFixedSize(schema: SchemaField[]): number | null {
  let total = 0;
  for (const f of schema) {
    if (f.size === 0) return null;
    total += f.size;
  }
  return total;
}

/* ------------------------------------------------------------------ */
/* Stream parsing                                                     */
/* ------------------------------------------------------------------ */

/**
 * Parse a stream of one or more Modbus frames from a single buffer / string.
 *
 * Frame boundaries are determined as follows:
 *
 * - **ASCII**: split on `:` … CR-LF boundaries.
 * - **TCP**:   slice by MBAP length field.
 * - **RTU**:   scan from the start; at each position try every length
 *              `l` from `MIN_RTU_LEN` (4) up to `MAX_RTU_FRAME` (256) and
 *              emit a frame when `crc16(buf[p..p+l-3]) == buf[p+l-2..p+l-1]`.
 *              If no length matches at position `p`, advance by one byte
 *              (drift) and retry. This is the standard "no timing" fallback
 *              for raw RTU captures.
 *
 * @param input - Stream as `Uint8Array` or hex/ASCII string.
 * @param opts  - Parser options.
 * @returns Array of parsed frames. Frames that fail to parse are emitted
 *          with their status set accordingly.
 */
export function parseStream(
  input: Uint8Array | string,
  opts: ParseOptions = {},
): ParsedFrame[] {
  const protocol = opts.protocol ?? detectProtocol(input) ?? 'rtu';

  // Auto-enable `minimal` mode for large inputs unless the user explicitly
  // disabled it. This keeps interactive parsing (small pastes) at full
  // detail while ensuring multi-MB pcaps parse in well under a second.
  // The UI can call `parseFrame(rawBytes)` on individual frames for the
  // full byte-level breakdown when the user selects one.
  const inputSize =
    typeof input === 'string' ? input.length : input.length;
  const autoMinimal = opts.minimal === undefined && inputSize > STREAM_MINIMAL_THRESHOLD;
  const streamOpts: ParseOptions = autoMinimal ? { ...opts, minimal: true } : opts;

  if (protocol === 'ascii') return parseAsciiStream(input, streamOpts, !autoMinimal);
  if (protocol === 'tcp') return parseTcpStream(input, streamOpts, !autoMinimal);
  return parseRtuStream(input, streamOpts, !autoMinimal);
}

/**
 * Inputs larger than this many bytes are auto-parsed in `minimal` mode
 * (skipping per-byte tokenisation) to keep parse latency under a second
 * for multi-MB pcaps. Override per-call with `opts.minimal`.
 *
 * Request/response pairing is also skipped above this threshold, since the
 * O(N·256) scan dominates parse time on large streams. Call
 * {@link pairFrames} separately when you need pairing on a parsed stream.
 */
const STREAM_MINIMAL_THRESHOLD = 64 * 1024;

function parseAsciiStream(input: Uint8Array | string, opts: ParseOptions, doPair: boolean): ParsedFrame[] {
  const frames: ParsedFrame[] = [];
  if (typeof input === 'string') {
    // Split on ':' boundaries.
    let pos = 0;
    while (pos < input.length) {
      const colon = input.indexOf(':', pos);
      if (colon < 0) break;
      // Find the end (CRLF or next colon).
      let end = input.length;
      for (let i = colon + 1; i < input.length; i++) {
        const c = input.charCodeAt(i);
        if (c === 0x0d || c === 0x0a || c === 0x3a) {
          end = i;
          break;
        }
      }
      const slice = input.slice(colon, end);
      if (slice.length > 1) {
        frames.push(parseFrame(slice, opts));
      }
      pos = end;
      // Skip a single CRLF if present.
      if (pos < input.length && (input.charCodeAt(pos) === 0x0d || input.charCodeAt(pos) === 0x0a)) {
        pos++;
        if (pos < input.length && (input.charCodeAt(pos) === 0x0d || input.charCodeAt(pos) === 0x0a)) pos++;
      }
    }
  } else {
    // bytes input: scan for ':' (0x3A) … CRLF.
    let pos = 0;
    while (pos < input.length) {
      const colon = indexOfByte(input, 0x3a, pos);
      if (colon < 0) break;
      let end = input.length;
      for (let i = colon + 1; i < input.length; i++) {
        const b = input[i];
        if (b === 0x0d || b === 0x0a || b === 0x3a) {
          end = i;
          break;
        }
      }
      const slice = input.subarray(colon, end);
      if (slice.length > 1) {
        frames.push(parseFrame(slice, opts));
      }
      pos = end;
      if (pos < input.length && (input[pos] === 0x0d || input[pos] === 0x0a)) {
        pos++;
        if (pos < input.length && (input[pos] === 0x0d || input[pos] === 0x0a)) pos++;
      }
    }
  }
  if (doPair) pairFrames(frames);
  return frames;
}

function parseTcpStream(input: Uint8Array | string, opts: ParseOptions, doPair: boolean): ParsedFrame[] {
  const bytes = input instanceof Uint8Array ? input : toBytes(input);
  const frames: ParsedFrame[] = [];
  let pos = 0;
  while (pos + 6 <= bytes.length) {
    const protocolId = (bytes[pos + 2] << 8) | bytes[pos + 3];
    const length = (bytes[pos + 4] << 8) | bytes[pos + 5];
    if (protocolId !== 0) {
      // Drift one byte and retry.
      pos++;
      continue;
    }
    if (length < 2 || length > 260) {
      // Implausible length — drift.
      pos++;
      continue;
    }
    const frameEnd = pos + 6 + length;
    if (frameEnd > bytes.length) break; // truncated
    const slice = bytes.subarray(pos, frameEnd);
    frames.push(parseFrame(slice, opts));
    pos = frameEnd;
  }
  if (doPair) pairFrames(frames);
  return frames;
}

function parseRtuStream(input: Uint8Array | string, opts: ParseOptions, doPair: boolean): ParsedFrame[] {
  const bytes = input instanceof Uint8Array ? input : toBytes(input);
  const frames: ParsedFrame[] = [];
  const n = bytes.length;
  let pos = 0;
  while (pos < n) {
    const remaining = n - pos;
    if (remaining < MIN_RTU_LEN) break;

    // Compute incremental CRC for lengths 4..max and check for a match.
    let foundLen = -1;
    const maxLen = Math.min(MAX_RTU_FRAME, remaining);
    let crc = 0xffff;
    // CRC is computed over bytes[pos .. pos+len-3]; trailer is bytes[pos+len-2, pos+len-1].
    // We walk byte by byte, updating the CRC, and at each length >= MIN_RTU_LEN we
    // check whether the running CRC (over bytes[pos..pos+len-3]) matches the next 2 bytes.
    //
    // For length L, the CRC input is bytes[pos..pos+L-3] (i.e. L-2 bytes). The trailer
    // is bytes[pos+L-2] (lo) and bytes[pos+L-1] (hi).
    //
    // We iterate `i` from 0 (first CRC input byte) to maxLen-3 (last CRC input byte for
    // max length), and after each byte we test length = i+3 (CRC input = i+1 bytes, plus
    // 2 trailer bytes => frame length i+3). Skip until i+1 >= 2 (CRC input has >= 2 bytes
    // => length >= 4).
    for (let i = 0; i <= maxLen - 3; i++) {
      crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[pos + i]) & 0xff];
      // After consuming byte i, CRC input length is i+1 bytes (bytes[pos..pos+i]).
      // Frame length L = (i+1) + 2 = i+3.
      const L = i + 3;
      if (L < MIN_RTU_LEN) continue;
      if (L > maxLen) break;
      const lo = bytes[pos + L - 2];
      const hi = bytes[pos + L - 1];
      if ((crc & 0xff) === lo && (crc >>> 8) === hi) {
        foundLen = L;
        break;
      }
    }

    if (foundLen > 0) {
      const slice = bytes.subarray(pos, pos + foundLen);
      frames.push(parseFrame(slice, opts));
      pos += foundLen;
    } else {
      // Drift one byte (no frame found here).
      pos++;
    }
  }
  if (doPair) pairFrames(frames);
  return frames;
}

/**
 * Maximum number of frames ahead to scan when pairing a request with its
 * response. Bounded to keep `pairFrames` linear in stream size; 256 frames
 * is generous for typical half-duplex Modbus traffic where the response
 * immediately follows the request.
 */
const MAX_PAIR_DISTANCE = 256;

/**
 * Pair up request/response frames in a parsed stream.
 *
 * A request is paired with the first subsequent frame (within
 * {@link MAX_PAIR_DISTANCE} positions) that has the same slave address
 * (RTU/ASCII) or unit ID + transaction ID (TCP), and whose function code
 * matches the request's. Pairing is mutual — both frames get `pairedWith`
 * set to the other's index.
 *
 * Frames already paired are not re-paired.
 *
 * Exported so callers can run pairing on a previously-parsed stream (e.g.
 * after a large pcap has been parsed in `minimal` mode, where pairing is
 * skipped for performance).
 */
export function pairFrames(frames: ParsedFrame[]): void {
  const n = frames.length;
  for (let i = 0; i < n; i++) {
    const a = frames[i];
    if (a.pairedWith !== undefined) continue;
    if (a.direction === 'unknown') continue;
    const maxJ = Math.min(n, i + 1 + MAX_PAIR_DISTANCE);
    for (let j = i + 1; j < maxJ; j++) {
      const b = frames[j];
      if (b.pairedWith !== undefined) continue;
      if (b.direction === 'unknown') continue;
      if (a.direction === b.direction) continue;
      if (!framesMatch(a, b)) continue;
      a.pairedWith = j;
      b.pairedWith = i;
      break;
    }
  }
}

function framesMatch(a: ParsedFrame, b: ParsedFrame): boolean {
  if (a.protocol !== b.protocol) return false;
  if (a.functionCode !== b.functionCode) return false;
  if (a.protocol === 'tcp') {
    return a.unitId === b.unitId && a.transactionId === b.transactionId;
  }
  return a.slaveAddress === b.slaveAddress;
}

/* ------------------------------------------------------------------ */
/* Register extraction                                                */
/* ------------------------------------------------------------------ */

/**
 * Extract {@link RegisterValue}s from a parsed frame's data section.
 *
 * Applies the parser's `byteOrder` / `dataType` (or auto-detect) and an
 * optional register map.
 *
 * @param frame - A parsed frame (typically a response to a read FC).
 * @param opts  - Parser options used during parsing (for byteOrder/dataType).
 * @returns Array of register values, one per 1/2/4 registers depending on
 *          the data type.
 */
export function extractRegisters(
  frame: ParsedFrame,
  opts: ParseOptions = {},
): RegisterValue[] {
  // Find the data field in the frame.
  const dataField = frame.fields.find((f) => f.name === 'field.data' || f.name === 'field.read_data');
  if (!dataField || dataField.bytes.length < 2) return [];

  const bytes = dataField.bytes;
  // Look up the start address (if present) for absolute addressing.
  const startAddrField = frame.fields.find(
    (f) => f.name === 'field.start_address' || f.name === 'field.read_start_address',
  );
  const startAddr =
    startAddrField && typeof startAddrField.value === 'number'
      ? startAddrField.value
      : 0;

  const dataType: DataType = opts.dataType ?? 'uint16';
  const defaultOrder: ByteOrder = opts.byteOrder ?? 'ABCD';
  const map: RegisterMapEntry[] = opts.registerMap ?? [];

  const result: RegisterValue[] = [];
  const regSize = dataTypeSize(dataType);

  // Walk register by register.
  for (let i = 0; i + regSize * 2 - 1 < bytes.length || (regSize === 1 && i < bytes.length); i += regSize * 2) {
    if (i + regSize * 2 > bytes.length) break;
    const regBytes = bytes.slice(i, i + regSize * 2);
    const addr = startAddr + i / 2;

    // Check register map.
    const mapEntry = map.find((m) => m.address === addr);

    let order = defaultOrder;
    let type = dataType;
    if (mapEntry) {
      if (mapEntry.byteOrder) order = mapEntry.byteOrder;
      if (mapEntry.dataType) type = mapEntry.dataType;
    } else if (opts.autoDetectByteOrder && regBytes.length >= 4) {
      const detected = detectFloatByteOrder(regBytes);
      if (detected) order = detected;
    }

    const interpretations: RegisterValue['interpretations'] = [];
    // Always include the primary interpretation.
    interpretations.push({
      dataType: type,
      byteOrder: order,
      value: decodeRegister(regBytes, type, order),
    });
    // For 32/64-bit, also include all four byte orders as alternates.
    if (regBytes.length >= 4 && type !== 'ascii' && type !== 'bits') {
      const orders: ByteOrder[] = ['ABCD', 'DCBA', 'BADC', 'CDAB'];
      for (const o of orders) {
        if (o === order) continue;
        interpretations.push({
          dataType: type,
          byteOrder: o,
          value: decodeRegister(regBytes, type, o),
        });
      }
    }

    const rv: RegisterValue = {
      address: addr,
      rawBytes: regBytes,
      interpretations,
    };
    if (mapEntry) {
      rv.name = mapEntry.name;
      rv.unit = mapEntry.unit;
      const primary = interpretations[0];
      if (typeof primary.value === 'number') {
        let v = primary.value;
        if (mapEntry.scale !== undefined) v = v * mapEntry.scale;
        if (mapEntry.offset !== undefined) v = v + mapEntry.offset;
        rv.displayValue = formatValue(v, type, { unit: mapEntry.unit });
      } else {
        rv.displayValue = formatValue(primary.value, type, { unit: mapEntry.unit });
      }
    }
    result.push(rv);
  }

  return result;
}

/**
 * Number of registers spanned by a data type.
 */
function dataTypeSize(dt: DataType): number {
  switch (dt) {
    case 'uint16':
    case 'int16':
    case 'bits':
      return 1;
    case 'uint32':
    case 'int32':
    case 'float32':
      return 2;
    case 'float64':
      return 4;
    case 'ascii':
      return 1;
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Format the description of a function-code byte (e.g.
 * `"0x03 / Read Holding Registers"` or `"0x83 / Exception — 0x02 / Illegal Data Address"`).
 */
function formatFunctionDescription(fcByte: number): string {
  const hex = `0x${fcByte.toString(16).padStart(2, '0').toUpperCase()}`;
  if (fcByte & 0x80) {
    // Exception — but we don't have the exception code here; caller will add it.
    const base = fcByte & 0x7f;
    return `${hex} / Exception (${functionCodeName(base)})`;
  }
  return `${hex} / ${functionCodeName(fcByte)}`;
}

/**
 * Format bytes as a hex string (uppercase, no separators).
 */
export function bytesToHex(bytes: Uint8Array | number[]): string {
  const n = bytes.length;
  let out = '';
  for (let i = 0; i < n; i++) {
    out += (bytes[i] & 0xff).toString(16).padStart(2, '0').toUpperCase();
  }
  return out;
}

/**
 * Find the first occurrence of `target` in `bytes` starting at `from`.
 */
function indexOfByte(bytes: Uint8Array, target: number, from: number): number {
  for (let i = from; i < bytes.length; i++) {
    if (bytes[i] === target) return i;
  }
  return -1;
}

/**
 * Construct a `truncated` frame result.
 */
function makeTruncated(
  protocol: ModbusProtocol,
  bytes: Uint8Array,
  sourceLabel: string | undefined,
  timestamp: number | undefined,
  notes: string[],
): ParsedFrame {
  const tokens: ByteToken[] = [];
  for (let i = 0; i < bytes.length; i++) {
    tokens.push({ offset: i, value: bytes[i], role: 'unknown' });
  }
  notes.push('Frame too short to be a valid Modbus frame');
  const frame: ParsedFrame = {
    protocol,
    direction: 'unknown',
    status: 'truncated',
    raw: bytes,
    tokens,
    fields: [],
    isException: false,
    notes,
  };
  if (sourceLabel !== undefined) frame.sourceLabel = sourceLabel;
  if (timestamp !== undefined) frame.timestamp = timestamp;
  return frame;
}

/**
 * Shared empty arrays for `minimal`-mode frames — avoids per-frame
 * allocation of empty token / field arrays.
 */
const EMPTY_TOKENS: ByteToken[] = [] as ByteToken[];
const EMPTY_FIELDS: ParsedField[] = [] as ParsedField[];

/**
 * Build a minimal (no tokens / no fields) RTU {@link ParsedFrame}.
 *
 * Used by the stream parser's fast path; the UI can call `parseFrame` again
 * on the raw bytes to obtain full tokenisation.
 */
function makeMinimalRtuFrame(
  bytes: Uint8Array,
  fc: number,
  fcByte: number,
  isException: boolean,
  slaveAddress: number,
  crcStored: number,
  crcOk: boolean,
  direction: ModbusDirection,
  dataSection: Uint8Array,
  sourceLabel: string | undefined,
  timestamp: number | undefined,
): ParsedFrame {
  let status: ModbusFrameStatus;
  if (!crcOk) status = 'invalid_crc';
  else if (isException) status = 'exception';
  else if (!getFunctionCodeInfo(fc)) status = 'malformed';
  else status = 'valid';
  const frame: ParsedFrame = {
    protocol: 'rtu',
    direction,
    status,
    raw: bytes,
    tokens: EMPTY_TOKENS,
    fields: EMPTY_FIELDS,
    functionCode: fc,
    isException,
    slaveAddress,
    crc: crcStored,
    crcValid: crcOk,
  };
  if (isException) frame.exceptionCode = dataSection[0];
  if (sourceLabel !== undefined) frame.sourceLabel = sourceLabel;
  if (timestamp !== undefined) frame.timestamp = timestamp;
  // Avoid unused-variable warning for fcByte.
  void fcByte;
  return frame;
}

/**
 * Build a minimal (no tokens / no fields) ASCII {@link ParsedFrame}.
 */
function makeMinimalAsciiFrame(
  bytes: Uint8Array,
  fc: number,
  fcByte: number,
  isException: boolean,
  slaveAddress: number,
  lrcByte: number,
  lrcOk: boolean,
  direction: ModbusDirection,
  dataSection: Uint8Array,
  sourceLabel: string | undefined,
  timestamp: number | undefined,
): ParsedFrame {
  let status: ModbusFrameStatus;
  if (!lrcOk) status = 'invalid_lrc';
  else if (isException) status = 'exception';
  else if (!getFunctionCodeInfo(fc)) status = 'malformed';
  else status = 'valid';
  const frame: ParsedFrame = {
    protocol: 'ascii',
    direction,
    status,
    raw: bytes,
    tokens: EMPTY_TOKENS,
    fields: EMPTY_FIELDS,
    functionCode: fc,
    isException,
    slaveAddress,
    lrc: lrcByte,
    lrcValid: lrcOk,
  };
  if (isException) frame.exceptionCode = dataSection[0];
  if (sourceLabel !== undefined) frame.sourceLabel = sourceLabel;
  if (timestamp !== undefined) frame.timestamp = timestamp;
  void fcByte;
  return frame;
}

/**
 * Build a minimal (no tokens / no fields) TCP {@link ParsedFrame}.
 */
function makeMinimalTcpFrame(
  bytes: Uint8Array,
  fc: number,
  fcByte: number,
  isException: boolean,
  unitId: number,
  transactionId: number,
  direction: ModbusDirection,
  dataSection: Uint8Array,
  sourceLabel: string | undefined,
  timestamp: number | undefined,
): ParsedFrame {
  let status: ModbusFrameStatus;
  if (isException) status = 'exception';
  else if (!getFunctionCodeInfo(fc)) status = 'malformed';
  else status = 'valid';
  const frame: ParsedFrame = {
    protocol: 'tcp',
    direction,
    status,
    raw: bytes,
    tokens: EMPTY_TOKENS,
    fields: EMPTY_FIELDS,
    functionCode: fc,
    isException,
    unitId,
    transactionId,
  };
  if (isException) frame.exceptionCode = dataSection[0];
  if (sourceLabel !== undefined) frame.sourceLabel = sourceLabel;
  if (timestamp !== undefined) frame.timestamp = timestamp;
  void fcByte;
  return frame;
}

/* ------------------------------------------------------------------ */
/* CRC table (mirror of crc.ts for the streaming scanner)             */
/* ------------------------------------------------------------------ */

const CRC_TABLE: Uint16Array = (() => {
  const table = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
    table[i] = crc & 0xffff;
  }
  return table;
})();

/* Re-export lookup helpers for convenience. */
export { FUNCTION_CODES, EXCEPTION_CODES, getFunctionCodeInfo, getExceptionInfo };
export { applyByteOrder, decodeRegister, formatValue, detectFloatByteOrder };
export type { FunctionCodeInfo, SchemaField, ExceptionCodeInfo } from './function-codes';
export type { FormatValueOptions, BitOptions } from './register-decoder';
