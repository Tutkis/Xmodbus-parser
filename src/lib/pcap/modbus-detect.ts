/**
 * @fileoverview Modbus TCP port detection heuristics.
 *
 * A Modbus TCP frame is wrapped in the "MBAP" (Modbus Application Protocol)
 * header:
 *
 * ```
 * 0       2       4       6       7
 * +-------+-------+-------+-------+--------+
 * | Tx ID | Proto | Length| Unit  |  PDU   |
 * |  2B   | 2B=0  |  2B   | 1B    | var    |
 * +-------+-------+-------+-------+--------+
 * ```
 *
 * - `Proto` (bytes 2-3) MUST be 0x0000 for Modbus (other values are
 *   reserved/non-Modbus).
 * - `Length` (bytes 4-5, big-endian) counts the bytes that follow, i.e.
 *   `1 (Unit ID) + PDU length`. So the full frame size is `6 + length`.
 * - A clean reassembled stream is a concatenation of MBAP frames back-to-back.
 *
 * The detector walks each flow's reassembled stream and tries to parse it as
 * a sequence of MBAP frames. If ≥75% of frames parse cleanly (or all of them
 * if the stream is short), the flow's *server* port (the smaller of src/dst)
 * is reported as a Modbus port.
 */

import type { TcpFlow } from './types';

/** Default Modbus TCP port. */
export const MODBUS_DEFAULT_PORT = 502;

/** MBAP header fixed size. */
const MBAP_HEADER_LEN = 7;

/**
 * Try to walk `stream` as a sequence of MBAP frames. Returns the number of
 * bytes consumed cleanly (i.e. contiguous valid MBAP frames from offset 0),
 * or 0 if the very first frame is invalid.
 *
 * A "clean" walk is one where, for each frame:
 *   - There are at least MBAP_HEADER_LEN bytes remaining.
 *   - The protocol ID (bytes 2-3) is 0.
 *   - The length field (bytes 4-5) is >= 2 (unit ID + at least 1 PDU byte).
 *   - The length field does not exceed the remaining bytes after the header.
 */
function walkMbap(stream: Uint8Array): { frames: number; consumed: number } {
  let off = 0;
  let frames = 0;
  while (off + MBAP_HEADER_LEN <= stream.length) {
    const proto = (stream[off + 2] << 8) | stream[off + 3];
    if (proto !== 0) break;
    const length = (stream[off + 4] << 8) | stream[off + 5];
    if (length < 2) break;
    const frameLen = MBAP_HEADER_LEN - 1 + length; // 6 + length
    if (off + frameLen > stream.length) {
      // Last frame may be truncated if the capture was cut mid-frame. Be
      // lenient: accept it if it's at least the full MBAP header.
      if (off + MBAP_HEADER_LEN <= stream.length) {
        frames++;
        off = stream.length;
      }
      break;
    }
    frames++;
    off += frameLen;
  }
  return { frames, consumed: off };
}

/**
 * Heuristic: does `stream` look like Modbus TCP traffic?
 *
 * Returns true if either:
 *   - The stream is at least 7 bytes long AND walks cleanly as MBAP frames
 *     consuming the entire stream (or all but the final truncated frame), with
 *     at least one frame parsed.
 *   - OR the stream parses as multiple MBAP frames with >=75% byte coverage.
 */
function looksLikeModbus(stream: Uint8Array): boolean {
  if (stream.length < MBAP_HEADER_LEN) return false;
  const { frames, consumed } = walkMbap(stream);
  if (frames === 0) return false;
  // Acceptance: walked at least 75% of the stream cleanly.
  return consumed >= Math.floor(stream.length * 0.75);
}

/**
 * The "server" port of a flow: for Modbus, the device/server uses port 502
 * (or a fixed high port), and the client uses an ephemeral port. We use the
 * smaller of the two ports as the server-side guess — works well for 502 and
 * common alt ports like 5021, 1502, 10502.
 */
function serverPort(flow: TcpFlow): number {
  return Math.min(flow.srcPort, flow.dstPort);
}

/**
 * Detect Modbus TCP ports from a list of reassembled TCP flows.
 *
 * Strategy (in priority order):
 *   1. If any flow uses port 502, return `[502]` plus any other ports whose
 *      flows also look like Modbus.
 *   2. Otherwise, scan all flows; any flow whose reassembled stream passes
 *      the MBAP heuristic contributes its server port to the result.
 *   3. If still nothing matches, return the unique server-side ports of ALL
 *      flows that have payload, so the UI can let the user choose.
 *
 * @param flows Reassembled TCP flows (both directions of each conversation).
 * @returns The matched Modbus ports plus the filtered flow list (flows whose
 *          server port is in the matched set).
 */
export function detectModbusPorts(
  flows: TcpFlow[],
): { modbusPorts: number[]; flows: TcpFlow[] } {
  const portSet = new Set<number>();
  const flowsWithPayload = flows.filter((f) => f.reassembled.length >= MBAP_HEADER_LEN);

  // Pass 1: collect ports whose flows pass the MBAP heuristic.
  const heuristicPorts = new Set<number>();
  for (const flow of flowsWithPayload) {
    if (looksLikeModbus(flow.reassembled)) {
      heuristicPorts.add(serverPort(flow));
    }
  }

  // Step 1: 502 present anywhere → trust it, plus any other heuristic hits.
  const uses502 = flowsWithPayload.some((f) => f.srcPort === MODBUS_DEFAULT_PORT || f.dstPort === MODBUS_DEFAULT_PORT);
  if (uses502) {
    portSet.add(MODBUS_DEFAULT_PORT);
    for (const p of heuristicPorts) portSet.add(p);
  } else if (heuristicPorts.size > 0) {
    // Step 2: no 502, but heuristic found matches.
    for (const p of heuristicPorts) portSet.add(p);
  } else {
    // Step 3: nothing heuristic-matched; fall back to all ports with payload.
    for (const flow of flowsWithPayload) {
      portSet.add(serverPort(flow));
    }
  }

  const modbusPorts = Array.from(portSet).sort((a, b) => a - b);
  const matched = flows.filter((f) => modbusPorts.includes(serverPort(f)));

  return { modbusPorts, flows: matched };
}
