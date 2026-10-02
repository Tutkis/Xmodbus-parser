/**
 * @fileoverview Shared "L2 → L3 → L4 → Modbus" pipeline used by both the
 * classic libpcap and pcapng parsers.
 *
 * Both container formats ultimately produce a list of {@link PcapPacket}
 * records (raw link-layer bytes + timestamp) and a per-packet link-layer
 * type (DLT_*). This module walks that list, strips the link layer, parses
 * IP, parses TCP, groups TCP segments into per-direction flows, reassembles
 * each flow, and runs the Modbus port heuristic.
 */

import { parseEthernet } from './ethernet';
import { parseIp } from './ip';
import { parseTcp, groupAndReassembleFlows } from './tcp';
import type { AddressedTcpSegment } from './tcp';
import { detectModbusPorts } from './modbus-detect';
import type { PcapPacket, TcpFlow } from './types';

// ---- Link-layer type codes -------------------------------------------------

/** BSD loopback (DLT_NULL / LINKTYPE_NULL). */
export const DLT_NULL = 0;
/** Ethernet II (DLT_EN10MB / LINKTYPE_ETHERNET). */
export const DLT_EN10MB = 1;
/** Raw IPv4/IPv6 (BSD: DLT_RAW). */
export const DLT_RAW = 12;
/** Raw IPv4/IPv6 (LINKTYPE_RAW — common Linux value). */
export const DLT_RAW_ALT = 101;
/** Linux cooked capture (SLL). */
export const DLT_LINUX_SLL = 113;
/** Linux cooked capture v2 (SLL2). 20-byte header. */
export const DLT_LINUX_SLL2 = 276;

// ---- EtherTypes (used for SLL family decapsulation) -----------------------

const ETHERTYPE_IPV4 = 0x0800;
const ETHERTYPE_IPV6 = 0x86dd;

/**
 * Strip the link-layer header and return the L3 payload (starting at the IP
 * header). Returns null if the link type is unknown or the packet doesn't
 * carry IP.
 *
 * For unknown DLTs the spec says "return raw payload as-is" so the caller can
 * still surface the bytes; we return the original `data` and emit a single
 * warning (deduplicated by DLT) to avoid spamming the warnings list.
 */
export function decodeLinkLayer(
  data: Uint8Array,
  dlt: number,
  warnings: string[],
  packetIndex: number,
): Uint8Array | null {
  if (data.length === 0) return null;
  switch (dlt) {
    case DLT_EN10MB: {
      try {
        return parseEthernet(data).payload;
      } catch (e) {
        warnings.push(`pkt#${packetIndex}: Ethernet parse error: ${(e as Error).message}`);
        return null;
      }
    }
    case DLT_RAW:
    case DLT_RAW_ALT:
      // Raw IP — first nibble distinguishes v4 / v6; parseIp will validate.
      return data;
    case DLT_NULL: {
      // 4-byte address family (host byte order; in practice always LE on
      // captured files). We don't need the family value since parseIp will
      // detect v4/v6 from the first nibble.
      if (data.length < 4) return null;
      return data.subarray(4);
    }
    case DLT_LINUX_SLL: {
      // 16-byte header: 2B pkt type, 2B ARPHRD, 2B addr len, 8B addr, 2B proto.
      if (data.length < 16) return null;
      const proto = (data[14] << 8) | data[15];
      if (proto === ETHERTYPE_IPV4 || proto === ETHERTYPE_IPV6) {
        return data.subarray(16);
      }
      return null; // not IP (e.g. ARP)
    }
    case DLT_LINUX_SLL2: {
      // 20-byte header: 2B pkt type, 2B ARPHRD, 2B addr len, 4B if index, 8B addr, 2B proto.
      if (data.length < 20) return null;
      const proto = (data[18] << 8) | data[19];
      if (proto === ETHERTYPE_IPV4 || proto === ETHERTYPE_IPV6) {
        return data.subarray(20);
      }
      return null;
    }
    default: {
      // Unknown link type: emit a single warning per DLT to avoid spam.
      if (!warnings.find((w) => w.startsWith(`Unknown DLT ${dlt}`))) {
        warnings.push(`Unknown DLT ${dlt}: returning raw bytes as-is for all packets with this DLT`);
      }
      return data;
    }
  }
}

/** Result of walking packets through the L2→L3→L4→Modbus pipeline. */
export interface WalkResult {
  /** Addressed TCP segments (one per TCP packet that parsed successfully). */
  labeled: AddressedTcpSegment[];
  /** All TCP flows (one per direction). */
  flows: TcpFlow[];
  /** Server-side ports that look like Modbus TCP. */
  modbusPorts: number[];
  /** Subset of `flows` whose server port is in `modbusPorts`. */
  modbusFlows: TcpFlow[];
}

/**
 * Walk a packet list through the full pipeline and return flows + Modbus ports.
 *
 * @param packets Decoded packet records (raw L2 bytes + timestamp).
 * @param getLinkType Returns the DLT for packet at index `i`. For classic
 *                    pcap this is a constant; for pcapng it varies per
 *                    interface (looked up by EPB interface_id).
 * @param warnings Array to receive non-fatal warnings (mutated in place).
 */
export function walkPackets(
  packets: PcapPacket[],
  getLinkType: (i: number) => number,
  warnings: string[],
): WalkResult {
  const labeled: AddressedTcpSegment[] = [];

  for (let i = 0; i < packets.length; i++) {
    const pkt = packets[i];
    const dlt = getLinkType(i);
    const l3 = decodeLinkLayer(pkt.data, dlt, warnings, i);
    if (!l3 || l3.length === 0) continue;

    let ip;
    try {
      ip = parseIp(l3);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('fragmentation')) {
        warnings.push(
          `pkt#${i}: skipping fragmented IPv4 packet (ts=${pkt.timestampSeconds}.${pkt.timestampMicroseconds})`,
        );
      }
      // Otherwise: not IPv4/v6 or too short — silently skip (common: ARP, ICMP, etc.)
      continue;
    }

    if (ip.protocol !== 6) continue; // not TCP

    let seg;
    try {
      // pcap timestamps are usec (or nsec for the nsec magic); we floor to ms
      // for the TcpSegment.timestamp field per the spec.
      const tsMs =
        pkt.timestampSeconds * 1000 + Math.floor(pkt.timestampMicroseconds / 1000);
      seg = parseTcp(ip.payload, ip.srcIp, ip.dstIp, tsMs);
    } catch {
      continue; // malformed TCP header — skip silently
    }

    labeled.push(seg as AddressedTcpSegment);
  }

  const flowWarnings: string[] = [];
  const flows = groupAndReassembleFlows(labeled, flowWarnings);
  for (const w of flowWarnings) warnings.push(w);

  const { modbusPorts, flows: modbusFlows } = detectModbusPorts(flows);

  return { labeled, flows, modbusPorts, modbusFlows };
}
