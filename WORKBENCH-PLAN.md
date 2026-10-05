# Modbus Workbench — План разработки

> Companion desktop app к [Modbus Analyzer PWA](https://github.com/Tutkis/Xmodbus-parser).
> PWA — для парсинга/анализа трафика (вставил hex/pcap → разобрал → экспорт).
> Workbench — для **живой работы с устройствами**: master mode, poll, real-time capture, export в pcap.

---

## 🎯 Цель

Native desktop приложение для работы с Modbus устройствами напрямую:
- Modbus TCP (raw TCP, без мостов — native socket доступ)
- Modbus RTU/ASCII (native serial port, без Web Serial API ограничений)
- Modbus RTU-over-TCP

Без браузерных sandbox-ограничений, без WebSocket-мостов, без Termux-костылей на Android.

---

## 🛠️ Технологический стек (рекомендация)

| Слой | Технология | Почему |
|---|---|---|
| **Фронтенд** | React + TypeScript + Tailwind + shadcn/ui | Reuse UI-кода из PWA (PacketList, PacketDetails, PacketBytes, Builder, Timeline, темы, i18n) |
| **Backend** | Rust (Tauri) | Native TCP/serial доступ, малый binary (~5-10MB), cross-platform |
| **Фреймворк** | Tauri v2 | Связывает React frontend с Rust backend, native окна, cross-platform (Win/Mac/Linux) |
| **Modbus lib** | `tokio-modbus` или своя (перенос из PWA) | reuse `src/lib/modbus/` из PWA (3300 LOC готового TS-кода) |
| **Serial** | `serialport` crate (Rust) | Native serial port доступ без Web Serial API |
| **TCP** | `tokio::net::TcpStream` | Async TCP, уже используется в существующем Rust bridge |
| **Pcap export** | `pcap-file` crate + libpcap writer | Export захваченного трафика в .pcap для Wireshark |
| **Графики** | uPlot (~40KB) или recharts | Real-time графики регистров, минимальный bundle |
| **Деплой** | GitHub Releases + Action cross-compile | Готовые бинарники для Win/Mac/Linux |

**Альтернативы если Tauri не зайдёт:**
- Pure Rust + egui (максимально компактный, ~3MB, но UI переписывать)
- Electron (быстрый старт, но ~80MB)
- Python + PySide6 (SCADA-фолк знаком, но Python runtime)

---

## 📦 Что переиспользовать из PWA (Xmodbus-parser)

Прямо copy-paste из `src/lib/` и `src/components/`:

| Что | LOC | Зачем |
|---|---|---|
| `src/lib/modbus/` | ~3300 | Парсер, builder, CRC/LRC, register decoder — готовый |
| `src/lib/pcap/` | ~1800 | pcap reader (для импорта) + основа для writer |
| `src/lib/i18n/` | ~600 | EN/RU/ZH + custom dictionaries |
| `src/lib/themes/` | ~500 | Catppuccin Latte/Mocha + Gruvbox + custom JSON |
| `src/lib/colorize/` | ~400 | Byte tokenizer (раскраска по ролям) |
| `src/components/parse/` | ~1000 | PacketList, PacketDetails, PacketBytes (3-pane view) |
| `src/components/timeline/` | ~800 | SVG sequence diagram |
| `src/components/tabs/builder-tab.tsx` | ~1150 | Конструктор фреймов (станет "Manual request") |

**Итого переиспользуем:** ~9500 LOC готового кода.

---

## 🚀 Этапы разработки

### Этап 0: Scaffold (1-2 дня)
- Создать новый репо `Tutkis/Xmodbus-workbench`
- `bun create tauri-app` (React + TypeScript template)
- Настроить Tailwind 4 + shadcn/ui
- Скопировать `src/lib/` и UI-компоненты из PWA
- Базовое окно с вкладками (Capture / Master / Builder / Timeline / Settings)
- GitHub Action для cross-compile (Win/Mac/Linux)

### Этап 1: TCP Master mode (3-5 дней)
**Цель:** отправлять Modbus TCP запросы и видеть ответы.

UI:
```
┌─────────────────────────────────────────────┐
│ Connection: 192.168.1.10:502 [Connect]      │
│                                             │
│ ┌── Poll Queue ──────────────────────────┐  │
│ │ [+ Add poll]                           │  │
│ │                                        │  │
│ │ ▶ Slave 1 · FC03 · addr 0 · qty 10     │  │
│ │   Interval: 1s                          │  │
│ │   Last: 12 52 00 AB ... (3ms ago)      │  │
│ │                                        │  │
│ │ ▶ Slave 2 · FC04 · addr 100 · qty 4    │  │
│ │   Last: 22.5°C (register map name)     │  │
│ └────────────────────────────────────────┘  │
│                                             │
│ [Manual request]  ← Builder tab integration │
│                                             │
│ ┌── Real-time frames ───────────────────┐  │
│ │ (3-pane Parse view — reuse from PWA)   │  │
│ └────────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

Backend (Rust):
- `tokio::net::TcpStream` для TCP
- Tauri command `connect_tcp(host, port)` → возвращает connection ID
- Tauri command `send_modbus(conn_id, hex_bytes)` → отправляет + возвращает response
- Tauri command `poll_start(config)` → запускает periodic poll в background
- Tauri event `frame_captured` → отправляет в frontend для отображения

Frontend (React):
- Poll queue с add/remove/start/stop
- Manual request → открывает Builder tab → "Send to device" → response в Capture tab
- Reuse PacketList/Details/Bytes для отображения

### Этап 2: Serial Master mode (3-5 дней)
**Цель:** то же для Modbus RTU/ASCII over serial.

Backend:
- `serialport` crate для RS485/RS232
- Tauri command `connect_serial(port, baud, data, stop, parity)`
- Тот же `send_modbus` API, но с CRC-16 для RTU / LRC для ASCII
- Auto-detect serial ports (список доступных /dev/ttyUSB*, COM*, /dev/cu.*)

Frontend:
- Serial config UI (как было в PWA Live tab)
- Тот же poll queue + manual request
- CRC/LRC validation в отображении

### Этап 3: Real-time capture (3-4 дня)
**Цель:** пассивный capture трафика между мастером и slave.

Сценарии:
- **TCP sniffer:** подключаемся к устройству как proxy (master → workbench → slave)
- **Serial sniffer:** слушаем шину RS485 (нужен RS485 sniffer hardware, 2 порта)
- **Local capture:** записываем свой собственный poll-трафик

Backend:
- `capture_tcp_start(listen_port)` → открывает TCP server, пересылает между master/slave
- `capture_serial_start(port)` → слушает serial, парсит кадра
- Event `frame_captured` → в frontend

Frontend:
- Capture config UI
- Reuse 3-pane Parse view
- Timeline tab для визуализации

### Этап 4: Export to pcap (2-3 дня)
**Цель:** сохранять захваченный трафик в .pcap для Wireshark.

Backend:
- `pcap-file` crate для записи
- Оборачиваем Modbus PDUs в Ethernet/IP/TCP слои (для TCP)
- Или raw serial frames в pcap (для RTU)
- Tauri command `export_pcap(filename, frames[])`

Frontend:
- Export button в Capture tab
- Опции: только selected frames / все / по времени

### Этап 5: Real-time графики (3-5 дней)
**Цель:** SCADA-мониторинг значений регистров во времени.

UI:
```
┌── Register graphs ──────────────────────────┐
│                                             │
│  Temperature (reg 0)  22.5°C                │
│  ┌─────────────────────────────────────┐    │
│  │     ╱╲      ╱╲      ╱╲      ╱╲      │    │
│  │  ╱╲╱  ╲╱╲╱╲╱  ╲╱╲╱  ╲╱╲╱  ╲╱╲╱     │    │
│  └─────────────────────────────────────┘    │
│  Last 5 min  [30s] [5min] [1h] [All]        │
│                                             │
│  Pressure (reg 10)  4.2 bar                 │
│  ┌─────────────────────────────────────┐    │
│  │ ───────────────────────────────────  │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

Features:
- Multi-trace (overlay нескольких регистров)
- Time window selector (30s / 5min / 1h / scrollable)
- Y-axis auto-scale или fixed с thresholds
- Export PNG / CSV (time-series)

### Этап 6: Multi-device (2-3 дня)
- Несколько TCP connections одновременно
- Tabs для каждого устройства
- Общий poll queue с маршрутизацией по connection

### Этап 7: Auto-reconnect + reliability (1-2 дня)
- Авто-reconnect при обрыве TCP с backoff (1s → 2s → 4s → max 30s)
- Timeout на response (configurable, default 3s)
- Retry logic для failed polls

### Этап 8: Polish (2-3 дня)
- Vendor function code table (user-defined FC schemas)
- Register map import/export (CSV, как в PWA)
- Keyboard shortcuts (Ctrl+Enter = send, etc.)
- System tray icon (minimize to tray при длительном capture)
- Auto-save session (восстановление poll queue после перезапуска)

---

## 📊 Сравнение с PWA

| Feature | Modbus Analyzer (PWA) | Modbus Workbench (Native) |
|---|---|---|
| Парсинг hex/pcap | ✅ | ✅ (reuse) |
| Конструктор фреймов | ✅ | ✅ (reuse) |
| Timeline | ✅ | ✅ (reuse) |
| Темы / i18n | ✅ | ✅ (reuse) |
| **Modbus Master mode** | ❌ | ✅ |
| **Real-time capture** | ❌ (только через bridge) | ✅ (native) |
| **Poll queue** | ❌ | ✅ |
| **Live графики** | ❌ | ✅ |
| **Export to pcap** | ❌ | ✅ |
| **Multi-device** | ❌ | ✅ |
| Браузерная установка | ✅ | ❌ (native install) |
| Offline из коробки | ✅ | ✅ |
| Размер | ~500KB (PWA) | ~5-10MB (native binary) |
| Деплой | GitHub Pages | GitHub Releases |

---

## 🔗 Связь между проектами

- **PWA → Workbench:** экспорт pcap из PWA → импорт в Workbench для replay
- **Workbench → PWA:** export hex dump → вставить в PWA для детального анализа
- **Shared code:** `src/lib/modbus/`, `src/lib/pcap/`, `src/lib/i18n/`, `src/lib/themes/` — можно вынести в отдельный npm package (`@tutkis/modbus-core`) и использовать в обоих

---

## 📁 Структура проекта (предполагаемая)

```
Xmodbus-workbench/
├── src/                          # React frontend
│   ├── components/
│   │   ├── capture/              # 3-pane Parse view (из PWA)
│   │   ├── master/               # Poll queue, manual request
│   │   ├── graphs/               # Real-time register graphs
│   │   ├── tabs/                 # Capture/Master/Builder/Timeline/Settings
│   │   └── ui/                   # shadcn/ui
│   ├── hooks/
│   ├── lib/
│   │   ├── modbus/               # Из PWA
│   │   ├── pcap/                 # Из PWA (reader) + новый writer
│   │   ├── i18n/                 # Из PWA
│   │   ├── themes/               # Из PWA
│   │   └── colorize/             # Из PWA
│   └── App.tsx
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── main.rs
│   │   ├── tcp.rs                # TCP master + sniffer
│   │   ├── serial.rs             # Serial master + sniffer
│   │   ├── poll.rs               # Poll queue engine
│   │   ├── pcap_writer.rs        # Export to pcap
│   │   └── commands.rs           # Tauri commands (frontend API)
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
├── .github/workflows/
│   └── release.yml               # Cross-compile + GitHub Releases
└── README.md
```

---

## 🗓️ Примерный timeline

| Этап | Время | Что готово |
|---|---|---|
| 0. Scaffold | 1-2 дня | Пустое Tauri app, копирование libs |
| 1. TCP Master | 3-5 дней | Poll + manual request по TCP |
| 2. Serial Master | 3-5 дней | Poll + manual request по RTU/ASCII |
| 3. Real-time capture | 3-4 дня | Passive sniffer (TCP + serial) |
| 4. Export pcap | 2-3 дня | Сохранение в .pcap |
| 5. Live графики | 3-5 дней | SCADA-мониторинг |
| 6. Multi-device | 2-3 дня | Несколько соединений |
| 7. Auto-reconnect | 1-2 дня | Reliability |
| 8. Polish | 2-3 дня | UX, shortcuts, tray |
| **Итого MVP (этапы 0-2)** | **~2 недели** | Можно пользоваться |
| **Итого full (0-8)** | **~4-5 недель** | Production-ready |

---

## 🎯 MVP (минимально жизнеспособный продукт)

Если нужно быстро — этапы 0-2 дают:
- TCP Master mode (poll + manual)
- Serial Master mode (poll + manual)
- 3-pane Parse view (reuse из PWA)
- Базовые темы + i18n

Этого достаточно для:
- Комиссии новых устройств (отправить запрос → посмотреть ответ)
- SCADA-мониторинга (poll по расписанию)
- Debug странных значений регистров

Live capture, pcap export, графики — можно добавить позже по запросу.

---

## 💡 Идеи для будущего

- **Modbus slave simulator** (режим: Workbench притворяется устройством, отвечает на запросы)
- **Modbus gateway/router** (RTU ↔ TCP bridge)
- **Scripting** (Python/Lua скрипты для автоматизации — "если reg 0 > 100, запиши в reg 10")
- **OPC UA bridge** (маппинг Modbus регистров в OPC UA tags)
- **MQTT publish** (отправка значений регистров в MQTT broker)
- **Database logging** (SQLite/PostgreSQL для исторических данных)
- **Modbus security** (поддержка Modbus Security Application Layer — MBAP TLS)

---

## 📋 Checklist для старта

- [ ] Создать репо `Tutkis/Xmodbus-workbench`
- [ ] `bun create tauri-app` (React + TypeScript)
- [ ] Настроить Tailwind 4 + shadcn/ui
- [ ] Скопировать `src/lib/modbus/` из PWA
- [ ] Скопировать `src/lib/pcap/` из PWA
- [ ] Скопировать `src/lib/i18n/`, `themes/`, `colorize/`
- [ ] Скопировать `src/components/parse/` (PacketList/Details/Bytes)
- [ ] Реализовать `src-tauri/src/tcp.rs` (Tauri commands для TCP)
- [ ] Реализовать poll queue в frontend
- [ ] GitHub Action для cross-compile
- [ ] Release v0.1.0

---

*Этот план передаётся в новый чат для реализации Modbus Workbench.*
*Текущий проект (Xmodbus-parser) остаётся чистым парсером/анализатором.*
