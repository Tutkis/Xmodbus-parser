//! Modbus TCP Bridge — WebSocket ↔ TCP proxy with network scanner
//!
//! Allows the browser-based PWA to connect to Modbus TCP devices on the
//! local network via a local WebSocket bridge. The browser cannot make
//! raw TCP connections, so this binary bridges WS → TCP.
//!
//! Also includes a parallel TCP port scanner that finds Modbus devices
//! on the local network (default: port 502) in 1-2 seconds for a /24.
//!
//! # Usage
//!
//! ```sh
//! modbus-bridge                  # listen on 0.0.0.0:3030
//! modbus-bridge --port 8080      # custom port
//! modbus-bridge --scan-only      # scan local network and exit
//! ```
//!
//! # Protocol (JSON over WebSocket)
//!
//! Client → Server:
//! - `{"type":"connect","host":"192.168.1.10","port":502}`
//! - `{"type":"data","payload":"010300000001840a"}` (hex)
//! - `{"type":"disconnect"}`
//! - `{"type":"scan"}` — scan local network for Modbus devices
//! - `{"type":"scan","port":502,"timeout_ms":200}` — custom scan
//!
//! Server → Client:
//! - `{"type":"connected","host":"...","port":...}`
//! - `{"type":"data","payload":"...","direction":"rx|tx"}`
//! - `{"type":"disconnected"}`
//! - `{"type":"scan_result","devices":[{"host":"...","port":...,"latency_ms":...}]}`
//! - `{"type":"error","message":"..."}`

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use if_addrs::get_if_addrs;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;

const DEFAULT_PORT: u16 = 3030;
const DEFAULT_SCAN_PORT: u16 = 502;
const DEFAULT_SCAN_TIMEOUT_MS: u64 = 200;
const SCAN_CONCURRENCY: usize = 64;

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMsg {
    Connect { host: String, port: u16 },
    Data { payload: String },
    Disconnect,
    Scan {
        #[serde(default = "default_scan_port")]
        port: u16,
        #[serde(default = "default_scan_timeout")]
        timeout_ms: u64,
    },
}

fn default_scan_port() -> u16 {
    DEFAULT_SCAN_PORT
}
fn default_scan_timeout() -> u64 {
    DEFAULT_SCAN_TIMEOUT_MS
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case", tag = "type")]
enum ServerMsg {
    Connected { host: String, port: u16 },
    Data { payload: String, direction: &'static str },
    Disconnected,
    ScanResult { devices: Vec<ScanHit> },
    Error { message: String },
}

#[derive(Debug, Serialize, Clone)]
struct ScanHit {
    host: String,
    port: u16,
    latency_ms: u64,
}

fn server_msg(m: ServerMsg) -> Message {
    Message::Text(serde_json::to_string(&m).unwrap_or_default().into())
}

/// Active TCP connection: write half + channel for data from the read task.
struct TcpConn {
    writer: tokio::net::tcp::OwnedWriteHalf,
    rx: tokio::sync::mpsc::Receiver<Vec<u8>>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_secs()
        .init();

    let mut args = std::env::args().skip(1);
    let mut port = DEFAULT_PORT;
    let mut scan_only = false;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--port" | "-p" => {
                if let Some(p) = args.next() {
                    port = p.parse().unwrap_or(DEFAULT_PORT);
                }
            }
            "--scan-only" => {
                scan_only = true;
            }
            "--help" | "-h" => {
                eprintln!("modbus-bridge [options]");
                eprintln!("  --port <N>     WebSocket port (default: {DEFAULT_PORT})");
                eprintln!("  --scan-only    Scan local network for Modbus devices and exit");
                return Ok(());
            }
            _ => {
                eprintln!("Unknown arg: {arg}. Use --help.");
            }
        }
    }

    if scan_only {
        log::info!("Scanning local network for Modbus devices on port {DEFAULT_SCAN_PORT}...");
        let devices = scan_local_network(DEFAULT_SCAN_PORT, DEFAULT_SCAN_TIMEOUT_MS).await;
        println!("Found {} device(s):", devices.len());
        for d in &devices {
            println!("  {}:{} ({}ms)", d.host, d.port, d.latency_ms);
        }
        return Ok(());
    }

    let addr = format!("0.0.0.0:{port}");
    let listener = TcpListener::bind(&addr).await?;
    log::info!("modbus-bridge listening on ws://{addr}/");
    log::info!("  Browser connects via: ws://<this-host>:{port}/?XTransformPort={port}");
    log::info!("  Or locally: ws://localhost:{port}/");
    log::info!("  Press Ctrl+C to stop.");

    while let Ok((stream, peer)) = listener.accept().await {
        log::info!("Client connected: {peer}");
        tokio::spawn(handle_client(stream));
    }

    Ok(())
}

