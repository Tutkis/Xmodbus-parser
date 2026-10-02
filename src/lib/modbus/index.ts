/**
 * @file Modbus parser library — public entry point.
 *
 * Pure-TypeScript, zero-dependency Modbus RTU / ASCII / TCP parser,
 * tokeniser, register decoder, and frame builder. Suitable for static
 * browser deployment (PWA).
 *
 * @example Parse a single RTU frame from a hex string
 * ```ts
 * import { parseFrame } from '@/lib/modbus';
 *
 * const frame = parseFrame('01 03 00 00 00 01 84 0A');
 * console.log(frame.status);        // 'valid'
 * console.log(frame.functionCode);  // 3
 * console.log(frame.direction);     // 'request'
 * console.log(frame.fields.map(f => f.label));
 * ```
 *
 * @example Parse a stream and pair request/response
 * ```ts
 * import { parseStream } from '@/lib/modbus';
 * const frames = parseStream(hexDump, { protocol: 'rtu' });
 * frames.forEach((f, i) => console.log(i, f.direction, f.pairedWith));
 * ```
 */

/* Types */
export type {
  ModbusProtocol,
  ModbusDirection,
  ModbusFrameStatus,
  ByteOrder,
  DataType,
  ByteRole,
  ByteToken,
  ParsedField,
  ParsedFrame,
  RegisterValue,
  RegisterMapEntry,
  ParseOptions,
} from './types';

export { FunctionCode, ExceptionCode } from './types';

/* Checksums */
export { crc16, verifyCrc, appendCrc } from './crc';
export { lrc8, verifyLrc, appendLrc } from './lrc';

/* Function-code & exception tables */
export {
  FUNCTION_CODES,
  EXCEPTION_CODES,
  getFunctionCodeInfo,
  getExceptionInfo,
  functionCodeName,
  exceptionCodeName,
} from './function-codes';
export type {
  SchemaField,
  FunctionCodeInfo,
  ExceptionCodeInfo,
} from './function-codes';

/* Register decoder */
export {
  applyByteOrder,
  decodeRegister,
  decodeBits,
  decodeAscii,
  formatValue,
  detectFloatByteOrder,
} from './register-decoder';
export type { FormatValueOptions, BitOptions } from './register-decoder';

/* Parser */
export {
  parseFrame,
  parseStream,
  pairFrames,
  detectProtocol,
  inferDirection,
  toBytes,
  hexStringToBytes,
  asciiStringToBytes,
  bytesToHex,
  extractRegisters,
} from './parser';

/* Builder */
export {
  buildRtuFrame,
  buildAsciiFrame,
  buildTcpFrame,
  buildFrame,
  packCoils,
} from './builder';
export type { BuildOptions } from './builder';
