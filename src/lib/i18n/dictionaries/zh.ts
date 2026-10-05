/**
 * @file i18n/dictionaries/zh.ts
 * @description Simplified Chinese dictionary for the Modbus Analyzer PWA.
 *
 * Uses standard Chinese-language Modbus terminology consistent with
 * industrial automation literature in mainland China:
 *  - "Slave Address" → "从站地址"
 *  - "Function Code" → "功能码"
 *  - "Holding Register" → "保持寄存器"
 *  - "Coil" → "线圈"
 *  - "Discrete Input" → "离散输入"
 *  - "Input Register" → "输入寄存器"
 *  - "CRC / LRC" → "校验和" with type qualifier
 *
 * Keys must match `en.ts` exactly; missing keys automatically fall back to EN.
 */
import type { Dictionary } from '../types';

export const zh: Dictionary = {
  // ---- App / UI chrome -------------------------------------------------
  'app.title': 'Modbus 分析仪',
  'app.subtitle': '解析、检查与构建 Modbus RTU/ASCII/TCP 报文',
  'app.tab.parse': '解析',
  'app.tab.builder': '构建器',
  'app.tab.timeline': '时间线',
  'app.tab.settings': '设置',

  // ---- Input controls --------------------------------------------------
  'input.paste_hex': '粘贴十六进制',
  'input.paste_ascii': '粘贴 ASCII',
  'input.upload_file': '上传文件',
  'input.upload_pcap': '上传 PCAP',
  'input.clear': '清空',
  'input.parse': '解析',
  'input.sample_data': '示例数据',
  'input.drag_drop': '将十六进制转储或 .pcap 文件拖放到此处',

  // ---- Theme selector --------------------------------------------------
  'theme.light': '浅色',
  'theme.dark': '深色',
  'theme.system': '跟随系统',
  'theme.high_contrast': '高对比度',
  'theme.custom': '自定义',
  'theme.load_file': '加载主题文件',

  // ---- Locale selector -------------------------------------------------
  'locale.label': '语言',

  // ---- Export menu -----------------------------------------------------
  'export.csv': '导出 CSV',
  'export.json': '导出 JSON',
  'export.pdf': '导出 PDF',

  // ---- Filter panel ----------------------------------------------------
  'filter.title': '过滤器',
  'filter.add_rule': '添加规则',
  'filter.apply': '应用',
  'filter.clear': '清除',
  'filter.and': '与',
  'filter.or': '或',
  'filter.presets': '预设',
  'filter.field.station': '站点',
  'filter.field.function': '功能',
  'filter.field.register': '寄存器',
  'filter.field.value': '值',
  'filter.field.direction': '方向',
  'filter.field.status': '状态',
  'filter.op.equals': '等于',
  'filter.op.contains': '包含',
  'filter.op.gt': '大于',
  'filter.op.lt': '小于',
  'filter.op.regex': '正则表达式',

  // ---- Parser options --------------------------------------------------
  'options.byte_order': '字节序',
  'options.data_type': '数据类型',
  'options.address_base': '地址基数',
  'options.address_format': '地址格式',
  'options.absolute': '绝对',
  'options.relative': '相对',
  'options.register_map': '寄存器映射',
  'options.load_map': '加载映射',

  // ---- Frame builder ---------------------------------------------------
  'builder.title': '报文构建器',
  'builder.protocol': '协议',
  'builder.slave': '从站地址',
  'builder.function': '功能码',
  'builder.start_addr': '起始地址',
  'builder.quantity': '数量',
  'builder.values': '数值',
  'builder.output': '输出',
  'builder.copy': '复制',
  'builder.exception': '异常',
  'builder.exception_code': '异常码',

  // ---- Frame status ----------------------------------------------------
  'frame.valid': '有效',
  'frame.invalid_crc': 'CRC 错误',
  'frame.invalid_lrc': 'LRC 错误',
  'frame.truncated': '截断',
  'frame.malformed': '格式错误',
  'frame.exception': '异常响应',

  // ---- Direction -------------------------------------------------------
  'direction.request': '请求',
  'direction.response': '响应',
  'direction.unknown': '未知',

  // ---- Pane labels -----------------------------------------------------
  'pane.list': '报文列表',
  'pane.details': '报文详情',
  'pane.bytes': '字节',

  // ---- Pairing (request/response) --------------------------------------
  'pairing.linked': '已配对',
  'pairing.unpaired': '未配对',

  // ---- Timeline --------------------------------------------------------
  'timeline.title': '时间线',
  'timeline.master': '主站',
  'timeline.slave': '从站',
  'timeline.request': '请求',
  'timeline.response': '响应',

  // ---- Memory block types ----------------------------------------------
  'memory.coil': '线圈',
  'memory.discrete_input': '离散输入',
  'memory.input_register': '输入寄存器',
  'memory.holding_register': '保持寄存器',

  // ---- Function codes (Modbus spec) ------------------------------------
  'fc.01': '读线圈',
  'fc.02': '读离散输入',
  'fc.03': '读保持寄存器',
  'fc.04': '读输入寄存器',
  'fc.05': '写单个线圈',
  'fc.06': '写单个寄存器',
  'fc.07': '读异常状态',
  'fc.08': '诊断',
  'fc.09': '读通信事件计数器',
  'fc.10': '读通信事件日志',
  'fc.0B': '读通信事件计数器（旧版）',
  'fc.0C': '读通信事件日志（旧版）',
  'fc.11': '报告从站 ID',
  'fc.12': '报告从站 ID（旧版）',
  'fc.14': '读文件记录',
  'fc.15': '写文件记录',
  'fc.16': '屏蔽写寄存器',
  'fc.17': '读写多个寄存器',
  'fc.18': '读 FIFO 队列',
  'fc.2B': '封装接口传输（MEI）',

  // ---- Exception codes (Modbus spec) -----------------------------------
  'exception.01': '非法功能',
  'exception.02': '非法数据地址',
  'exception.03': '非法数据值',
  'exception.04': '从站设备故障',
  'exception.05': '确认',
  'exception.06': '从站设备忙',
  'exception.07': '否定确认',
  'exception.08': '内存奇偶校验错误',
  'exception.09': '网关路径不可用',
  'exception.0A': '网关目标设备无响应',
  'exception.0B': '未知异常',

  // ---- Field labels ----------------------------------------------------
  'field.slave_address': '从站地址',
  'field.unit_id': '单元 ID',
  'field.function_code': '功能码',
  'field.start_address': '起始地址',
  'field.quantity': '数量',
  'field.byte_count': '字节计数',
  'field.data': '数据',
  'field.crc': 'CRC 校验',
  'field.lrc': 'LRC 校验',
  'field.mbap_transaction': '事务 ID',
  'field.mbap_protocol': '协议 ID',
  'field.mbap_length': '长度',
  'field.exception_code': '异常码',
  'field.sub_function': '子功能',
  'field.mei_type': 'MEI 类型',
};
