/**
 * @fileoverview Type definitions for the pure-TypeScript pcap/pcapng parser.
 *
 * These types describe the parsed output of libpcap classic (.pcap) and
 * pcap-ng (.pcapng) capture files. They are intentionally framework-agnostic
 * (no Node APIs, no DOM) so the parser can run inside a PWA service worker
 * or a Web Worker.
 */

/**
 * Classic libpcap global header (24 bytes).
 *
 * `magicNumber` is always stored on this interface in its canonical
 * big-endian-looking form (e.g. `0xa1b2c3d4`), regardless of the on-disk
 * byte order. The actual byte order of the file is resolved at parse time
 * and is not represented here.
 */
export interface PcapFileHeader {
  /** Canonical magic: 0xa1b2c3d4 (usec), 0xa1b23c4d (nsec). */
  magicNumber: number;
  versionMajor: number;
  versionMinor: number;
  /** GMT offset (usually 0). */
  thiszone: number;
  /** Accuracy of timestamps (usually 0). */
  sigfigs: number;
  /** Max capture length (snaplen). */
  snaplen: number;
  /** Link-layer type (DLT_*). 1 = Ethernet, 113 = Linux SLL, 12/101 = raw IP, 0 = BSD loopback. */
  network: number;
}

/**
 * A single packet record from a capture file, with its raw link-layer
 * payload in `data`. The `data` array may be a view into the original
 * ArrayBuffer to avoid copying.
 */
export interface PcapPacket {
  /** Whole seconds of the capture timestamp (Unix epoch). */
  timestampSeconds: number;
  /** Sub-second fraction. Microseconds for classic pcap (usec magic) and most pcapng; nanoseconds for the nsec magic variant. */
  timestampMicroseconds: number;
  /** Bytes actually saved. */
  capturedLength: number;
  /** Original on-wire length (may exceed capturedLength if snaplen truncated). */
  originalLength: number;
  /** Raw link-layer bytes (starting at the Ethernet header for DLT_EN10MB). */
  data: Uint8Array;
}

/**
 * A single raw pcapng block, decoded down to its body bytes. Used internally
 * by the pcapng parser; not surfaced in the final {@link ParsedPcap}.
 */
export interface PcapngBlock {
  /** Block type code (e.g. 0x0a0d0d0a for SHB). */
  type: number;
  /** Block total length, in bytes, as read from disk. */
  length: number;
  /** Body bytes (already in native host order; lengths already resolved). */
  body: Uint8Array;
}

/**
 * One TCP segment (a single TCP header + payload observed on the wire).
 *
 * `timestamp` is in milliseconds since the Unix epoch, derived from the
 * packet's capture timestamp.
 */
export interface TcpSegment {
  /** Milliseconds since Unix epoch. */
  timestamp: number;
  /** 32-bit sequence number (unsigned). */
  seq: number;
  /** 32-bit ack number (unsigned). */
  ack: number;
  /** TCP flags byte (offset 13 of the TCP header). */
  flags: number;
  /** TCP payload (application bytes). */
  payload: Uint8Array;
}

/**
 * A unidirectional TCP flow (one direction of a conversation).
 *
 * The reverse direction is a separate {@link TcpFlow} whose `flowKey` is
 * the swapped form of this one's. The UI can pair them by reversing the
 * `flowKey` string.
 */
export interface TcpFlow {
  /** Direction-aware key: "srcIp:srcPort->dstIp:dstPort" (NOT sorted). */
  flowKey: string;
  srcIp: string;
  srcPort: number;
  dstIp: string;
  dstPort: number;
  /** Segments in original arrival order. */
  segments: TcpSegment[];
  /** Reassembled contiguous application stream (sorted by seq, overlaps deduped). */
  reassembled: Uint8Array;
}

/**
 * Parsed Ethernet II frame (with optional 802.1Q VLAN tag).
 */
export interface EthernetFrame {
  dstMac: string;
  srcMac: string;
  /** EtherType (after VLAN decapsulation if present): 0x0800 = IPv4, 0x86dd = IPv6. */
  ethertype: number;
  /** VLAN ID if an 802.1Q tag was present. */
  vlanId?: number;
  /** L3 payload (starts at IP header). */
  payload: Uint8Array;
}

/**
 * Parsed IP packet (v4 or v6).
 */
export interface IpPacket {
  version: 4 | 6;
  srcIp: string;
  dstIp: string;
  /** L4 protocol number (6 = TCP, 17 = UDP). */
  protocol: number;
  /** L4 payload (starts at TCP/UDP header). */
  payload: Uint8Array;
}

/**
 * Top-level result of parsing a capture file.
 */
export interface ParsedPcap {
  /** Detected container format. */
  format: 'pcap' | 'pcapng';
  /** Present when `format === 'pcap'`. */
  fileHeader?: PcapFileHeader;
  /** All packets, in file order. */
  packets: PcapPacket[];
  /** TCP flows grouped by direction (one entry per direction). */
  tcpFlows: TcpFlow[];
  /** Ports (server side) that look like Modbus TCP based on MBAP heuristics. */
  detectedModbusPorts: number[];
  /** Non-fatal issues encountered during parsing. */
  warnings: string[];
}
