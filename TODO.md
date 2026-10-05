# TODO — Future Features

A living list of features and improvements for Modbus Analyzer PWA.
Contributions welcome! Open an issue to discuss before starting work.

> **Note:** Live capture, Modbus Master mode, real-time graphs, and pcap
> export have moved to the companion **Modbus Workbench** desktop app.
> See [WORKBENCH-PLAN.md](./WORKBENCH-PLAN.md) for that roadmap.
> This PWA stays focused on **offline analysis**.

---

## 🎯 High priority — parsing & analysis

### 1. Pcap replay
- Load pcap → replay at original speed or user-controlled speed
- Useful for: debugging captured issues, demos, training
- Step forward/backward through frames

### 2. Diff view
- Compare two captures side-by-side (before/after firmware update)
- Highlight changed bytes/registers between corresponding frames

### 3. Session save/load
- Save current parsed session (input + settings + frames) as .modbus-session JSON
- Reload to restore exact state — useful for sharing analysis with colleagues

### 4. Vendor function code table
- User-defined FC schemas (byte layout, field names, data types)
- CSV/JSON import/export for sharing between teams
- Per-vendor FC libraries (Schneider, Siemens, etc.)
- Falls back to raw byte display if no schema match

---

## 🎨 Medium priority — UX

### 5. Multi-window / detached panels
- Open Timeline in a separate browser window (second monitor)
- Synchronized state via BroadcastChannel API
- Each tab can be popped out: List / Details / Bytes / Timeline

### 6. Custom byte color schemes per protocol layer
- User-defined role → color mappings beyond the 3 built-in themes
- Export/import color schemes as JSON

### 7. Keyboard shortcuts
- `Ctrl+L` — load sample
- `Ctrl+E` — export CSV
- `Ctrl+K` — command palette (fuzzy search any action)
- `?` — show shortcuts overlay

### 8. Modbus slave simulator (in-browser)
- PWA acts as a Modbus slave (TCP) for testing masters
- Uses WebSocket bridge or a local server
- Configure register values, watch incoming requests
- Maybe better as Workbench feature — TBD

---

## 🔧 Low priority — polish

### 9. Localization expansion
- Add ES, DE, FR, JA dictionaries (community-contributed)
- Language pack download from Settings tab

### 10. Performance: Web Worker for parser
- Move heavy pcap parsing off the main thread
- Background parse + postMessage results
- Smoother UI on 10MB+ captures

### 11. Better register map UX
- Inline editing of register map entries (not just CSV import)
- Search/filter loaded register names
- Auto-apply byte order per register from map

### 12. Print-friendly view
- "Print" button that produces a clean report (no interactive UI)
- Differs from PDF export — uses browser print dialog

---

## 🐛 Known limitations (not bugs)

- **No live capture**: PWA cannot connect to Modbus devices directly.
  Browser sandbox prevents raw TCP/serial. Use **Modbus Workbench**
  (coming soon) for live work.
- **iOS Safari**: no Web Serial (but PWA still installs and parses offline)
- **Firefox**: no Web Serial (but PWA parses + exports work)
- **IPv4 fragmentation**: pcap parser skips fragmented IP packets (rare for Modbus)
- **pcapng multi-section**: only first Section Header Block is honored
- **Vendor FC 0x65–0x7F**: reserved range, no built-in schemas — raw byte display

---

If you want to work on any of these, please open an issue first to coordinate!
