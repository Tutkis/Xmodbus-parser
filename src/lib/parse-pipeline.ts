'use client';

import {
  parseStream,
  parseFrame,
  pairFrames,
  detectProtocol,
  type ParsedFrame,
  type ParseOptions,
  type ModbusProtocol,
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
 * ParsedFrame[]. Auto-detects protocol per-segment to support mixed
 * RTU + TCP + ASCII input in a single paste.
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

  // If user forced a specific protocol, use single-protocol stream parse.
  if (settings.protocol !== 'auto') {
    opts.protocol = settings.protocol;
    return safeParseStream(trimmed, opts);
  }

  // Auto-detect: check if input is single-protocol or mixed.
  // ASCII is easy — starts with ':'. For hex dumps, split by lines and
  // detect TCP vs RTU per line.
  if (trimmed.startsWith(':')) {
    return safeParseStream(trimmed, { ...opts, protocol: 'ascii' });
  }

  // Split into lines, strip comments, group by detected protocol.
  const lines = trimmed.split(/\r?\n/).map((l) => l.replace(/\/\/.*$|#.*$/, '').trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  // Detect protocol per line.
  const lineProtocols: Array<{ protocol: ModbusProtocol | null; line: string }> = lines.map((line) => ({
    protocol: detectProtocol(line),
    line,
  }));

  // If all lines detect as the same protocol, use efficient stream parse.
  const protocols = new Set(lineProtocols.map((lp) => lp.protocol));
  if (protocols.size === 1 && !protocols.has(null)) {
    const proto = lineProtocols[0].protocol!;
    return safeParseStream(trimmed, { ...opts, protocol: proto });
  }

  // Mixed protocols (or some undetectable): parse line-by-line, grouping
  // consecutive same-protocol lines into stream segments.
  // NOTE: do NOT pair within each segment — local indices would be wrong
  // after merge. Pair once on the full merged array at the end.
  const frames: ParsedFrame[] = [];
  let currentProto: ModbusProtocol | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentLines.length === 0 || currentProto === null) return;
    const segment = currentLines.join('\n');
    try {
      const segFrames = parseStream(segment, { ...opts, protocol: currentProto });
      frames.push(...segFrames);
    } catch {
      /* skip unparseable segment */
    }
  };

  for (const { protocol, line } of lineProtocols) {
    const proto = protocol ?? 'rtu'; // default to RTU for undetectable
    if (proto !== currentProto) {
      flush();
      currentProto = proto;
      currentLines = [];
    }
    currentLines.push(line);
  }
  flush();

  // Clear any local pairing indices set by parseStream, then re-pair on
  // the full merged array so indices are globally correct.
  for (const f of frames) {
    f.pairedWith = undefined;
  }
  if (frames.length > 0 && frames.length <= 256) {
    pairFrames(frames);
  }

  return frames;
}

function safeParseStream(input: string, opts: ParseOptions): ParsedFrame[] {
  let frames: ParsedFrame[] = [];
  try {
    frames = parseStream(input, opts);
  } catch {
    try {
      const single = parseFrame(input, opts);
      if (single) frames = [single];
    } catch {
      /* swallow */
    }
  }
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

/** Sample data for the "Try sample" button — mixed RTU + TCP + exception. */
export const SAMPLE_HEX = `// === Modbus RTU traffic ===
01 03 00 00 00 0A C5 CD  // slave 1, FC 03, read 10 holding regs from addr 0 (request)
01 03 14 00 0C 00 37 00 FF 00 00 00 0A 01 02 03 04 05 06 07 08 09 0A 4B 54  // slave 1, FC 03, response (20 bytes data)
02 03 00 00 00 01 84 39  // slave 2, FC 03, read 1 holding reg from addr 0 (request)
02 03 02 12 34 F1 33  // slave 2, FC 03, response — register value 0x1234
02 83 02 30 F1  // slave 2, FC 83 (exception), code 02 = illegal data address

// === Modbus TCP traffic (MBAP header + PDU) ===
00 01 00 00 00 06 01 03 00 00 00 0A  // tx=1, unit 1, FC 03, read 10 regs from addr 0 (request)
00 01 00 00 00 17 01 03 14 00 0C 00 37 00 FF 00 00 00 0A 01 02 03 04 05 06 07 08 09 0A  // tx=1, unit 1, FC 03, response`;
