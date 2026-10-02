/**
 * @file colorize/tokenizer.ts
 * @description Transform a parsed Modbus frame into render-ready, theme-
 * colored byte & field descriptors.
 *
 * The tokenizer is intentionally decoupled from the concrete `ParsedFrame`
 * type produced by Task 1-a. It accepts a minimal structural shape
 * (`ParsedFrameLike`) so that:
 *  - circular dependencies between `lib/parse` and `lib/colorize` are
 *    avoided;
 *  - synthetic frames (e.g. unit tests, the frame-builder preview) can
 *    be tokenized without a full parser round-trip.
 *
 * Responsibilities:
 *  - Map each `ByteToken` to a `RenderableByte` carrying hex/ascii/role
 *    plus theme colors.
 *  - Group consecutive same-field bytes into `RenderableField` entries
 *    suitable for a Wireshark-style details pane.
 *  - Compute a row background from frame status / direction / exception
 *    flags.
 *  - Detect per-byte deltas vs. a previous frame (CAN-bus-style change
 *    highlighting).
 *  - Produce a Wireshark-style hex dump (`formatHexDump`).
 */
import type { RoleColor, Theme } from '../themes/types';

/* ------------------------------------------------------------------ *
 * Internal: theme role resolution (inlined to avoid runtime cross-deps)
 * ------------------------------------------------------------------ *
 * The three subsystems (i18n, themes, colorize) must remain independent
 * at runtime — only *type* cross-imports are allowed. So we inline the
 * trivial role-color fallback chain here instead of importing the
 * helper from `themes/index.ts`.
 *
 * Resolution order:
 *  1. `theme.colors.roles[role]`      — explicit role mapping
 *  2. `theme.colors.roles.unknown`    — default for unmapped roles
 *  3. `{ fg: textMuted, bg: 'transparent' }` — last-resort neutral
 */
function resolveRoleColorLocal(theme: Theme, role: string): RoleColor {
  const roles = theme.colors.roles;
  const r = roles[role] ?? roles.unknown;
  if (r) return r;
  return { fg: theme.colors.textMuted, bg: 'transparent' };
}

/* ------------------------------------------------------------------ *
 * Public types
 * ------------------------------------------------------------------ */

/**
 * Minimal byte token shape that the parser is expected to emit.
 * - `offset`   — 0-based position within the frame
 * - `value`    — unsigned byte 0..255
 * - `role`     — ByteRole string (validated against the theme at render time)
 * - `field`    — optional i18n key for the field this byte belongs to
 *                (e.g. `'field.start_address'`)
 * - `fieldValue` — optional pre-formatted display value for the parent
 *                  field (e.g. `'0x0010 (16)'`); used to populate
 *                  `RenderableField.valueDisplay`.
 */
export interface ByteToken {
  offset: number;
  value: number;
  role: string;
  field?: string;
  fieldValue?: string;
}

/**
 * Minimal ParsedFrame shape consumed by the tokenizer.
 * `status` is one of `'valid' | 'invalid_crc' | 'invalid_lrc' | 'truncated' | 'malformed' | 'exception'`
 * (matches the i18n keys `frame.*`).
 * `direction` is one of `'request' | 'response' | 'unknown'`.
 */
export interface ParsedFrameLike {
  status: string;
  direction: string;
  isException: boolean;
  tokens: ByteToken[];
}

/** Render-ready byte descriptor emitted by `tokenizeFrame`. */
export interface RenderableByte {
  /** 0-based offset within the frame. */
  offset: number;
  /** Raw byte value 0..255. */
  value: number;
  /** Lowercase two-digit hex, e.g. `'0a'`. */
  hex: string;
  /** Printable ASCII char, or `'.'` for non-printable. */
  ascii: string;
  /** ByteRole string (resolved against theme; defaults to `'unknown'`). */
  role: string;
  /** i18n key for the parent field, if any. */
  field?: string;
  /** Theme colors for this byte cell. */
  colors: RoleColor;
  /** `true` when this offset differs from the previous frame (delta highlight). */
  isChanged?: boolean;
  /** `true` when the user has selected this byte (UI-controlled). */
  isSelected?: boolean;
}

/** Render-ready field group emitted by `tokenizeFrame`. */
export interface RenderableField {
  /** i18n key for the field name, e.g. `'field.start_address'`. */
  name: string;
  /** Already-translated label (caller passes via `opts.labelOf` if it wants i18n). */
  label: string;
  /** Inclusive start offset. */
  startOffset: number;
  /** Inclusive end offset. */
  endOffset: number;
  /** Pre-formatted value (from `ByteToken.fieldValue` of the first token in the group). */
  valueDisplay: string;
  /** Byte values in this field, in offset order. */
  bytes: number[];
}

