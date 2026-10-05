/**
 * @file i18n/dictionaries/en.ts
 * @description English (canonical) dictionary for the Modbus Analyzer PWA.
 *
 * This is the source-of-truth set of keys; `ru.ts` and `zh.ts` mirror this
 * key set with localized values. Missing keys in other locales fall back to
 * the values defined here.
 *
 * Terminology follows the official Modbus Application Protocol Spec v1.1b3
 * and common industry usage (e.g. "Slave Address", "Function Code", "Holding
 * Registers"). Function codes and exception codes use the names defined in
 * the spec.
 */
import type { Dictionary } from '../types';

export const en: Dictionary = {
  // ---- App / UI chrome -------------------------------------------------
  'app.title': 'Modbus Analyzer',
  'app.subtitle': 'Parse, inspect and build Modbus RTU/ASCII/TCP traffic',
  'app.tab.parse': 'Parse',
  'app.tab.builder': 'Builder',
  'app.tab.timeline': 'Timeline',
  'app.tab.settings': 'Settings',

  // ---- Input controls --------------------------------------------------
  'input.paste_hex': 'Paste Hex',
  'input.paste_ascii': 'Paste ASCII',
  'input.upload_file': 'Upload File',
  'input.upload_pcap': 'Upload PCAP',
  'input.clear': 'Clear',
  'input.parse': 'Parse',
  'input.sample_data': 'Sample Data',
  'input.drag_drop': 'Drag & drop a hex dump or .pcap file here',

  // ---- Theme selector --------------------------------------------------
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'theme.system': 'System',
  'theme.high_contrast': 'High Contrast',
  'theme.custom': 'Custom',
  'theme.load_file': 'Load Theme File',

  // ---- Locale selector -------------------------------------------------
  'locale.label': 'Language',

  // ---- Export menu -----------------------------------------------------
  'export.csv': 'Export CSV',
  'export.json': 'Export JSON',
  'export.pdf': 'Export PDF',

  // ---- Filter panel ----------------------------------------------------
  'filter.title': 'Filters',
  'filter.add_rule': 'Add Rule',
  'filter.apply': 'Apply',
  'filter.clear': 'Clear',
  'filter.and': 'AND',
  'filter.or': 'OR',
  'filter.presets': 'Presets',
  'filter.field.station': 'Station',
  'filter.field.function': 'Function',
  'filter.field.register': 'Register',
  'filter.field.value': 'Value',
  'filter.field.direction': 'Direction',
  'filter.field.status': 'Status',
  'filter.op.equals': 'equals',
  'filter.op.contains': 'contains',
  'filter.op.gt': 'greater than',
  'filter.op.lt': 'less than',
  'filter.op.regex': 'regex',

  // ---- Parser options --------------------------------------------------
  'options.byte_order': 'Byte Order',
  'options.data_type': 'Data Type',
  'options.address_base': 'Address Base',
  'options.address_format': 'Address Format',
  'options.absolute': 'Absolute',
  'options.relative': 'Relative',
  'options.register_map': 'Register Map',
  'options.load_map': 'Load Map',

  // ---- Frame builder ---------------------------------------------------
  'builder.title': 'Frame Builder',
  'builder.protocol': 'Protocol',
  'builder.slave': 'Slave Address',
  'builder.function': 'Function Code',
  'builder.start_addr': 'Start Address',
  'builder.quantity': 'Quantity',
  'builder.values': 'Values',
  'builder.output': 'Output',
  'builder.copy': 'Copy',
  'builder.exception': 'Exception',
  'builder.exception_code': 'Exception Code',

  // ---- Frame status ----------------------------------------------------
  'frame.valid': 'Valid',
  'frame.invalid_crc': 'Invalid CRC',
  'frame.invalid_lrc': 'Invalid LRC',
  'frame.truncated': 'Truncated',
  'frame.malformed': 'Malformed',
  'frame.exception': 'Exception Response',

  // ---- Direction -------------------------------------------------------
  'direction.request': 'Request',
  'direction.response': 'Response',
  'direction.unknown': 'Unknown',

  // ---- Pane labels -----------------------------------------------------
  'pane.list': 'Frame List',
  'pane.details': 'Frame Details',
  'pane.bytes': 'Bytes',

  // ---- Pairing (request/response) --------------------------------------
  'pairing.linked': 'Linked',
  'pairing.unpaired': 'Unpaired',

  // ---- Timeline --------------------------------------------------------
  'timeline.title': 'Timeline',
  'timeline.master': 'Master',
  'timeline.slave': 'Slave',
  'timeline.request': 'Request',
  'timeline.response': 'Response',

  // ---- Memory block types ----------------------------------------------
  'memory.coil': 'Coil',
  'memory.discrete_input': 'Discrete Input',
  'memory.input_register': 'Input Register',
  'memory.holding_register': 'Holding Register',

  // ---- Function codes (Modbus spec) ------------------------------------
  'fc.01': 'Read Coils',
  'fc.02': 'Read Discrete Inputs',
  'fc.03': 'Read Holding Registers',
  'fc.04': 'Read Input Registers',
  'fc.05': 'Write Single Coil',
  'fc.06': 'Write Single Register',
  'fc.07': 'Read Exception Status',
  'fc.08': 'Diagnostics',
  'fc.09': 'Get Comm Event Counter',
  'fc.10': 'Get Comm Event Log',
  'fc.0B': 'Get Comm Event Counter (Legacy)',
  'fc.0C': 'Get Comm Event Log (Legacy)',
  'fc.11': 'Report Slave ID',
  'fc.12': 'Report Slave ID (Legacy)',
  'fc.14': 'Read File Record',
  'fc.15': 'Write File Record',
  'fc.16': 'Mask Write Register',
  'fc.17': 'Read/Write Multiple Registers',
  'fc.18': 'Read FIFO Queue',
  'fc.2B': 'Encapsulated Interface Transport (MEI)',

  // ---- Exception codes (Modbus spec) -----------------------------------
  'exception.01': 'Illegal Function',
  'exception.02': 'Illegal Data Address',
  'exception.03': 'Illegal Data Value',
  'exception.04': 'Slave Device Failure',
  'exception.05': 'Acknowledge',
  'exception.06': 'Slave Device Busy',
  'exception.07': 'Negative Acknowledge',
  'exception.08': 'Memory Parity Error',
  'exception.09': 'Gateway Path Unavailable',
  'exception.0A': 'Gateway Target Device Failed to Respond',
  'exception.0B': 'Unknown Exception',

  // ---- Field labels ----------------------------------------------------
  'field.slave_address': 'Slave Address',
  'field.unit_id': 'Unit ID',
  'field.function_code': 'Function Code',
  'field.start_address': 'Start Address',
  'field.quantity': 'Quantity',
  'field.byte_count': 'Byte Count',
  'field.data': 'Data',
  'field.crc': 'CRC',
  'field.lrc': 'LRC',
  'field.mbap_transaction': 'Transaction ID',
  'field.mbap_protocol': 'Protocol ID',
  'field.mbap_length': 'Length',
  'field.exception_code': 'Exception Code',
  'field.sub_function': 'Sub-function',
  'field.mei_type': 'MEI Type',
};
