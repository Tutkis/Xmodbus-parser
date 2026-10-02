'use client';

/**
 * @file timeline/arrow.tsx
 * @description Single arrow + label rendering one ParsedFrame in the
 * Timeline tab's sequence diagram.
 *
 * Each arrow lives inside the parent <SequenceDiagram> SVG. It draws:
 *   - a horizontal arrow line between the Master (left) and Slave (right)
 *     lanes (direction & colour driven by ParsedFrame.direction/status)
 *   - a top label line: "#i · FC name · slave/unit" with a status glyph
 *   - a bottom annotation line: addr/qty/values per the FC family
 *   - a transparent hit-area <rect> that captures clicks and hover
 *   - a native SVG <title> providing a richer multi-line tooltip with the
 *     raw hex and parsed fields (works in PDF export, no JS required)
 *
 * Clicking the arrow selects that frame in the store and switches to the
 * Parse tab (wired up by the parent via the `onSelect` callback).
 */

import { memo } from 'react';
import type { ParsedFrame, RegisterMapEntry } from '@/lib/modbus';
import {
  bytesToHex,
  exceptionCodeName,
  functionCodeName,
} from '@/lib/modbus';

/* ------------------------------------------------------------------ */
/* Colour bundle (lifted out so the parent paints it once)            */
/* ------------------------------------------------------------------ */

export interface ArrowColors {
  request: string;
  response: string;
  exception: string;
  unknown: string;
  text: string;
  textMuted: string;
  border: string;
}

/* ------------------------------------------------------------------ */
/* Props                                                              */
/* ------------------------------------------------------------------ */

export interface FrameArrowProps {
  frame: ParsedFrame;
  /** 0-based frame index in the parsed stream. */
  index: number;
  /** Y-coordinate (SVG pixels) of the arrow centre line. */
  y: number;
  /** X-coordinate of the Master lane lifeline. */
  masterX: number;
  /** X-coordinate of the Slave lane lifeline. */
  slaveX: number;
  /** Row height in SVG pixels (controls hit-area size & label spacing). */
  rowHeight: number;
  /** Base font size for labels. */
  fontSize: number;
  /** Theme-derived colours. */
  colors: ArrowColors;
  /** Register map for address→name substitution in annotations. */
  registerMap: RegisterMapEntry[];
  /** Fired when the user clicks the arrow. */
  onSelect: (index: number) => void;
}

/* ------------------------------------------------------------------ */
/* Field-extraction helpers                                           */
/* ------------------------------------------------------------------ */

/**
 * Concatenate the raw bytes of every ParsedField whose `name` matches
 * `fieldName`. The parser emits hi/lo byte-pairs as two separate fields
 * sharing the same `name` (e.g. 'field.start_address'); this merges them
 * back into a contiguous byte array so the caller can decode a 16-bit
 * value.
 */
function extractFieldBytes(frame: ParsedFrame, fieldName: string): number[] {
  const out: number[] = [];
  for (const f of frame.fields) {
    if (f.name === fieldName) {
      for (const b of f.bytes) out.push(b);
    }
  }
  return out;
}

/** Decode a 2-byte big-endian unsigned 16-bit value, or `null`. */
function toU16(bytes: number[]): number | null {
  if (bytes.length < 2) return null;
  return ((bytes[0] & 0xff) << 8) | (bytes[1] & 0xff);
}

/** Look up a human-readable name for `addr` in the register map. */
function lookupRegisterName(
  map: RegisterMapEntry[],
  addr: number,
): string | undefined {
  return map.find((m) => m.address === addr)?.name;
}

/**
 * Best-effort extraction of the (16-bit) start/output/register address.
 * Different FCs use different field names ('field.start_address',
 * 'field.output_address', 'field.register_address',
 * 'field.reference_address'); try them in order.
 */
function getStartAddress(frame: ParsedFrame): number | null {
  const candidates = [
    'field.start_address',
    'field.read_start_address',
    'field.output_address',
    'field.register_address',
    'field.reference_address',
    'field.fifo_pointer_address',
  ];
  for (const name of candidates) {
    const v = toU16(extractFieldBytes(frame, name));
    if (v !== null) return v;
  }
  return null;
}

