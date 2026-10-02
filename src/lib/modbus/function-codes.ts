/**
 * @file Function-code schemas, exception codes, and lookup helpers.
 *
 * Schemas describe the byte layout of the *data* portion of a frame — that is,
 * everything between the function code byte and the CRC/LRC trailer (or, for
 * TCP, everything after the unit ID byte and function code byte).
 *
 * Each `SchemaField` corresponds to one or more bytes with a semantic role.
 * The parser uses schemas both to tokenise individual bytes (the `ByteToken`
 * array) and to group bytes into logical `ParsedField` objects.
 */

import type { ByteRole } from './types';

/* ------------------------------------------------------------------ */
/* Schema types                                                       */
/* ------------------------------------------------------------------ */

/**
 * Description of one logical byte run within a frame's data section.
 *
 * `size === 0` is a sentinel meaning "the rest of the data section" — used
 * for variable-length data blocks (e.g. read response payloads).
 */
export interface SchemaField {
  /** Semantic role for byte-token annotation. */
  role: ByteRole;
  /** Number of bytes this field spans. `0` = variable (rest of PDU). */
  size: number;
  /** i18n key, e.g. `field.start_address`. */
  field: string;
  /** Default English label. */
  label: string;
}

/**
 * Full description of a Modbus function code.
 */
export interface FunctionCodeInfo {
  /** The numeric FC. */
  code: number;
  /** Canonical English short name (e.g. `"Read Holding Registers"`). */
  name: string;
  /** i18n key, e.g. `fc.read_holding_registers`. */
  label: string;
  /** Schema of the data section of a request frame. */
  requestSchema: SchemaField[];
  /** Schema of the data section of a normal (non-exception) response frame. */
  responseSchema: SchemaField[];
  /** Schema of the data section of an exception response. */
  exceptionSchema: SchemaField[];
}

/* ------------------------------------------------------------------ */
/* Helpers used to keep schemas terse                                 */
/* ------------------------------------------------------------------ */

const startAddrHi = (field = 'field.start_address', label = 'Start Address'): SchemaField => ({
  role: 'start_addr_hi',
  size: 1,
  field,
  label,
});
const startAddrLo = (field = 'field.start_address', label = 'Start Address'): SchemaField => ({
  role: 'start_addr_lo',
  size: 1,
  field,
  label,
});
const quantityHi = (field = 'field.quantity', label = 'Quantity'): SchemaField => ({
  role: 'quantity_hi',
  size: 1,
  field,
  label,
});
const quantityLo = (field = 'field.quantity', label = 'Quantity'): SchemaField => ({
  role: 'quantity_lo',
  size: 1,
  field,
  label,
});
const byteCount = (field = 'field.byte_count', label = 'Byte Count'): SchemaField => ({
  role: 'byte_count',
  size: 1,
  field,
  label,
});
const dataVar = (field = 'field.data', label = 'Data'): SchemaField => ({
  role: 'data',
  size: 0,
  field,
  label,
});
const exceptionCode = (): SchemaField => ({
  role: 'exception_code',
  size: 1,
  field: 'field.exception_code',
  label: 'Exception Code',
});

const exceptionSchema: SchemaField[] = [exceptionCode()];

/* ------------------------------------------------------------------ */
/* Function-code table                                                */
/* ------------------------------------------------------------------ */

/**
 * Lookup table for all standard and well-known extended function codes.
 */
