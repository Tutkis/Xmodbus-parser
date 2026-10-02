/**
 * @file Modbus parser — core type definitions.
 *
 * Pure TypeScript types shared across all modules of the `@/lib/modbus`
 * package. No runtime code lives here (only `const enum`s are emitted as
 * values — but we use plain `enum` so they remain real values at runtime,
 * useful for reverse-lookups and the React DevTools).
 */

/* ------------------------------------------------------------------ */
/* Protocol / direction / status                                      */
/* ------------------------------------------------------------------ */

/**
 * Wire protocol variant of a Modbus frame.
 *
 * - `rtu`   — binary, RTU over serial, CRC-16 protected
 * - `ascii` — ASCII hex encoded, LRC-8 protected, framed with `:` … CRLF
 * - `tcp`   — TCP/IP with MBAP header, no checksum
 */
export type ModbusProtocol = 'rtu' | 'ascii' | 'tcp';

/**
 * Direction of a frame relative to the master.
 *
 * `unknown` is used when the parser cannot disambiguate (e.g. an 8-byte echo
 * of a Write Single Register request is byte-identical to its response).
 */
export type ModbusDirection = 'request' | 'response' | 'unknown';

/**
 * Outcome of validating a frame.
 *
 * - `valid`         — checksum OK (or TCP, which has no checksum), structure parseable
 * - `invalid_crc`   — RTU CRC mismatch
 * - `invalid_lrc`   — ASCII LRC mismatch
 * - `truncated`     — fewer bytes than minimum frame size
 * - `malformed`     — structure does not match any known FC schema
 * - `exception`     — valid Modbus exception response (FC high bit set)
 */
export type ModbusFrameStatus =
  | 'valid'
  | 'invalid_crc'
  | 'invalid_lrc'
  | 'truncated'
  | 'malformed'
  | 'exception';

/* ------------------------------------------------------------------ */
/* Function codes                                                     */
/* ------------------------------------------------------------------ */

/**
 * Standard & well-known extended Modbus function codes.
 *
 * Exception responses set the high bit (0x80 + FC); those are typed via
 * `ExceptionFunctionCode` below.
 */
export enum FunctionCode {
  ReadCoils = 0x01,
  ReadDiscreteInputs = 0x02,
  ReadHoldingRegisters = 0x03,
  ReadInputRegisters = 0x04,
  WriteSingleCoil = 0x05,
  WriteSingleRegister = 0x06,
  ReadExceptionStatus = 0x07,
  Diagnostics = 0x08,
  GetCommEventCounter = 0x0b,
  GetCommEventLog = 0x0c,
  WriteMultipleCoils = 0x0f,
  WriteMultipleRegisters = 0x10,
  ReportSlaveId = 0x11,
  ReadFileRecord = 0x14,
  WriteFileRecord = 0x15,
  MaskWriteRegister = 0x16,
  ReadWriteMultipleRegisters = 0x17,
  ReadFifoQueue = 0x18,
  EncapsulatedInterfaceTransport = 0x2b,
}

/**
 * Modbus exception codes (per spec section 7).
 */
export enum ExceptionCode {
  IllegalFunction = 0x01,
  IllegalDataAddress = 0x02,
  IllegalDataValue = 0x03,
  SlaveDeviceFailure = 0x04,
  Acknowledge = 0x05,
  SlaveDeviceBusy = 0x06,
  /** 0x07 is reserved / NAK in some vendor extensions — not in core spec */
  MemoryParityError = 0x08,
  /** 0x09 is reserved */
  GatewayPathUnavailable = 0x0a,
  GatewayTargetDeviceFailedToRespond = 0x0b,
}

/* ------------------------------------------------------------------ */
/* Register interpretation                                            */
/* ------------------------------------------------------------------ */

