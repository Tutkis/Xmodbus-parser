# modbus-bridge

Compact WebSocket-to-TCP proxy for browser-based Modbus TCP live capture. Built in Rust, ~700KB binary, no runtime dependencies, no installer.

## Why?

Browsers cannot make raw TCP connections (security sandbox). This bridge proxies WebSocket → TCP, letting the Modbus Analyzer PWA connect to Modbus TCP devices on your local network.

Also includes a **parallel network scanner** that finds Modbus devices on port 502 in 1-2 seconds.

## Download

Pre-built binaries (~700KB each) are available on [GitHub Releases](https://github.com/Tutkis/Xmodbus-parser/releases):

| Platform | File | Arch |
|---|---|---|
| Linux | `modbus-bridge-linux-x64` | x86_64 |
| Linux | `modbus-bridge-linux-arm64` | aarch64 (Raspberry Pi 4, ARM servers) |
| Windows | `modbus-bridge-windows-x64.exe` | x86_64 |
| macOS | `modbus-bridge-macos-x64` | Intel |
| macOS | `modbus-bridge-macos-arm64` | Apple Silicon (M1/M2/M3) |

## Usage

### Desktop (Windows/macOS/Linux)

1. Download the binary for your platform
2. Make it executable (macOS/Linux): `chmod +x modbus-bridge-*`
3. Run it:
   ```sh
   ./modbus-bridge                  # default port 3030
   ./modbus-bridge --port 8080      # custom port
   ./modbus-bridge --scan-only      # scan network and exit (CLI mode)
   ./modbus-bridge --help
   ```
4. Open the [Modbus Analyzer PWA](https://tutkis.github.io/Xmodbus-parser/) → Live tab → TCP mode
5. The bridge status should show "Online" automatically
6. Click "Scan network" to discover Modbus devices

### Android (via Termux)

The Rust binary runs on Android via Termux:

1. Install [Termux](https://termux.dev/) from F-Droid (Google Play version is outdated)
2. In Termux:
   ```sh
   pkg update
   pkg install rust
   cargo install modbus-tcp-bridge --git https://github.com/Tutkis/Xmodbus-parser --root $HOME
   # Or download pre-built aarch64-linux binary and run directly
   modbus-bridge --port 3030
   ```
3. Keep Termux running (acquire wakelock: `termux-wake-lock`)
4. Open Chrome on your phone → [Modbus Analyzer PWA](https://tutkis.github.io/Xmodbus-parser/) → Live → TCP
5. The PWA connects to `ws://localhost:3030` on the same device

### iOS

iOS does not allow arbitrary binary execution (sandboxed). Options:
- Run the bridge on a PC/Mac/Raspberry Pi on the same WiFi network
- Connect from iPhone to `ws://<pc-ip>:3030` (replace `localhost` in the PWA's bridge URL)
- Or use a Modbus TCP device that exposes a built-in WebSocket/HTTP server (no bridge needed)

## Build from source

Requires Rust 1.70+:

```sh
cd mini-services/tcp-bridge-rust
cargo build --release
# Binary: target/release/modbus-bridge (Linux/macOS) or .exe (Windows)
```

### Cross-compile

```sh
# Add target
rustup target add aarch64-unknown-linux-gnu

# Install cross (uses Docker for cross-compilation)
cargo install cross

# Build
cross build --release --target aarch64-unknown-linux-gnu
```

## Protocol (JSON over WebSocket)

### Client → Bridge

```json
{"type": "connect", "host": "192.168.1.10", "port": 502}
{"type": "data", "payload": "010300000001840a"}
{"type": "disconnect"}
{"type": "scan", "port": 502, "timeout_ms": 200}
```

### Bridge → Client

```json
{"type": "connected", "host": "192.168.1.10", "port": 502}
{"type": "data", "payload": "010314000c0037...", "direction": "rx"}
{"type": "data", "payload": "010300000001840a", "direction": "tx"}
{"type": "disconnected"}
{"type": "scan_result", "devices": [{"host": "192.168.1.10", "port": 502, "latency_ms": 3}]}
{"type": "error", "message": "Connect timeout"}
```

## Security

- The bridge is a **pure passthrough** — no data is stored, logged, or forwarded anywhere except the configured TCP target
- It only listens on `0.0.0.0:3030` (or custom port)
- The browser must be on the same machine (or you explicitly expose the port)
- For remote access, use SSH port forwarding: `ssh -L 3030:localhost:3030 user@remote-host`

## Size comparison

| Implementation | Binary size | Runtime |
|---|---|---|
| **Rust (this)** | **~700KB** | None |
| Bun (tcp-bridge) | ~15MB | Bun runtime |
| Node.js + ws | ~5MB + Node | Node.js |
| Go | ~8MB | None |

## License

MIT