export const FUNCTION_CODES: Record<number, FunctionCodeInfo> = {
  /* 0x01 Read Coils */
  0x01: {
    code: 0x01,
    name: 'Read Coils',
    label: 'fc.read_coils',
    requestSchema: [startAddrHi(), startAddrLo(), quantityHi(), quantityLo()],
    responseSchema: [byteCount(), dataVar()],
    exceptionSchema,
  },
  /* 0x02 Read Discrete Inputs */
  0x02: {
    code: 0x02,
    name: 'Read Discrete Inputs',
    label: 'fc.read_discrete_inputs',
    requestSchema: [startAddrHi(), startAddrLo(), quantityHi(), quantityLo()],
    responseSchema: [byteCount(), dataVar()],
    exceptionSchema,
  },
  /* 0x03 Read Holding Registers */
  0x03: {
    code: 0x03,
    name: 'Read Holding Registers',
    label: 'fc.read_holding_registers',
    requestSchema: [startAddrHi(), startAddrLo(), quantityHi(), quantityLo()],
    responseSchema: [byteCount(), dataVar()],
    exceptionSchema,
  },
  /* 0x04 Read Input Registers */
  0x04: {
    code: 0x04,
    name: 'Read Input Registers',
    label: 'fc.read_input_registers',
    requestSchema: [startAddrHi(), startAddrLo(), quantityHi(), quantityLo()],
    responseSchema: [byteCount(), dataVar()],
    exceptionSchema,
  },
  /* 0x05 Write Single Coil — request == response (echo) */
  0x05: {
    code: 0x05,
    name: 'Write Single Coil',
    label: 'fc.write_single_coil',
    requestSchema: [
      startAddrHi('field.output_address', 'Output Address'),
      startAddrLo('field.output_address', 'Output Address'),
      { role: 'data', size: 1, field: 'field.output_value', label: 'Output Value (Hi)' },
      { role: 'data', size: 1, field: 'field.output_value', label: 'Output Value (Lo)' },
    ],
    responseSchema: [
      startAddrHi('field.output_address', 'Output Address'),
      startAddrLo('field.output_address', 'Output Address'),
      { role: 'data', size: 1, field: 'field.output_value', label: 'Output Value (Hi)' },
      { role: 'data', size: 1, field: 'field.output_value', label: 'Output Value (Lo)' },
    ],
    exceptionSchema,
  },
  /* 0x06 Write Single Register — request == response (echo) */
  0x06: {
    code: 0x06,
    name: 'Write Single Register',
    label: 'fc.write_single_register',
    requestSchema: [
      startAddrHi('field.register_address', 'Register Address'),
      startAddrLo('field.register_address', 'Register Address'),
      { role: 'data', size: 1, field: 'field.register_value', label: 'Register Value (Hi)' },
      { role: 'data', size: 1, field: 'field.register_value', label: 'Register Value (Lo)' },
    ],
    responseSchema: [
      startAddrHi('field.register_address', 'Register Address'),
      startAddrLo('field.register_address', 'Register Address'),
      { role: 'data', size: 1, field: 'field.register_value', label: 'Register Value (Hi)' },
      { role: 'data', size: 1, field: 'field.register_value', label: 'Register Value (Lo)' },
    ],
    exceptionSchema,
  },
  /* 0x07 Read Exception Status */
  0x07: {
    code: 0x07,
    name: 'Read Exception Status',
    label: 'fc.read_exception_status',
    requestSchema: [],
    responseSchema: [{ role: 'data', size: 1, field: 'field.exception_status', label: 'Exception Status' }],
    exceptionSchema,
  },
  /* 0x08 Diagnostics */
  0x08: {
    code: 0x08,
    name: 'Diagnostics',
    label: 'fc.diagnostics',
    requestSchema: [
      { role: 'sub_function', size: 1, field: 'field.sub_function', label: 'Sub-function (Hi)' },
      { role: 'sub_function', size: 1, field: 'field.sub_function', label: 'Sub-function (Lo)' },
      dataVar('field.sub_data', 'Sub Data'),
    ],
    responseSchema: [
      { role: 'sub_function', size: 1, field: 'field.sub_function', label: 'Sub-function (Hi)' },
      { role: 'sub_function', size: 1, field: 'field.sub_function', label: 'Sub-function (Lo)' },
      dataVar('field.sub_data', 'Sub Data'),
    ],
    exceptionSchema,
  },
  /* 0x0B Get Comm Event Counter */
  0x0b: {
    code: 0x0b,
    name: 'Get Comm Event Counter',
    label: 'fc.get_comm_event_counter',
    requestSchema: [],
    responseSchema: [
      { role: 'data', size: 1, field: 'field.status', label: 'Status (Hi)' },
      { role: 'data', size: 1, field: 'field.status', label: 'Status (Lo)' },
      { role: 'data', size: 1, field: 'field.event_count', label: 'Event Count (Hi)' },
      { role: 'data', size: 1, field: 'field.event_count', label: 'Event Count (Lo)' },
    ],
    exceptionSchema,
  },
  /* 0x0C Get Comm Event Log */
  0x0c: {
    code: 0x0c,
    name: 'Get Comm Event Log',
    label: 'fc.get_comm_event_log',
    requestSchema: [],
    responseSchema: [
      byteCount(),
      { role: 'data', size: 1, field: 'field.status', label: 'Status (Hi)' },
      { role: 'data', size: 1, field: 'field.status', label: 'Status (Lo)' },
      { role: 'data', size: 1, field: 'field.event_count', label: 'Event Count (Hi)' },
      { role: 'data', size: 1, field: 'field.event_count', label: 'Event Count (Lo)' },
      { role: 'data', size: 1, field: 'field.message_count', label: 'Message Count (Hi)' },
      { role: 'data', size: 1, field: 'field.message_count', label: 'Message Count (Lo)' },
      dataVar('field.events', 'Events'),
    ],
    exceptionSchema,
  },
  /* 0x0F Write Multiple Coils */
  0x0f: {
    code: 0x0f,
    name: 'Write Multiple Coils',
    label: 'fc.write_multiple_coils',
    requestSchema: [
      startAddrHi(),
      startAddrLo(),
      quantityHi(),
      quantityLo(),
      byteCount(),
      dataVar(),
    ],
    responseSchema: [startAddrHi(), startAddrLo(), quantityHi(), quantityLo()],
    exceptionSchema,
  },
  /* 0x10 Write Multiple Registers */
  0x10: {
    code: 0x10,
    name: 'Write Multiple Registers',
    label: 'fc.write_multiple_registers',
    requestSchema: [
      startAddrHi(),
      startAddrLo(),
      quantityHi(),
      quantityLo(),
      byteCount(),
      dataVar(),
    ],
    responseSchema: [startAddrHi(), startAddrLo(), quantityHi(), quantityLo()],
    exceptionSchema,
  },
  /* 0x11 Report Slave ID */
  0x11: {
    code: 0x11,
    name: 'Report Slave ID',
    label: 'fc.report_slave_id',
    requestSchema: [],
    responseSchema: [
      byteCount(),
      dataVar('field.slave_id_data', 'Slave ID / Run Indicator'),
    ],
    exceptionSchema,
  },
  /* 0x14 Read File Record */
  0x14: {
    code: 0x14,
    name: 'Read File Record',
    label: 'fc.read_file_record',
    requestSchema: [byteCount(), dataVar('field.sub_requests', 'Sub-Requests')],
    responseSchema: [byteCount(), dataVar('field.sub_responses', 'Sub-Responses')],
    exceptionSchema,
  },
  /* 0x15 Write File Record */
  0x15: {
    code: 0x15,
    name: 'Write File Record',
    label: 'fc.write_file_record',
    requestSchema: [byteCount(), dataVar('field.sub_requests', 'Sub-Requests')],
    responseSchema: [byteCount(), dataVar('field.sub_responses', 'Sub-Responses')],
    exceptionSchema,
  },
  /* 0x16 Mask Write Register */
  0x16: {
    code: 0x16,
    name: 'Mask Write Register',
    label: 'fc.mask_write_register',
    requestSchema: [
      startAddrHi('field.reference_address', 'Reference Address'),
      startAddrLo('field.reference_address', 'Reference Address'),
      { role: 'data', size: 1, field: 'field.and_mask', label: 'AND Mask (Hi)' },
      { role: 'data', size: 1, field: 'field.and_mask', label: 'AND Mask (Lo)' },
      { role: 'data', size: 1, field: 'field.or_mask', label: 'OR Mask (Hi)' },
      { role: 'data', size: 1, field: 'field.or_mask', label: 'OR Mask (Lo)' },
    ],
    responseSchema: [
      startAddrHi('field.reference_address', 'Reference Address'),
      startAddrLo('field.reference_address', 'Reference Address'),
      { role: 'data', size: 1, field: 'field.and_mask', label: 'AND Mask (Hi)' },
      { role: 'data', size: 1, field: 'field.and_mask', label: 'AND Mask (Lo)' },
      { role: 'data', size: 1, field: 'field.or_mask', label: 'OR Mask (Hi)' },
      { role: 'data', size: 1, field: 'field.or_mask', label: 'OR Mask (Lo)' },
    ],
    exceptionSchema,
  },
  /* 0x17 Read/Write Multiple Registers */
  0x17: {
    code: 0x17,
    name: 'Read/Write Multiple Registers',
    label: 'fc.read_write_multiple_registers',
    requestSchema: [
      startAddrHi('field.read_start_address', 'Read Start Address'),
      startAddrLo('field.read_start_address', 'Read Start Address'),
      quantityHi('field.read_quantity', 'Read Quantity'),
      quantityLo('field.read_quantity', 'Read Quantity'),
      startAddrHi('field.write_start_address', 'Write Start Address'),
      startAddrLo('field.write_start_address', 'Write Start Address'),
      quantityHi('field.write_quantity', 'Write Quantity'),
      quantityLo('field.write_quantity', 'Write Quantity'),
      byteCount('field.write_byte_count', 'Write Byte Count'),
      dataVar('field.write_data', 'Write Data'),
    ],
    responseSchema: [byteCount(), dataVar('field.read_data', 'Read Data')],
    exceptionSchema,
  },
  /* 0x18 Read FIFO Queue */
  0x18: {
    code: 0x18,
    name: 'Read FIFO Queue',
    label: 'fc.read_fifo_queue',
    requestSchema: [
      startAddrHi('field.fifo_pointer_address', 'FIFO Pointer Address'),
      startAddrLo('field.fifo_pointer_address', 'FIFO Pointer Address'),
    ],
    responseSchema: [
      { role: 'quantity_hi', size: 1, field: 'field.byte_count', label: 'Byte Count (Hi)' },
      { role: 'quantity_lo', size: 1, field: 'field.byte_count', label: 'Byte Count (Lo)' },
      { role: 'data', size: 1, field: 'field.fifo_count', label: 'FIFO Count (Hi)' },
      { role: 'data', size: 1, field: 'field.fifo_count', label: 'FIFO Count (Lo)' },
      dataVar('field.fifo_values', 'FIFO Values'),
    ],
    exceptionSchema,
  },
  /* 0x2B Encapsulated Interface Transport (MEI) */
  0x2b: {
    code: 0x2b,
    name: 'Encapsulated Interface Transport',
    label: 'fc.encapsulated_interface_transport',
    requestSchema: [
      { role: 'mei_type', size: 1, field: 'field.mei_type', label: 'MEI Type' },
      dataVar('field.mei_data', 'MEI Data'),
    ],
    responseSchema: [
      { role: 'mei_type', size: 1, field: 'field.mei_type', label: 'MEI Type' },
      dataVar('field.mei_data', 'MEI Data'),
    ],
    exceptionSchema,
  },
};