/**
 * Byte order convention for multi-register values.
 *
 * For a 32-bit value stored in two registers R1 (high) and R2 (low), each
 * containing bytes [Hi, Lo]:
 *
 * | Order | Memory layout | Notes                              |
 * |-------|---------------|------------------------------------|
 * | ABCD  | R1.Hi R1.Lo R2.Hi R2.Lo | big-endian (default)     |
 * | DCBA  | R2.Lo R2.Hi R1.Lo R1.Hi | little-endian            |
 * | BADC  | R1.Lo R1.Hi R2.Lo R2.Hi | byte-swap within register|
 * | CDAB  | R2.Hi R2.Lo R1.Hi R1.Lo | register-swap            |
 */
export type ByteOrder = 'ABCD' | 'DCBA' | 'BADC' | 'CDAB';

/**
 * Interpreted data type for one or more consecutive registers.
 */
export type DataType =
  | 'uint16'
  | 'int16'
  | 'uint32'
  | 'int32'
  | 'float32'
  | 'float64'
  | 'bits'
  | 'ascii';

/* ------------------------------------------------------------------ */
/* Per-byte tokenisation                                              */
/* ------------------------------------------------------------------ */

/**
 * Semantic role of a single byte within a Modbus frame.
 *
 * Used by the byte-level visualiser in the UI to colour / label bytes.
 */
export type ByteRole =
  | 'address'
  | 'unit_id'
  | 'function'
  | 'exception_flag'
  | 'exception_code'
  | 'start_addr_hi'
  | 'start_addr_lo'
  | 'quantity_hi'
  | 'quantity_lo'
  | 'byte_count'
  | 'data'
  | 'crc_lo'
  | 'crc_hi'
  | 'lrc'
  | 'mbap_transaction_hi'
  | 'mbap_transaction_lo'
  | 'mbap_protocol_hi'
  | 'mbap_protocol_lo'
  | 'mbap_length_hi'
  | 'mbap_length_lo'
  | 'sub_function'
  | 'sub_data'
  | 'mei_type'
  | 'mei_data'
  | 'unknown';

/**
 * A single byte annotated with its semantic role inside a frame.
 */
export interface ByteToken {
  /** Position of this byte within the raw frame (0-indexed). */
  offset: number;
  /** Raw value 0–255. */
  value: number;
  /** Semantic role. */
  role: ByteRole;
  /** i18n key for a human-readable field name. */
  field?: string;
  /** Optional detail (e.g. `"0x03 / Read Holding Registers"`). */
  description?: string;
}

/* ------------------------------------------------------------------ */
/* Logical fields & parsed frame                                      */
/* ------------------------------------------------------------------ */

/**
 * A logical field spanning one or more bytes (e.g. "Start Address").
 */
export interface ParsedField {
  /** i18n key, e.g. `field.slave_address`. */
  name: string;
  /** Default English label. */
  label: string;
  /** Inclusive start offset within the raw frame. */
  startOffset: number;
  /** Exclusive end offset within the raw frame. */
  endOffset: number;
  /** Raw value (number for numeric fields, string for ASCII / unknown). */
  value: number | string;
  /** Formatted value for display, e.g. `"0x03 / Read Holding Registers"`. */
  displayValue?: string;
  /** Raw bytes of this field. */
  bytes: number[];
}

/**
 * Result of parsing a single Modbus frame.
 */
export interface ParsedFrame {
  /** Wire protocol. */
  protocol: ModbusProtocol;
  /** Best-effort direction (request/response/unknown). */
  direction: ModbusDirection;
  /** Validation status. */
  status: ModbusFrameStatus;
  /** Raw frame bytes (for ASCII this is the decoded binary, not the ASCII hex). */
  raw: Uint8Array;
  /** Per-byte semantic tokens (always `raw.length` entries). */
  tokens: ByteToken[];
  /** Logical fields. */
  fields: ParsedField[];
  /** Function code (low 7 bits; high bit captured by `isException`). */
  functionCode?: number;
  /** True if this is an exception response (FC high bit set). */
  isException: boolean;
  /** Exception code if `isException`. */
  exceptionCode?: number;
  /** Slave address (RTU/ASCII). */
  slaveAddress?: number;
  /** Unit ID (TCP). */
  unitId?: number;
  /** MBAP transaction ID (TCP). */
  transactionId?: number;
  /** Computed CRC-16 (RTU). */
  crc?: number;
  /** Whether the trailing CRC matched (RTU). */
  crcValid?: boolean;
  /** Computed LRC-8 (ASCII). */
  lrc?: number;
  /** Whether the trailing LRC matched (ASCII). */
  lrcValid?: boolean;
  /** Epoch ms (from pcap timestamp, or `Date.now()` for pasted input). */
  timestamp?: number;
  /** Source label, e.g. `"pasted"`, `"pcap:flow1"`. */
  sourceLabel?: string;
  /** Index of the paired frame (request ↔ response) within a parsed stream. */
  pairedWith?: number;
  /** Free-form notes / warnings emitted by the parser. */
  notes?: string[];
}

