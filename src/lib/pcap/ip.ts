/**
 * @fileoverview IPv4 and IPv6 header parsers.
 *
 * Both parsers return the L4 payload (starting at the TCP/UDP header) as a
 * view into the input buffer — no copies. Fragmentation is detected but not
 * reassembled in v1; the caller is responsible for dropping or warning on
 * fragmented packets (handled by {@link parsePcapFile}).
 */

import { formatIpv4, formatIpv6 } from './util';
import type { IpPacket } from './types';

/** IP protocol numbers. */
export const IP_PROTO_ICMP = 1;
export const IP_PROTO_TCP = 6;
export const IP_PROTO_UDP = 17;

/** Bit mask for the IPv4 "More Fragments" flag. */
const IPV4_FLAG_MF = 0x2000;
/** Bit mask for the IPv4 fragment-offset field (lower 13 bits of bytes 6-7). */
const IPV4_FRAG_OFFSET_MASK = 0x1fff;

/**
 * Parse an IPv4 header.
 *
 * @param data Bytes starting at the IPv4 header.
 * @returns Parsed IP packet; `payload` is the L4 segment.
 * @throws if the packet is fragmented (caller should catch and warn).
 */
export function parseIpv4(data: Uint8Array): IpPacket {
  if (data.length < 20) {
    throw new Error(`IPv4 packet too short: ${data.length} bytes (need >= 20)`);
  }
  const versionIhl = data[0];
  const version = versionIhl >> 4;
  if (version !== 4) {
    throw new Error(`Not an IPv4 packet (version=${version})`);
  }
  const ihl = versionIhl & 0x0f;
  const headerLen = ihl * 4;
  if (headerLen < 20 || data.length < headerLen) {
    throw new Error(`Invalid IPv4 IHL: ${ihl} (headerLen=${headerLen}, packetLen=${data.length})`);
  }

  const flagsFrag = (data[6] << 8) | data[7];
  if ((flagsFrag & IPV4_FLAG_MF) !== 0 || (flagsFrag & IPV4_FRAG_OFFSET_MASK) !== 0) {
    // v1: do not reassemble; let the caller emit a warning and drop the segment.
    throw new Error(
      `IPv4 fragmentation not supported (MF=${(flagsFrag & IPV4_FLAG_MF) !== 0}, offset=${flagsFrag & IPV4_FRAG_OFFSET_MASK})`,
    );
  }

  const protocol = data[9];
  const srcIp = formatIpv4(data, 12);
  const dstIp = formatIpv4(data, 16);

  return {
    version: 4,
    srcIp,
    dstIp,
    protocol,
    payload: data.subarray(headerLen),
  };
}

/**
 * Parse an IPv6 header (40 bytes fixed, no extension headers in v1).
 *
 * @param data Bytes starting at the IPv6 header.
 * @returns Parsed IP packet; `payload` is the L4 segment (extension headers skipped if next-header is TCP/UDP).
 */
export function parseIpv6(data: Uint8Array): IpPacket {
  if (data.length < 40) {
    throw new Error(`IPv6 packet too short: ${data.length} bytes (need >= 40)`);
  }
  const version = data[0] >> 4;
  if (version !== 6) {
    throw new Error(`Not an IPv6 packet (version=${version})`);
  }

  // Next Header is at offset 6 (1 byte). For v1 simplicity, we walk a small
  // chain of well-known extension headers but bail out (treat as payload) on
  // anything unrecognized — Modbus captures rarely use extension headers.
  let nextHeader = data[6];
  let offset = 40;
  const EXT_HOP_BY_HOP = 0;
  const EXT_ROUTING = 43;
  const EXT_FRAGMENT = 44;
  const EXT_DEST_OPTS = 60;
  const EXT_ESP = 50;
  const EXT_AH = 51;
  const EXT_NONE = 59;

  while (
    nextHeader === EXT_HOP_BY_HOP ||
    nextHeader === EXT_ROUTING ||
    nextHeader === EXT_DEST_OPTS ||
    nextHeader === EXT_FRAGMENT ||
    nextHeader === EXT_AH
  ) {
    if (data.length < offset + 2) {
      throw new Error('Truncated IPv6 extension header');
    }
    nextHeader = data[offset];
    // ESP carries no next-header; treat the rest as opaque payload.
    if (nextHeader === EXT_ESP || nextHeader === EXT_NONE) break;
    const extLen = (data[offset + 1] + 1) * 8;
    offset += extLen;
  }

  const srcIp = formatIpv6(data, 8);
  const dstIp = formatIpv6(data, 24);

  return {
    version: 6,
    srcIp,
    dstIp,
    protocol: nextHeader,
    payload: data.subarray(offset),
  };
}

/**
 * Dispatch to {@link parseIpv4} or {@link parseIpv6} based on the first nibble.
 * Throws for unknown versions.
 */
export function parseIp(data: Uint8Array): IpPacket {
  if (data.length < 1) {
    throw new Error('Empty IP packet');
  }
  const version = data[0] >> 4;
  if (version === 4) return parseIpv4(data);
  if (version === 6) return parseIpv6(data);
  throw new Error(`Unknown IP version: ${version}`);
}
