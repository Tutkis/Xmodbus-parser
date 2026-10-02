'use client';

import {
  parseStream,
  parseFrame,
  pairFrames,
  type ParsedFrame,
  type ParseOptions,
} from '@/lib/modbus';
import { parsePcapFile } from '@/lib/pcap';
import type { ParseSettings } from '@/lib/store/app-store';

export interface PcapParseResult {
  frames: ParsedFrame[];
  ports: number[];
  flowsCount: number;
  warnings: string[];
}

/**
 * Parse a free-form text input (hex dump, ASCII frame, or mixed) into
 * ParsedFrame[]. Auto-detects protocol unless settings.protocol is set.
 */
export function parseTextInput(
  text: string,
  settings: ParseSettings,
): ParsedFrame[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const opts: ParseOptions = {
    byteOrder: settings.byteOrder,
    dataType: settings.dataType,
    autoDetectByteOrder: settings.autoDetectByteOrder,
    baseOffset: settings.baseOffset,
    addressFormat: settings.addressFormat,
    registerMap: settings.registerMap,
  };

  if (settings.protocol !== 'auto') {
    opts.protocol = settings.protocol;
  }

  // Try stream parse first (handles multiple frames + auto-detect)
  let frames: ParsedFrame[] = [];
  try {
    frames = parseStream(trimmed, opts);
  } catch {
    // Fallback: single-frame parse
    try {
      const single = parseFrame(trimmed, opts);
      if (single) frames = [single];
    } catch {
      /* swallow; caller will see empty array */
    }
  }

  // Pair req/resp on small/medium inputs.
  if (frames.length > 0 && frames.length <= 256) {
    pairFrames(frames);
  }

  return frames;
}

/**
 * Parse a pcap/pcapng file. Extracts TCP flows on Modbus ports
 * (auto-detected, or filtered by `selectedPort` if given), reassembles
 * each direction, then parses each reassembled stream as Modbus TCP.
 */
export function parsePcapBuffer(
  buf: ArrayBuffer,
  settings: ParseSettings,
  selectedPort: number | null,
): PcapParseResult {
  const warnings: string[] = [];
  let parsed;
  try {
    parsed = parsePcapFile(buf);
  } catch (e) {
    warnings.push(
      `Failed to parse pcap: ${e instanceof Error ? e.message : String(e)}`,
    );
    return { frames: [], ports: [], flowsCount: 0, warnings };
  }
  warnings.push(...parsed.warnings);

  const opts: ParseOptions = {
    protocol: 'tcp',
    byteOrder: settings.byteOrder,
    dataType: settings.dataType,
    autoDetectByteOrder: settings.autoDetectByteOrder,
    baseOffset: settings.baseOffset,
    addressFormat: settings.addressFormat,
    registerMap: settings.registerMap,
  };

  // Determine which port(s) to use.
  const ports = parsed.detectedModbusPorts;
  const usePort =
    selectedPort !== null
      ? selectedPort
      : ports.length > 0
        ? ports[0]
        : null;

  let flows = parsed.tcpFlows;
  if (usePort !== null) {
    flows = flows.filter(
      (f) => f.srcPort === usePort || f.dstPort === usePort,
    );
  } else if (ports.length === 0) {
    // No Modbus detected: keep all flows so user can see something.
    warnings.push(
      'No Modbus traffic detected on port 502 or by heuristic. Showing all TCP flows.',
    );
  }

  const frames: ParsedFrame[] = [];
  for (const flow of flows) {
    if (flow.reassembled.length === 0) continue;
    try {
      const flowFrames = parseStream(flow.reassembled, opts);
      // Tag each frame with timestamp + flow label
      const t0 = flow.segments[0]?.timestamp ?? 0;
      flowFrames.forEach((f, i) => {
        f.timestamp = t0 + i; // approximate
        f.sourceLabel = `pcap:${flow.flowKey}`;
      });
      frames.push(...flowFrames);
    } catch {
      /* skip unparseable flow */
    }
  }

  // Pair req/resp
  if (frames.length > 0 && frames.length <= 256) {
    pairFrames(frames);
  }

  return {
    frames,
    ports,
    flowsCount: flows.length,
    warnings,
  };
}

/**
 * Convert a hex/ascii string to bytes for the parser. Delegates to the
 * parser's own coercion via parseStream — but this is useful for the
 * Builder tab when it needs to display bytes.
 */
export function safeInputToBytes(text: string): Uint8Array | null {
  try {
    // parseStream with a tiny input and minimal mode is the safest path.
    const frames = parseStream(text, { minimal: true } as ParseOptions);
    return frames[0]?.raw ?? null;
  } catch {
    return null;
  }
}

/** Sample data for the "Try sample" button — RTU read holding registers. */
export const SAMPLE_HEX = `01 03 00 00 00 0A C5 CD
01 03 14 00 0C 00 37 00 FF 00 00 00 0A 01 02 03 04 05 06 07 08 09 0A 7A 8D
02 03 00 00 00 01 C4 0B
02 03 02 12 34  // response with register value 0x1234
02 83 02 C1 71  // exception: illegal address
00 01 00 00 00 06 01 03 00 00 00 0A  // Modbus TCP request
00 01 00 00 00 17 01 03 14 00 0C 00 37 00 FF 00 00 00 0A 01 02 03 04 05 06 07 08 09 0A  // Modbus TCP response`;