/** Same as above but for the quantity field. */
function getQuantity(frame: ParsedFrame): number | null {
  const candidates = ['field.quantity', 'field.read_quantity', 'field.write_quantity'];
  for (const name of candidates) {
    const v = toU16(extractFieldBytes(frame, name));
    if (v !== null) return v;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Annotation builder                                                 */
/* ------------------------------------------------------------------ */

/**
 * Produce the short text shown beneath each arrow (e.g. "addr=0 qty=10"
 * for a read request, "values=[1,2,3,4,5]" for a read response,
 * "Exception: Illegal Data Address" for an exception).
 *
 * Returns the empty string when no useful annotation can be derived
 * (e.g. minimal-parsed frames with empty `fields`, or uncommon FCs).
 */
function buildAnnotation(
  frame: ParsedFrame,
  registerMap: RegisterMapEntry[],
): string {
  if (frame.isException) {
    const ecName =
      frame.exceptionCode !== undefined
        ? exceptionCodeName(frame.exceptionCode)
        : 'Unknown';
    return `Exception: ${ecName}`;
  }
  if (frame.status !== 'valid') {
    return `Status: ${frame.status}`;
  }

  const fc = frame.functionCode;
  if (fc === undefined) return '';

  const startAddr = getStartAddress(frame);
  const qty = getQuantity(frame);

  // If a register-map entry names this address, prefer the name; otherwise
  // show the raw numeric address (or '?' if we couldn't decode it).
  const addrText =
    startAddr !== null
      ? (lookupRegisterName(registerMap, startAddr) ?? `addr=${startAddr}`)
      : '';

  const join = (...parts: string[]) => parts.filter(Boolean).join(' ');

  /* Read family: 0x01-0x04 ------------------------------------------------- */
  if (fc >= 0x01 && fc <= 0x04) {
    if (frame.direction === 'request') {
      return join(addrText, qty !== null ? `qty=${qty}` : '');
    }
    if (frame.direction === 'response') {
      const dataBytes = extractFieldBytes(frame, 'field.data');
      const values: number[] = [];
      for (let i = 0; i + 1 < dataBytes.length; i += 2) {
        values.push(((dataBytes[i] & 0xff) << 8) | (dataBytes[i + 1] & 0xff));
      }
      if (values.length === 0) return addrText;
      const shown = values.slice(0, 5).join(',');
      const more = values.length > 5 ? ` …+${values.length - 5}` : '';
      return `values=[${shown}${more}]`;
    }
    return addrText;
  }

  /* Write single: 0x05 (coil) / 0x06 (register) --------------------------- */
  if (fc === 0x05 || fc === 0x06) {
    const valFieldName =
      fc === 0x05 ? 'field.output_value' : 'field.register_value';
    const val = toU16(extractFieldBytes(frame, valFieldName));
    return join(addrText, val !== null ? `val=${val}` : '');
  }

  /* Write multiple: 0x0F (coils) / 0x10 (registers) ----------------------- */
  if (fc === 0x0f || fc === 0x10) {
    return join(addrText, qty !== null ? `qty=${qty}` : '');
  }

  return '';
}

/* ------------------------------------------------------------------ */
/* Tooltip builder                                                    */
/* ------------------------------------------------------------------ */

/**
 * Multi-line tooltip text for the SVG <title> element. Native browser
 * tooltips render `\n` as line breaks (Firefox, Chrome, Safari).
 */
function buildTooltip(frame: ParsedFrame, index: number): string {
  const lines: string[] = [];
  lines.push(`Frame #${index + 1}`);
  lines.push(`Protocol: ${frame.protocol.toUpperCase()}`);
  lines.push(`Direction: ${frame.direction}`);
  lines.push(`Status: ${frame.status}`);
  if (frame.functionCode !== undefined) {
    const hex = frame.functionCode.toString(16).padStart(2, '0').toUpperCase();
    lines.push(`FC: 0x${hex} — ${functionCodeName(frame.functionCode)}`);
  }
  if (frame.slaveAddress !== undefined) {
    lines.push(`Slave: ${frame.slaveAddress}`);
  }
  if (frame.unitId !== undefined) {
    lines.push(`Unit: ${frame.unitId}`);
  }
  if (frame.transactionId !== undefined) {
    lines.push(`Txn: ${frame.transactionId}`);
  }
  if (frame.isException && frame.exceptionCode !== undefined) {
    lines.push(`Exception: ${exceptionCodeName(frame.exceptionCode)}`);
  }

  /* Raw hex (space-separated bytes) ------------------------------------- */
  const hex = bytesToHex(frame.raw).match(/.{1,2}/g)?.join(' ') ?? '';
  if (hex) lines.push(`Hex: ${hex}`);

  /* Parsed logical fields ----------------------------------------------- */
  if (frame.fields.length > 0) {
    lines.push('Fields:');
    for (const f of frame.fields) {
      const v =
        f.displayValue ??
        (typeof f.value === 'number' ? String(f.value) : f.value);
      lines.push(`  ${f.label}: ${v}`);
    }
  }

  if (frame.notes && frame.notes.length > 0) {
    lines.push(`Notes: ${frame.notes.join('; ')}`);
  }

  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */

function FrameArrowImpl(props: FrameArrowProps): React.JSX.Element {
  const {
    frame,
    index,
    y,
    masterX,
    slaveX,
    rowHeight,
    fontSize,
    colors,
    onSelect,
  } = props;

  const dir = frame.direction;
  const isException = frame.isException || frame.status === 'exception';
  const isValid = frame.status === 'valid';

  /* Determine endpoints, colour and arrowhead marker based on direction. */
  let startX: number;
  let endX: number;
  let color: string;
  let markerId: string;
  let dashed = false;
  let doubleHeaded = false;

  if (dir === 'request') {
    startX = masterX;
    endX = slaveX;
    color = colors.request;
    markerId = 'tl-arrow-request';
  } else if (dir === 'response') {
    startX = slaveX;
    endX = masterX;
    color = isException ? colors.exception : colors.response;
    markerId = isException ? 'tl-arrow-exception' : 'tl-arrow-response';
  } else {
    // Unknown direction (echo / symmetric FC) — gray dashed line with
    // arrowheads on BOTH ends to signal that direction is ambiguous.
    startX = masterX;
    endX = slaveX;
    color = colors.unknown;
    markerId = 'tl-arrow-unknown';
    dashed = true;
    doubleHeaded = true;
  }

  const midX = (startX + endX) / 2;
  const idLabel = `#${index + 1}`;
  const fcName = functionCodeName(frame.functionCode ?? 0);
  const station =
    frame.slaveAddress !== undefined
      ? `slave ${frame.slaveAddress}`
      : frame.unitId !== undefined
        ? `unit ${frame.unitId}`
        : '';
  const statusGlyph = isException ? '⚠' : isValid ? '✓' : '✗';
  const statusColor = isException
    ? colors.exception
    : isValid
      ? colors.response
      : colors.exception;

  const annotation = buildAnnotation(frame, props.registerMap);
  const tooltipText = buildTooltip(frame, index);

  /* Hit area: a transparent rect spanning the lane gap & most of the row. */
  const hitY = y - rowHeight / 2 + 2;
  const hitH = Math.max(8, rowHeight - 4);

  const labelY = y - Math.max(8, fontSize);
  const annotY = y + fontSize + 6;

  return (
    <g
      onClick={() => onSelect(index)}
      style={{ cursor: 'pointer' }}
      role="button"
      aria-label={`Frame ${index + 1}: ${fcName} ${station}`}
    >
      <title>{tooltipText}</title>

      {/* Transparent hit area (captures hover + click across the row) */}
      <rect
        x={masterX}
        y={hitY}
        width={Math.max(0, slaveX - masterX)}
        height={hitH}
        fill="transparent"
      />

      {/* Top label: #i · FC name · station + status glyph */}
      <text
        x={midX}
        y={labelY}
        textAnchor="middle"
        fontSize={fontSize}
        fill={colors.text}
        fontFamily="var(--font-sans)"
        pointerEvents="none"
      >
        <tspan>{idLabel}</tspan>
        <tspan> · </tspan>
        <tspan>{fcName}</tspan>
        {station && <tspan> · </tspan>}
        {station && <tspan>{station}</tspan>}
        <tspan fill={statusColor} fontWeight="bold" dx="4">
          {statusGlyph}
        </tspan>
      </text>

      {/* Arrow line */}
      <line
        x1={startX}
        y1={y}
        x2={endX}
        y2={y}
        stroke={color}
        strokeWidth={2}
        strokeDasharray={dashed ? '5 3' : undefined}
        markerEnd={`url(#${markerId})`}
        markerStart={doubleHeaded ? `url(#${markerId})` : undefined}
      />

      {/* Exception: extra ⚠ glyph at the line midpoint */}
      {isException && (
        <text
          x={midX}
          y={y + fontSize * 0.4 + 2}
          textAnchor="middle"
          fontSize={fontSize}
          fill={colors.exception}
          pointerEvents="none"
        >
          ⚠
        </text>
      )}

      {/* Bottom annotation (mono font for hex/value readability) */}
      {annotation && (
        <text
          x={midX}
          y={annotY}
          textAnchor="middle"
          fontSize={Math.max(9, fontSize - 1)}
          fill={colors.textMuted}
          fontFamily="var(--font-mono)"
          pointerEvents="none"
        >
          {annotation}
        </text>
      )}
    </g>
  );
}

/**
 * Memoised single-frame arrow. The parent re-renders on every zoom change
 * (which changes geometry for all arrows), but props other than geometry
 * (frame data, registerMap) are referentially stable across those
 * re-renders — React.memo lets us skip work when only the data references
 * change and geometry stays the same.
 */
export const FrameArrow = memo(FrameArrowImpl);