/**
 * A register value with one or more interpretations.
 */
export interface RegisterValue {
  /** 0-based absolute register address. */
  address: number;
  /** Raw bytes (2, 4, or 8 typically). */
  rawBytes: number[];
  /** Multiple interpretations across data types / byte orders. */
  interpretations: Array<{
    dataType: DataType;
    byteOrder: ByteOrder;
    value: number | string | boolean[];
  }>;
  /** If a `RegisterMapEntry` matched, attached metadata. */
  name?: string;
  /** Engineering unit, e.g. `°C`. */
  unit?: string;
  /** Display value with scale/offset/unit applied. */
  displayValue?: string;
}

/* ------------------------------------------------------------------ */
/* Register map                                                       */
/* ------------------------------------------------------------------ */

/**
 * A single entry in a register map (vendor / device specific naming).
 */
export interface RegisterMapEntry {
  /** 0-based absolute register address. */
  address: number;
  /** Human-readable name, e.g. `"Battery Voltage"`. */
  name: string;
  /** Engineering unit, e.g. `°C`, `bar`. */
  unit?: string;
  /** Multiply raw value by `scale`, then add `offset`. */
  scale?: number;
  /** Added after scaling. */
  offset?: number;
  /** Data type override. */
  dataType?: DataType;
  /** Byte order override. */
  byteOrder?: ByteOrder;
  /** Number of registers this entry spans (default 1). */
  size?: number;
}

/* ------------------------------------------------------------------ */
/* Parser options                                                     */
/* ------------------------------------------------------------------ */

/**
 * Options accepted by `parseFrame` / `parseStream`.
 */
export interface ParseOptions {
  /** Force a protocol; otherwise auto-detect. */
  protocol?: ModbusProtocol;
  /** Force a direction; otherwise heuristic. */
  direction?: ModbusDirection;
  /** Byte order for register interpretation (default `ABCD`). */
  byteOrder?: ByteOrder;
  /** Data type for register interpretation (default `uint16`). */
  dataType?: DataType;
  /** Try to auto-detect byte order via float sanity heuristic. */
  autoDetectByteOrder?: boolean;
  /** Display offset base: 0 (absolute) or 1 (PLC-style 40001+). */
  baseOffset?: 0 | 1;
  /** Address display format. */
  addressFormat?: 'absolute' | 'relative';
  /** Register map for naming / scaling. */
  registerMap?: RegisterMapEntry[];
  /** Source label attached to every parsed frame. */
  sourceLabel?: string;
  /** Timestamp (ms epoch) attached to every parsed frame. */
  timestamp?: number;
  /**
   * If `true`, skip per-byte tokenisation and logical-field extraction.
   *
   * The returned {@link ParsedFrame} will have empty `tokens` and `fields`
   * arrays, but all scalar fields (`functionCode`, `slaveAddress`,
   * `unitId`, `transactionId`, `direction`, `status`, `crcValid`,
   * `lrcValid`, `isException`, `exceptionCode`) are still populated.
   *
   * Use this for high-throughput stream parsing (e.g. 10 MB pcaps) and
   * call `parseFrame(rawBytes)` again on individual frames when full
   * detail is needed for display.
   *
   * Default: `false` (full tokenisation).
   */
  minimal?: boolean;
}