/* ------------------------------------------------------------------ */
/* Exception codes                                                    */
/* ------------------------------------------------------------------ */

/**
 * Description of a Modbus exception code.
 */
export interface ExceptionCodeInfo {
  code: number;
  name: string;
  /** i18n key. */
  label: string;
  /** Human-readable explanation. */
  description: string;
}

/**
 * Lookup table for Modbus exception codes 0x01–0x0B.
 */
export const EXCEPTION_CODES: Record<number, ExceptionCodeInfo> = {
  0x01: {
    code: 0x01,
    name: 'Illegal Function',
    label: 'exception.illegal_function',
    description:
      'The function code received in the request is not an allowable action for the server.',
  },
  0x02: {
    code: 0x02,
    name: 'Illegal Data Address',
    label: 'exception.illegal_data_address',
    description:
      'The data address received in the request is not an allowable address for the server.',
  },
  0x03: {
    code: 0x03,
    name: 'Illegal Data Value',
    label: 'exception.illegal_data_value',
    description:
      'The value contained in the request data field is not an allowable value for the server.',
  },
  0x04: {
    code: 0x04,
    name: 'Slave Device Failure',
    label: 'exception.slave_device_failure',
    description:
      'An unrecoverable error occurred while the server was attempting to perform the requested action.',
  },
  0x05: {
    code: 0x05,
    name: 'Acknowledge',
    label: 'exception.acknowledge',
    description:
      'The server has accepted the request and is processing it, but a long duration of time will be required.',
  },
  0x06: {
    code: 0x06,
    name: 'Slave Device Busy',
    label: 'exception.slave_device_busy',
    description:
      'The server is engaged in processing a long-duration program command.',
  },
  0x08: {
    code: 0x08,
    name: 'Memory Parity Error',
    label: 'exception.memory_parity_error',
    description:
      'The server attempted to read record file, but detected a parity error in the memory.',
  },
  0x0a: {
    code: 0x0a,
    name: 'Gateway Path Unavailable',
    label: 'exception.gateway_path_unavailable',
    description:
      'The gateway was unable to allocate an internal communication path from the input port to the output port for processing the request.',
  },
  0x0b: {
    code: 0x0b,
    name: 'Gateway Target Device Failed to Respond',
    label: 'exception.gateway_target_device_failed_to_respond',
    description:
      'No response was obtained from the target device. Usually means the device is not present on the network.',
  },
};

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Look up the {@link FunctionCodeInfo} for a numeric function code.
 *
 * The FC may include the exception high bit (0x80); the lookup will still
 * resolve to the base FC, since exception responses reuse the base schema.
 *
 * @param fc - Function code byte (0x00–0xFF).
 * @returns The info, or `undefined` for an unknown code.
 */
export function getFunctionCodeInfo(fc: number): FunctionCodeInfo | undefined {
  return FUNCTION_CODES[fc & 0x7f];
}

/**
 * Look up the {@link ExceptionCodeInfo} for an exception code.
 */
export function getExceptionInfo(ec: number): ExceptionCodeInfo | undefined {
  return EXCEPTION_CODES[ec];
}

/**
 * Return the English short name for a function code, or `"Unknown (0xNN)"`.
 */
export function functionCodeName(fc: number): string {
  const info = getFunctionCodeInfo(fc);
  if (info) return info.name;
  return `Unknown (0x${(fc & 0xff).toString(16).padStart(2, '0').toUpperCase()})`;
}

/**
 * Return the English name for an exception code, or `"Unknown (0xNN)"`.
 */
export function exceptionCodeName(ec: number): string {
  const info = getExceptionInfo(ec);
  if (info) return info.name;
  return `Unknown (0x${(ec & 0xff).toString(16).padStart(2, '0').toUpperCase()})`;
}