async fn handle_client(stream: TcpStream) {
    let ws_stream = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            log::warn!("WS handshake failed: {e}");
            return;
        }
    };
    let (mut ws_sink, mut ws_rx) = ws_stream.split();
    let mut tcp: Option<TcpConn> = None;

    loop {
        tokio::select! {
            // Incoming WS message from browser
            msg = ws_rx.next() => {
                let msg = match msg {
                    Some(Ok(Message::Text(t))) => t.to_string(),
                    Some(Ok(Message::Binary(b))) => String::from_utf8_lossy(&b).to_string(),
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    _ => continue,
                };
                let cmd: ClientMsg = match serde_json::from_str(&msg) {
                    Ok(c) => c,
                    Err(e) => {
                        let _ = ws_sink.send(server_msg(ServerMsg::Error {
                            message: format!("Invalid JSON: {e}"),
                        })).await;
                        continue;
                    }
                };
                match cmd {
                    ClientMsg::Connect { host, port } => {
                        if tcp.is_some() {
                            let _ = ws_sink.send(server_msg(ServerMsg::Error {
                                message: "Already connected".into(),
                            })).await;
                            continue;
                        }
                        log::info!("Connecting to {host}:{port}");
                        match tokio::time::timeout(
                            Duration::from_secs(5),
                            TcpStream::connect((host.as_str(), port)),
                        ).await {
                            Ok(Ok(stream)) => {
                                log::info!("Connected to {host}:{port}");
                                let (rh, wh) = stream.into_split();
                                let _ = rh; // rh moved into spawn below
                                let (tx, rx) = tokio::sync::mpsc::channel::<Vec<u8>>(64);
                                // Spawn read task — sends Vec<u8> on data, empty Vec on EOF.
                                tokio::spawn(async move {
                                    let mut rh = rh;
                                    let mut buf = [0u8; 8192];
                                    loop {
                                        match rh.read(&mut buf).await {
                                            Ok(0) | Err(_) => {
                                                let _ = tx.send(Vec::new()).await;
                                                break;
                                            }
                                            Ok(n) => {
                                                if tx.send(buf[..n].to_vec()).await.is_err() {
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                });
                                let _ = ws_sink.send(server_msg(ServerMsg::Connected { host, port })).await;
                                tcp = Some(TcpConn { writer: wh, rx });
                            }
                            Ok(Err(e)) => {
                                let _ = ws_sink.send(server_msg(ServerMsg::Error {
                                    message: format!("Connect failed: {e}"),
                                })).await;
                            }
                            Err(_) => {
                                let _ = ws_sink.send(server_msg(ServerMsg::Error {
                                    message: "Connect timeout".into(),
                                })).await;
                            }
                        }
                    }
                    ClientMsg::Data { payload } => {
                        if let Some(conn) = tcp.as_mut() {
                            if let Some(bytes) = hex_decode(&payload) {
                                if !bytes.is_empty() {
                                    if conn.writer.write_all(&bytes).await.is_err() {
                                        let _ = ws_sink.send(server_msg(ServerMsg::Disconnected)).await;
                                        tcp = None;
                                    } else {
                                        let _ = ws_sink.send(server_msg(ServerMsg::Data {
                                            payload: hex_encode(&bytes),
                                            direction: "tx",
                                        })).await;
                                    }
                                }
                            }
                        } else {
                            let _ = ws_sink.send(server_msg(ServerMsg::Error {
                                message: "Not connected".into(),
                            })).await;
                        }
                    }
                    ClientMsg::Disconnect => {
                        if tcp.is_some() {
                            tcp = None;
                            let _ = ws_sink.send(server_msg(ServerMsg::Disconnected)).await;
                        }
                    }
                    ClientMsg::Scan { port, timeout_ms } => {
                        let devices = scan_local_network(port, timeout_ms).await;
                        log::info!("Scan found {} device(s)", devices.len());
                        let _ = ws_sink.send(server_msg(ServerMsg::ScanResult { devices })).await;
                    }
                }
            }
            // Incoming data from TCP device (via channel)
            Some(data) = async {
                match tcp.as_mut() {
                    Some(conn) => conn.rx.recv().await,
                    None => {
                        // No TCP — park this branch forever.
                        std::future::pending::<Option<Vec<u8>>>().await
                    }
                }
            } => {
                if data.is_empty() {
                    // TCP closed
                    let _ = ws_sink.send(server_msg(ServerMsg::Disconnected)).await;
                    tcp = None;
                } else {
                    let _ = ws_sink.send(server_msg(ServerMsg::Data {
                        payload: hex_encode(&data),
                        direction: "rx",
                    })).await;
                }
            }
        }
    }

    log::info!("Client disconnected");
}

/// Scan all local network subnets for devices with the given TCP port open.
/// Returns found devices sorted by latency (fastest first).
async fn scan_local_network(port: u16, timeout_ms: u64) -> Vec<ScanHit> {
    let interfaces = match get_if_addrs() {
        Ok(ifaces) => ifaces,
        Err(e) => {
            log::warn!("if_addrs failed: {e}");
            return Vec::new();
        }
    };

    let mut candidates: Vec<Ipv4Addr> = Vec::new();
    for iface in &interfaces {
        if iface.is_loopback() {
            continue;
        }
        if let IpAddr::V4(ip) = iface.ip() {
            let octets = ip.octets();
            // Assume /24 — last octet varies.
            for i in 1..=254u8 {
                let candidate = Ipv4Addr::new(octets[0], octets[1], octets[2], i);
                if candidate != ip {
                    candidates.push(candidate);
                }
            }
        }
    }
    // Include loopback for local testing (e.g. Modbus simulator on same machine).
    candidates.push(Ipv4Addr::new(127, 0, 0, 1));

    if candidates.is_empty() {
        return Vec::new();
    }

    log::info!(
        "Scanning {} candidate IPs on port {} (timeout {}ms)...",
        candidates.len(),
        port,
        timeout_ms
    );

    let timeout = Duration::from_millis(timeout_ms);
    let mut tasks: Vec<tokio::task::JoinHandle<Option<ScanHit>>> = Vec::with_capacity(candidates.len());

    for ip in candidates {
        let port = port;
        let timeout = timeout;
        tasks.push(tokio::spawn(async move {
            let start = std::time::Instant::now();
            let addr = SocketAddr::new(IpAddr::V4(ip), port);
            match tokio::time::timeout(timeout, TcpStream::connect(addr)).await {
                Ok(Ok(_stream)) => {
                    let latency = start.elapsed().as_millis() as u64;
                    Some(ScanHit {
                        host: ip.to_string(),
                        port,
                        latency_ms: latency,
                    })
                }
                _ => None,
            }
        }));
    }

    // Limit concurrency by chunking.
    let mut results = Vec::new();
    for chunk in tasks.chunks_mut(SCAN_CONCURRENCY) {
        for task in chunk {
            if let Ok(Some(hit)) = task.await {
                results.push(hit);
            }
        }
    }

    results.sort_by_key(|h| h.latency_ms);
    results
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

fn hex_decode(s: &str) -> Option<Vec<u8>> {
    let s: String = s.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if s.len() % 2 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    for i in (0..s.len()).step_by(2) {
        out.push(u8::from_str_radix(&s[i..i + 2], 16).ok()?);
    }
    Some(out)
}
