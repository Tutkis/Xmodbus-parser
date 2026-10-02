/**
 * @fileoverview Public entry point for the pure-TypeScript pcap/pcapng parser.
 *
 * Usage:
 *
 * ```ts
 * import { parsePcapFile } from '@/lib/pcap';
 *
 * const file = await fileInput.files[0].arrayBuffer();
 * const parsed = parsePcapFile(file);
 *
 * console.log(parsed.format);              // 'pcap' | 'pcapng'
 * console.log(parsed.packets.length);      // total packet count
 * console.log(parsed.tcpFlows);            // one per direction
 * console.log(parsed.detectedModbusPorts); // e.g. [502]
 * ```
 *
 * The parser is dependency-free and safe to run in a Web Worker.
 */

import { parsePcap, isPcap } from './pcap';
import { parsePcapng, isPcapng } from './pcapng';
import type { ParsedPcap } from './types';

// Re-export all public types so consumers can import from the package root.
export type {
  PcapFileHeader,
  PcapPacket,
  PcapngBlock,
  TcpFlow,
  TcpSegment,
  EthernetFrame,
  IpPacket,
  ParsedPcap,
} from './types';

// Re-export sub-parsers and helpers for advanced use cases.
export { parsePcap, isPcap } from './pcap';
export { parsePcapng, isPcapng } from './pcapng';
export { parseEthernet, ETHERTYPE_IPV4, ETHERTYPE_IPV6, ETHERTYPE_VLAN, ETHERTYPE_QINQ } from './ethernet';
export { parseIpv4, parseIpv6, parseIp, IP_PROTO_TCP, IP_PROTO_UDP, IP_PROTO_ICMP } from './ip';
export {
  parseTcp,
  reassembleTcpFlow,
  groupAndReassembleFlows,
  TCP_FLAG_SYN,
  TCP_FLAG_ACK,
  TCP_FLAG_FIN,
  TCP_FLAG_RST,
  TCP_FLAG_PSH,
  TCP_FLAG_URG,
} from './tcp';
export type { AddressedTcpSegment } from './tcp';
export { detectModbusPorts, MODBUS_DEFAULT_PORT } from './modbus-detect';
export {
  decodeLinkLayer,
  walkPackets,
  DLT_NULL,
  DLT_EN10MB,
  DLT_RAW,
  DLT_RAW_ALT,
  DLT_LINUX_SLL,
  DLT_LINUX_SLL2,
} from './pipeline';
export type { WalkResult } from './pipeline';
export {
  readU16LE,
  readU16BE,
  readU32LE,
  readU32BE,
  readI32LE,
  readU64LE,
  readU64BE,
  Reader,
  formatMac,
  formatIpv4,
  formatIpv6,
  align4,
  flowKey,
  reverseFlowKey,
  u32Sub,
} from './util';

/**
 * Parse a pcap OR pcapng file by auto-detecting the format from the first few
 * bytes.
 *
 * Detection rules:
 *   - First 4 bytes (as LE u32) ∈ {0xa1b2c3d4, 0xd4c3b2a1, 0xa1b23c4d, 0x4d3cb2a1}
 *     → classic libpcap (.pcap)
 *   - First 4 bytes (as LE u32) == 0x0a0d0d0a → pcapng (.pcapng)
 *   - Otherwise → throws with a descriptive message
 *
 * @param buffer Raw file contents.
 * @returns Parsed pcap with packets, TCP flows, and detected Modbus ports.
 * @throws if the format cannot be detected.
 */
export function parsePcapFile(buffer: ArrayBuffer): ParsedPcap {
  if (buffer.byteLength < 4) {
    throw new Error(`File too small to be a pcap/pcapng file: ${buffer.byteLength} bytes`);
  }

  if (isPcapng(buffer)) {
    return parsePcapng(buffer);
  }
  if (isPcap(buffer)) {
    return parsePcap(buffer);
  }

  // Read the first 4 bytes as LE for a helpful error message.
  const first4 = new DataView(buffer, 0, 4).getUint32(0, true);
  throw new Error(
    `Unrecognized capture file format. First 4 bytes (LE u32): 0x${first4.toString(16).padStart(8, '0')}. ` +
      `Expected pcap magic (0xa1b2c3d4 / 0xd4c3b2a1 / 0xa1b23c4d / 0x4d3cb2a1) or pcapng SHB type (0x0a0d0d0a).`,
  );
}