/** Render-ready frame emitted by `tokenizeFrame`. */
export interface RenderableFrame {
  /** Raw status string (matches `frame.*` i18n keys). */
  status: string;
  /** Raw direction string (matches `direction.*` i18n keys). */
  direction: string;
  /** Whether this frame is an exception response. */
  isException: boolean;
  /** Row background color derived from status/direction/isException. */
  rowBg: string;
  /** Renderable bytes, one per byte in the frame. */
  bytes: RenderableByte[];
  /** Renderable fields, grouped by `field` i18n key. */
  fields: RenderableField[];
}

/** Options accepted by `tokenizeFrame`. */
export interface TokenizeFrameOptions {
  /**
   * Optional set of byte offsets that should be marked as "changed"
   * (delta highlight). Typically produced by `detectChanges`.
   */
  changedOffsets?: Set<number>;
  /** Optional set of byte offsets that should be marked as "selected". */
  selectedOffsets?: Set<number>;
  /**
   * Function that turns a field i18n key into a display label.
   * Defaults to the identity function (so `label === name`).
   * Pass `i18n.t` to get properly localized labels.
   */
  labelOf?: (key: string) => string;
}

/** Options accepted by `formatHexDump`. */
export interface HexDumpOptions {
  /** Number of bytes per line. Default `16`. */
  bytesPerLine?: number;
}

/** One line of a Wireshark-style hex dump. */
export interface HexDumpLine {
  /** Zero-padded 8-hex-digit offset label, e.g. `'00000010'`. */
  offset: string;
  /** Renderable bytes on this line (length 0..bytesPerLine). */
  hex: RenderableByte[];
  /** Concatenated ASCII representation (one char per byte). */
  ascii: string;
}

/* ------------------------------------------------------------------ *
 * Internal helpers
 * ------------------------------------------------------------------ */

/**
 * Convert a byte value to a lowercase 2-digit hex string.
 * @param value - byte 0..255 (out-of-range values are masked to 0xFF)
 */
function toHex(value: number): string {
  const v = value & 0xff;
  return v.toString(16).padStart(2, '0');
}

/**
 * Convert a byte value to its printable ASCII representation.
 * Bytes in the printable ASCII range 0x20..0x7E are rendered as the
 * corresponding character; everything else (including DEL and high-bit)
 * is rendered as `'.'`.
 * @param value - byte 0..255
 */
function toAscii(value: number): string {
  const v = value & 0xff;
  if (v >= 0x20 && v <= 0x7e) return String.fromCharCode(v);
  return '.';
}

/**
 * Resolve the row background for a frame given its status/direction/isException.
 *
 * Priority:
 * 1. Invalid frames (bad CRC/LRC, truncated, malformed) → `invalidBg`
 * 2. Exception responses → `exceptionBg`
 * 3. Request direction → `requestBg`
 * 4. Response direction → `responseBg`
 * 5. Unknown direction → `surfaceAlt`
 */
