/**
 * @file i18n/dictionaries/ru.ts
 * @description Russian dictionary for the Modbus Analyzer PWA.
 *
 * Uses established Russian-language Modbus terminology, consistent with
 * GOST-style translations and common practice in Russian SCADA/PLC literature:
 *  - "Slave Address" → "Адрес ведомого" (also "Адрес подчиненного устройства")
 *  - "Holding Register" → "Регистр хранения"
 *  - "Coil" → "Катушка"
 *  - "Discrete Input" → "Дискретный вход"
 *  - "Input Register" → "Регистр ввода"
 *  - "CRC / LRC" → "Контрольная сумма" with type qualifier
 *
 * Keys must match `en.ts` exactly; missing keys automatically fall back to EN.
 */
import type { Dictionary } from '../types';

export const ru: Dictionary = {
  // ---- App / UI chrome -------------------------------------------------
  'app.title': 'Анализатор Modbus',
  'app.subtitle': 'Разбор, анализ и сборка трафика Modbus RTU/ASCII/TCP',
  'app.tab.parse': 'Разбор',
  'app.tab.builder': 'Конструктор',
  'app.tab.timeline': 'Хронология',
  'app.tab.settings': 'Настройки',

  // ---- Input controls --------------------------------------------------
  'input.paste_hex': 'Вставить HEX',
  'input.paste_ascii': 'Вставить ASCII',
  'input.upload_file': 'Загрузить файл',
  'input.upload_pcap': 'Загрузить PCAP',
  'input.clear': 'Очистить',
  'input.parse': 'Разобрать',
  'input.sample_data': 'Образец данных',
  'input.drag_drop': 'Перетащите HEX-дамп или файл .pcap сюда',

  // ---- Theme selector --------------------------------------------------
  'theme.light': 'Светлая',
  'theme.dark': 'Тёмная',
  'theme.system': 'Системная',
  'theme.high_contrast': 'Высокий контраст',
  'theme.custom': 'Пользовательская',
  'theme.load_file': 'Загрузить файл темы',

  // ---- Locale selector -------------------------------------------------
  'locale.label': 'Язык',

  // ---- Export menu -----------------------------------------------------
  'export.csv': 'Экспорт CSV',
  'export.json': 'Экспорт JSON',
  'export.pdf': 'Экспорт PDF',

  // ---- Filter panel ----------------------------------------------------
  'filter.title': 'Фильтры',
  'filter.add_rule': 'Добавить правило',
  'filter.apply': 'Применить',
  'filter.clear': 'Сбросить',
  'filter.and': 'И',
  'filter.or': 'ИЛИ',
  'filter.presets': 'Шаблоны',
  'filter.field.station': 'Станция',
  'filter.field.function': 'Функция',
  'filter.field.register': 'Регистр',
  'filter.field.value': 'Значение',
  'filter.field.direction': 'Направление',
  'filter.field.status': 'Статус',
  'filter.op.equals': 'равно',
  'filter.op.contains': 'содержит',
  'filter.op.gt': 'больше',
  'filter.op.lt': 'меньше',
  'filter.op.regex': 'рег. выражение',

  // ---- Parser options --------------------------------------------------
  'options.byte_order': 'Порядок байт',
  'options.data_type': 'Тип данных',
  'options.address_base': 'База адресов',
  'options.address_format': 'Формат адреса',
  'options.absolute': 'Абсолютный',
  'options.relative': 'Относительный',
  'options.register_map': 'Карта регистров',
  'options.load_map': 'Загрузить карту',

  // ---- Frame builder ---------------------------------------------------
  'builder.title': 'Конструктор кадров',
  'builder.protocol': 'Протокол',
  'builder.slave': 'Адрес ведомого',
  'builder.function': 'Код функции',
  'builder.start_addr': 'Начальный адрес',
  'builder.quantity': 'Количество',
  'builder.values': 'Значения',
  'builder.output': 'Результат',
  'builder.copy': 'Копировать',
  'builder.exception': 'Исключение',
  'builder.exception_code': 'Код исключения',

  // ---- Frame status ----------------------------------------------------
  'frame.valid': 'Корректный',
  'frame.invalid_crc': 'Неверная CRC',
  'frame.invalid_lrc': 'Неверная LRC',
  'frame.truncated': 'Усечённый',
  'frame.malformed': 'Некорректный формат',
  'frame.exception': 'Ответ с исключением',

  // ---- Direction -------------------------------------------------------
  'direction.request': 'Запрос',
  'direction.response': 'Ответ',
  'direction.unknown': 'Неизвестно',

  // ---- Pane labels -----------------------------------------------------
  'pane.list': 'Список кадров',
  'pane.details': 'Детали кадра',
  'pane.bytes': 'Байты',

  // ---- Pairing (request/response) --------------------------------------
  'pairing.linked': 'Связано',
  'pairing.unpaired': 'Не сопоставлено',

  // ---- Timeline --------------------------------------------------------
  'timeline.title': 'Хронология',
  'timeline.master': 'Ведущий',
  'timeline.slave': 'Ведомый',
  'timeline.request': 'Запрос',
  'timeline.response': 'Ответ',

  // ---- Memory block types ----------------------------------------------
  'memory.coil': 'Катушка',
  'memory.discrete_input': 'Дискретный вход',
  'memory.input_register': 'Регистр ввода',
  'memory.holding_register': 'Регистр хранения',

  // ---- Function codes (Modbus spec) ------------------------------------
  'fc.01': 'Чтение катушек',
  'fc.02': 'Чтение дискретных входов',
  'fc.03': 'Чтение регистров хранения',
  'fc.04': 'Чтение регистров ввода',
  'fc.05': 'Запись одной катушки',
  'fc.06': 'Запись одного регистра',
  'fc.07': 'Чтение статуса исключения',
  'fc.08': 'Диагностика',
  'fc.09': 'Чтение счётчика событий связи',
  'fc.10': 'Чтение журнала событий связи',
  'fc.0B': 'Чтение счётчика событий (устаревшее)',
  'fc.0C': 'Чтение журнала событий (устаревшее)',
  'fc.11': 'Чтение ID ведомого',
  'fc.12': 'Чтение ID ведомого (устаревшее)',
  'fc.14': 'Чтение файловой записи',
  'fc.15': 'Запись файловой записи',
  'fc.16': 'Маска записи регистра',
  'fc.17': 'Чтение/запись нескольких регистров',
  'fc.18': 'Чтение очереди FIFO',
  'fc.2B': 'Инкапсулированная передача (MEI)',

  // ---- Exception codes (Modbus spec) -----------------------------------
  'exception.01': 'Недопустимая функция',
  'exception.02': 'Недопустимый адрес данных',
  'exception.03': 'Недопустимое значение данных',
  'exception.04': 'Сбой ведомого устройства',
  'exception.05': 'Подтверждение',
  'exception.06': 'Ведомое устройство занято',
  'exception.07': 'Отрицательное подтверждение',
  'exception.08': 'Ошибка чётности памяти',
  'exception.09': 'Путь шлюза недоступен',
  'exception.0A': 'Целевое устройство шлюза не отвечает',
  'exception.0B': 'Неизвестное исключение',

  // ---- Field labels ----------------------------------------------------
  'field.slave_address': 'Адрес ведомого',
  'field.unit_id': 'ID устройства',
  'field.function_code': 'Код функции',
  'field.start_address': 'Начальный адрес',
  'field.quantity': 'Количество',
  'field.byte_count': 'Счётчик байт',
  'field.data': 'Данные',
  'field.crc': 'CRC',
  'field.lrc': 'LRC',
  'field.mbap_transaction': 'ID транзакции',
  'field.mbap_protocol': 'ID протокола',
  'field.mbap_length': 'Длина',
  'field.exception_code': 'Код исключения',
  'field.sub_function': 'Подфункция',
  'field.mei_type': 'Тип MEI',
};
