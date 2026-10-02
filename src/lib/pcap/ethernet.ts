/**
 * @fileoverview Ethernet II frame parser, including 802.1Q VLAN decapsulation.
 *
 * The Ethernet II header is 14 bytes:
 *
 * ```
 * 0                 6                 12     14
 * +-----------------+-----------------+------+------+
 * |  dst MAC (6B)   |  src MAC (6B)   | EtherType (2B, big-endian) |
 * +-----------------+-----------------+------+------+
 * ```
 *
 * If EtherType == 0x8100, a 4-byte 802.1Q tag follows: 2-byte TCI
 * (3-bit PRI, 1-bit DEI, 12-bit VLAN ID), then the real 2-byte EtherType.
 * QinQ (0x88a8) is handled the same way (only the outer VLAN ID is reported).
 */

import { formatMac } from './util';
import type { EthernetFrame } from './types';

/** EtherType values we care about. */
export const ETHERTYPE_IPV4 = 0x0800;
export const ETHERTYPE_IPV6 = 0x86dd;
export const ETHERTYPE_VLAN = 0x8100;
export const ETHERTYPE_QINQ = 0x88a8;

/**
 * Parse an Ethernet II frame.
 *
 * Does NOT handle 802.3 LLC frames (length field <= 1500). For those, an
 * error is thrown — Modbus captures are virtually always Ethernet II.
 *
 * @param data Raw bytes starting at the Ethernet header.
 * @returns Parsed frame with L3 payload view (no copy).
 */
export function parseEthernet(data: Uint8Array): EthernetFrame {
  if (data.length < 14) {
    throw new Error(`Ethernet frame too short: ${data.length} bytes (need >= 14)`);
  }

  const dstMac = formatMac(data, 0);
  const srcMac = formatMac(data, 6);
  // EtherType is always big-endian (network byte order).
  let ethertype = (data[12] << 8) | data[13];
  let offset = 14;
  let vlanId: number | undefined;

  // Strip VLAN tags (802.1Q and QinQ). Only the outermost VLAN ID is kept.
  while (ethertype === ETHERTYPE_VLAN || ethertype === ETHERTYPE_QINQ) {
    if (data.length < offset + 4) {
      throw new Error('Truncated VLAN tag in Ethernet frame');
    }
    const tci = (data[offset] << 8) | data[offset + 1];
    vlanId = tci & 0x0fff;
    ethertype = (data[offset + 2] << 8) | data[offset + 3];
    offset += 4;
  }

  return {
    dstMac,
    srcMac,
    ethertype,
    vlanId,
    payload: data.subarray(offset),
  };
}