function resolveRowBg(frame: ParsedFrameLike, theme: Theme): string {
  const c = theme.colors;
  if (
    frame.status === 'invalid_crc' ||
    frame.status === 'invalid_lrc' ||
    frame.status === 'truncated' ||
    frame.status === 'malformed'
  ) {
    return c.invalidBg;
  }
  if (frame.isException) return c.exceptionBg;
  if (frame.direction === 'request') return c.requestBg;
  if (frame.direction === 'response') return c.responseBg;
  return c.surfaceAlt;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Tokenize a parsed frame into a render-ready structure with theme colors.
 *
 * The function is pure: it does not touch the DOM or read theme state.
 * The caller passes the active `Theme` explicitly so the tokenizer is
 * testable and React-friendly (re-renders when theme changes).
 *
 * @param frame  - parsed frame (or any `ParsedFrameLike`)
 * @param theme  - active theme
 * @param opts   - optional changed/selected offset sets + label resolver
 * @returns a `RenderableFrame` ready for UI rendering
 */
export function tokenizeFrame(
  frame: ParsedFrameLike,
  theme: Theme,
  opts: TokenizeFrameOptions = {},
): RenderableFrame {
  const changed = opts.changedOffsets ?? new Set<number>();
  const selected = opts.selectedOffsets ?? new Set<number>();
  const labelOf = opts.labelOf ?? ((key: string) => key);

  const rowBg = resolveRowBg(frame, theme);

  const bytes: RenderableByte[] = frame.tokens.map((tok) => {
    const role = tok.role && tok.role.length > 0 ? tok.role : 'unknown';
    const colors = resolveRoleColorLocal(theme, role);
    return {
      offset: tok.offset,
      value: tok.value & 0xff,
      hex: toHex(tok.value),
      ascii: toAscii(tok.value),
      role,
      field: tok.field,
      colors,
      isChanged: changed.has(tok.offset) || undefined,
      isSelected: selected.has(tok.offset) || undefined,
    };
  });

  // Group consecutive bytes sharing the same `field` key into RenderableField
  // entries. Bytes without a `field` are skipped (they show up only in the
  // bytes pane, not the details pane).
  const fields: RenderableField[] = [];
  let i = 0;
  const tokens = frame.tokens;
  while (i < tokens.length) {
    const t = tokens[i];
    if (!t.field) {
      i++;
      continue;
    }
    const fieldName = t.field;
    const startOffset = t.offset;
    const startValue = t.fieldValue ?? '';
    const byteValues: number[] = [t.value & 0xff];
    let j = i + 1;
    while (j < tokens.length && tokens[j].field === fieldName) {
      byteValues.push(tokens[j].value & 0xff);
      j++;
    }
    const endOffset = tokens[j - 1].offset;
    fields.push({
      name: fieldName,
      label: labelOf(fieldName),
      startOffset,
      endOffset,
      valueDisplay: startValue,
      bytes: byteValues,
    });
    i = j;
  }

  return {
    status: frame.status,
    direction: frame.direction,
    isException: frame.isException,
    rowBg,
    bytes,
    fields,
  };
}

/**
 * Detect which byte offsets changed between two frames.
 *
 * Used for CAN-bus-style delta highlighting: when a stream of frames is
 * displayed (e.g. polling loop), unchanged bytes are dimmed and only the
 * changed bytes get a "changed" highlight.
 *
 * The comparison is byte-by-byte by offset. Bytes present in `curr` but
 * not in `prev` are considered changed. Bytes present in `prev` but not
 * in `curr` are ignored (the result set only contains offsets that exist
 * in `curr`).
 *
 * @param prev - previous frame, or `null` if `curr` is the first frame
 *               (in which case all offsets are considered "changed")
 * @param curr - current frame
 * @returns a `Set<number>` of changed offsets within `curr`
 */
export function detectChanges(
  prev: ParsedFrameLike | null,
  curr: ParsedFrameLike,
): Set<number> {
  const result = new Set<number>();

  if (!prev) {
    // First frame: every offset is "changed".
    for (const tok of curr.tokens) result.add(tok.offset);
    return result;
  }

  // Build a map of offset → value for the previous frame for O(1) lookup.
  const prevMap = new Map<number, number>();
  for (const tok of prev.tokens) prevMap.set(tok.offset, tok.value & 0xff);

  for (const tok of curr.tokens) {
    const prevVal = prevMap.get(tok.offset);
    if (prevVal === undefined || (tok.value & 0xff) !== prevVal) {
      result.add(tok.offset);
    }
  }
  return result;
}

/**
 * Format renderable bytes as a Wireshark-style hex dump.
 *
 * Each line contains:
 *  - 8-digit zero-padded hex offset (e.g. `00000010`)
 *  - up to `bytesPerLine` (default 16) renderable bytes
 *  - the ASCII representation of those bytes
 *
 * Bytes are split into lines based on their original offsets; the first
 * line begins at the lowest offset (typically 0). Lines are NOT padded
 * with empty cells — the last line may be short.
 *
 * @param bytes - renderable bytes (already tokenized & colored)
 * @param opts  - optional `{ bytesPerLine }` (default 16)
 * @returns array of `HexDumpLine` ready for layout
 */
export function formatHexDump(
  bytes: RenderableByte[],
  opts: HexDumpOptions = {},
): HexDumpLine[] {
  const bytesPerLine = opts.bytesPerLine && opts.bytesPerLine > 0
    ? Math.floor(opts.bytesPerLine)
    : 16;

  if (bytes.length === 0) return [];

  const lines: HexDumpLine[] = [];
  for (let i = 0; i < bytes.length; i += bytesPerLine) {
    const slice = bytes.slice(i, i + bytesPerLine);
    const lineStartOffset = slice[0].offset;
    lines.push({
      offset: lineStartOffset.toString(16).padStart(8, '0'),
      hex: slice,
      ascii: slice.map((b) => b.ascii).join(''),
    });
  }
  return lines;
}
