# TODO — Future Features

A living list of features and improvements for Modbus Analyzer, in priority order.
Contributions welcome! Open an issue to discuss before starting work.

---

## 🎯 High priority — network & capture

### 1. Modbus Master mode (request/response from browser)
- Send Modbus requests directly from the Live tab (not just capture)
- Constructor UI: pick slave, FC, address, quantity → send via Serial/TCP
- Real-time response display in the 3-pane view
- Polling mode: periodic requests at user-defined interval (1Hz–1kHz)
- Multi-poll: queue of different requests cycled in sequence
- Useful for: device commissioning, register exploration, SCADA-like monitoring

### 2. Real-time register graphs (SCADA monitoring)
- Plot register values over time on a live chart (line/step)
- Multi-trace: overlay multiple registers on the same chart
- Time window selector: last 30s / 5min / 1h / scrollable
- Y-axis: auto-scale or fixed, with min/max thresholds
- Export graph as PNG / CSV (time-series)
- Use case: monitoring temperatures, pressures, flow rates from PLCs
- Tech: lightweight SVG chart (reuse timeline SVG infra) or uPlot (~40KB)

### 3. Session export to pcap
- Save captured Live traffic back to a .pcap file
- Construct valid libpcap header + Ethernet/IP/TCP layers around Modbus PDUs
- Opens in Wireshark for further analysis
- Useful for: sharing captures with colleagues, archiving

### 4. Modbus gateway/router (RTU ↔ TCP bridge)
- Bridge mode: connect Serial on one side, expose TCP on the other
- Lets users connect a USB-RS485 adapter and expose it as Modbus TCP to other tools
- Useful for: legacy device integration, mixing RTU and TCP tools

---

## 🛰️ Medium priority — platform & integration

### 5. Compact Rust TCP bridge (in progress)
- Replace Bun-based bridge with a tiny Rust binary (~3MB vs 15MB)
- Cross-compiled for: x86_64-linux, aarch64-linux, x86_64-windows, aarch64-macos, x86_64-macos
- Single-file executable, no runtime deps, no installer
- Auto-scan local network for Modbus devices on port 502 (parallel TCP connect, 1-2s for /24)
- mDNS discovery for devices that announce themselves
- Auto-detect from PWA: probe ws://localhost:3030 on Live tab load
- GitHub Action builds + attaches binaries to releases automatically

### 6. Mobile bridge (Termux on Android)
- Document how to run the Rust bridge on Android via Termux
- `pkg install rust` → `cargo install modbus-tcp-bridge` → run
- Smartphone PWA connects to bridge on same device (ws://localhost:3030)
- iOS: not feasible (sandboxed, no arbitrary binary execution) — recommend PC bridge

### 7. IWA edition (Direct Sockets API, Chrome-only)
- Package as Isolated Web App (.wbn) for power users on Chrome
- Direct Sockets API → raw TCP to Modbus devices, no bridge needed
- Separate release artifact (not the regular PWA)
- Trade-off: Chrome-only, harder to install, but zero-bridge

### 8. Web Bluetooth support
- For Modbus RTU over BLE (some modern devices expose BLE-Serial)
- Web Bluetooth API works in Chrome/Edge
- Adds a third Live mode: Serial / TCP / Bluetooth

---

## 🎨 Medium priority — UX & parsing

### 9. Vendor function code table
- User-defined FC schemas (byte layout, field names, data types)
- CSV/JSON import/export for sharing between teams
- Per-vendor FC libraries (Schneider, Siemens, etc.)
- Falls back to raw byte display if no schema match

### 10. Multi-window / detached panels
- Open Timeline in a separate browser window (second monitor)
- Synchronized state via BroadcastChannel API
- Each tab can be popped out: List / Details / Bytes / Timeline

### 11. Pcap replay
- Load pcap → replay at original speed or user-controlled speed
- Useful for: debugging captured issues, demos, training

### 12. Diff view
- Compare two captures side-by-side (before/after firmware update)
- Highlight changed bytes/registers

---

## 🔧 Low priority — polish

### 13. Custom byte color schemes per protocol layer
- User-defined role → color mappings beyond the 3 built-in themes
- Export/import color schemes as JSON

### 14. Keyboard shortcuts
- `Ctrl+L` — load sample
- `Ctrl+E` — export CSV
- `Ctrl+K` — command palette (fuzzy search any action)
- `?` — show shortcuts overlay

### 15. Localization expansion
- Add ES, DE, FR, JA dictionaries (community-contributed)
- Language pack download from Settings tab

### 16. Performance: Web Worker for parser
- Move heavy pcap parsing off the main thread
- Background parse + postMessage results
- Smoother UI on 10MB+ captures

---

## 🐛 Known limitations (not bugs)

- **iOS Safari**: no Web Serial, no Web Bluetooth, no Direct Sockets → Live tab limited to TCP bridge mode (requires PC running bridge on same network)
- **Firefox**: no Web Serial API → Serial mode shows "unsupported" notice, TCP mode works
- **IPv4 fragmentation**: pcap parser skips fragmented IP packets (rare for Modbus, but possible)
- **pcapng multi-section**: only first Section Header Block is honored
- **Vendor FC 0x65–0x7F**: reserved range, no built-in schemas — uses raw byte display

---

If you want to work on any of these, please open an issue first to coordinate!
