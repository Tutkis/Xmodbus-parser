'use client';

/**
 * @file Builder tab — interactive Modbus frame constructor.
 *
 * Lets the user pick protocol (RTU/ASCII/TCP), direction
 * (Request/Response/Exception), slave/unit id, function code, address,
 * quantity and values; calls `buildFrame()` from `@/lib/modbus` to produce
 * a valid frame with auto-computed CRC-16 / LRC-8 / MBAP length, and shows
 * the result as a space-separated hex string, a Wireshark-style coloured
 * byte dump (via `tokenizeFrame` from `@/lib/colorize`), and an ASCII
 * representation. Provides Copy + "Send to Parse tab" actions.
 */

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  AlertCircle,
  ArrowRightLeft,
  Clipboard,
  ClipboardCheck,
  Hammer,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  buildFrame,
  EXCEPTION_CODES,
  FUNCTION_CODES,
  functionCodeName,
  parseFrame,
  type BuildOptions,
  type ModbusProtocol,
} from '@/lib/modbus';
import { tokenizeFrame, formatHexDump } from '@/lib/colorize';
import type { ParsedFrame } from '@/lib/modbus';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/lib/store/app-store';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Switch } from '@/components/ui/switch';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Direction = 'request' | 'response' | 'exception';

interface BuilderState {
  protocol: ModbusProtocol;
  direction: Direction;
  slave: number;
  functionCode: number;
  startAddress: number;
  quantity: number;
  /** Single 16-bit value for FC 0x05/0x06. */
  writeSingleValue: number;
  /** "On" flag for FC 0x05 (coil). */
  writeSingleCoilOn: boolean;
  /** Hex/text input for FC 0x0F (bits) and 0x10 (registers). */
  writeMultipleText: string;
  /** Hex text for read response data (FC 0x01–0x04). */
  responseHex: string;
  /** Hex text for raw data section of less-common FCs. */
  subDataHex: string;
  /** Sub-function number for FC 0x08 / MEI type for 0x2B. */
  subFunction: number;
  /** MBAP transaction ID (TCP only). */
  transactionId: number;
  /** Exception code (Direction=Exception). */
  exceptionCode: number;
}

const DEFAULTS: BuilderState = {
  protocol: 'rtu',
  direction: 'request',
  slave: 1,
  functionCode: 0x03,
  startAddress: 0,
  quantity: 10,
  writeSingleValue: 0,
  writeSingleCoilOn: true,
  writeMultipleText: '0001 0002 0003 0004',
  responseHex: '',
  subDataHex: '',
  subFunction: 0,
  transactionId: 1,
  exceptionCode: 1,
};

/* ------------------------------------------------------------------ */
/* FC groups (used to decide which form fields are visible)            */
/* ------------------------------------------------------------------ */

const READ_FCS = new Set<number>([0x01, 0x02, 0x03, 0x04]);
const WRITE_SINGLE_FCS = new Set<number>([0x05, 0x06]);
const WRITE_MULTIPLE_FCS = new Set<number>([0x0f, 0x10]);
const SUB_FUNCTION_FCS = new Set<number>([0x08, 0x2b]);
/** FCs that take a start address. */
const START_ADDR_FCS = new Set<number>([
  0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x0f, 0x10, 0x16, 0x17,
]);
/** FCs that take a quantity. */
const QUANTITY_FCS = new Set<number>([
  0x01, 0x02, 0x03, 0x04, 0x0f, 0x10, 0x17,
]);

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Format a byte value as a 2-digit uppercase hex string. */
function hex2(value: number): string {
  return (value & 0xff).toString(16).padStart(2, '0').toUpperCase();
}

/** Format a 16-bit value as a 4-digit uppercase hex string. */
function hex4(value: number): string {
  return (value & 0xffff).toString(16).padStart(4, '0').toUpperCase();
}

/** Clamp a number to [min, max]; non-finite values fall back to min. */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

/** Parse a number from an input string; accepts decimal or 0x-prefixed hex. */
function parseNumberInput(s: string): number {
  const trimmed = s.trim().toLowerCase();
  if (trimmed === '') return 0;
  if (trimmed.startsWith('0x')) {
    const n = parseInt(trimmed.slice(2), 16);
    return Number.isNaN(n) ? 0 : n;
  }
  const n = parseInt(trimmed, 10);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Parse a flexible hex textarea into an array of byte values.
 *
 * Accepts spaces, `0x` prefixes, commas, semicolons, newlines, and tabs as
 * separators. Each token must be a valid hex pair (1–2 hex digits). Tokens
 * longer than 2 hex digits are split into consecutive byte pairs. Invalid
 * characters are silently dropped from each token; if a token has no hex
 * digits it is skipped entirely.
 *
 * @returns `{ bytes, error }` where `error` is a non-empty string iff the
 *          input contained a token that could not be parsed.
 */
function parseHexTextarea(text: string): { bytes: number[]; error: string | null } {
  const cleaned = text.replace(/0x/gi, '');
  const tokens = cleaned.split(/[\s,;]+/).filter((t) => t.length > 0);
  const bytes: number[] = [];
  let error: string | null = null;
  for (const tok of tokens) {
    if (!/^[0-9a-fA-F]+$/.test(tok)) {
      error = `Invalid token: "${tok}"`;
      continue;
    }
    // Pad to even length, then split into byte pairs.
    const padded = tok.length % 2 === 0 ? tok : '0' + tok;
    for (let i = 0; i < padded.length; i += 2) {
      bytes.push(parseInt(padded.slice(i, i + 2), 16));
    }
  }
  return { bytes, error };
}

/**
 * Parse a textarea of binary bit tokens ("1 0 1 1 0 0 1 1") into a boolean[].
 *
 * Accepts `0`/`1` (case-insensitive) and the words `true`/`false`/`on`/`off`.
 * Whitespace / commas / semicolons are separators. Invalid tokens are
 * reported via `error` but do not abort parsing.
 */
function parseBitsTextarea(text: string): { bits: boolean[]; error: string | null } {
  const tokens = text.split(/[\s,;]+/).filter((t) => t.length > 0);
  const bits: boolean[] = [];
  let error: string | null = null;
  for (const tok of tokens) {
    const lower = tok.toLowerCase();
    if (lower === '1' || lower === 'true' || lower === 'on') bits.push(true);
    else if (lower === '0' || lower === 'false' || lower === 'off') bits.push(false);
    else error = `Invalid bit token: "${tok}"`;
  }
  return { bits, error };
}

/**
 * Unpack a byte array into a boolean[] of bits (LSB-first per byte, matching
 * the Modbus spec for FC 0x0F).
 */
function bytesToBits(bytes: number[]): boolean[] {
  const bits: boolean[] = [];
  for (const b of bytes) {
    for (let bit = 0; bit < 8; bit++) {
      bits.push(((b >> bit) & 1) === 1);
    }
  }
  return bits;
}

/** Group a byte array into u16 big-endian values. */
function bytesToU16s(bytes: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    out.push((bytes[i] << 8) | bytes[i + 1]);
  }
  if (bytes.length % 2 === 1) {
    // Trailing odd byte → assume high byte of an incomplete u16.
    out.push((bytes[bytes.length - 1] << 8) & 0xffff);
  }
  return out;
}

/** Convert a Uint8Array to a space-separated uppercase hex string. */
function bytesToHexDump(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    if (i > 0) out += ' ';
    out += hex2(bytes[i]);
  }
  return out;
}

/** Build a {@link BuildOptions} struct from the current UI state. */
function stateToOptions(state: BuilderState): { options: BuildOptions | null; error: string | null } {
  const fc = state.functionCode;
  const isResponse = state.direction === 'response';
  const isException = state.direction === 'exception';

  const options: BuildOptions = {
    protocol: state.protocol,
    slaveAddress: state.slave,
    unitId: state.slave,
    functionCode: fc,
    transactionId: state.transactionId,
    isException,
    exceptionCode: state.exceptionCode,
  };

  if (isException) {
    return { options, error: null };
  }

  if (READ_FCS.has(fc)) {
    if (isResponse) {
      const { bytes, error } = parseHexTextarea(state.responseHex);
      if (error) return { options: null, error };
      options.responseData = bytes;
    } else {
      options.startAddress = state.startAddress;
      options.quantity = state.quantity;
    }
    return { options, error: null };
  }

  if (fc === 0x05) {
    options.startAddress = state.startAddress;
    options.coilValues = [state.writeSingleCoilOn];
    return { options, error: null };
  }

  if (fc === 0x06) {
    options.startAddress = state.startAddress;
    options.values = [state.writeSingleValue & 0xffff];
    return { options, error: null };
  }

  if (fc === 0x0f) {
    options.startAddress = state.startAddress;
    // Try bits first ("1 0 1 1 0"); fall back to hex bytes ("FF 01" → 16 bits).
    const bits = parseBitsTextarea(state.writeMultipleText);
    if (bits.bits.length > 0 && !bits.error) {
      options.coilValues = bits.bits;
      options.quantity = bits.bits.length;
    } else {
      const { bytes, error } = parseHexTextarea(state.writeMultipleText);
      if (error) return { options: null, error };
      const bools = bytesToBits(bytes);
      options.coilValues = bools;
      options.quantity = bools.length;
    }
    return { options, error: null };
  }

  if (fc === 0x10) {
    options.startAddress = state.startAddress;
    const { bytes, error } = parseHexTextarea(state.writeMultipleText);
    if (error) return { options: null, error };
    const u16s = bytesToU16s(bytes);
    options.values = u16s;
    options.quantity = u16s.length;
    return { options, error: null };
  }

  if (SUB_FUNCTION_FCS.has(fc)) {
    // Build responseData = [subFunction bytes, ...subData bytes].
    const data: number[] = [];
    if (fc === 0x08) {
      // Sub-function is a u16 (hi, lo).
      data.push((state.subFunction >>> 8) & 0xff);
      data.push(state.subFunction & 0xff);
    } else {
      // 0x2B MEI type is a single byte.
      data.push(state.subFunction & 0xff);
    }
    const { bytes, error } = parseHexTextarea(state.subDataHex);
    if (error) return { options: null, error };
    for (const b of bytes) data.push(b & 0xff);
    options.responseData = data;
    return { options, error: null };
  }

  // Other FCs (0x07, 0x0B, 0x0C, 0x11, 0x14, 0x15, 0x16, 0x17, 0x18, 0x2B
  // already handled above, default fallback): pass through subDataHex.
  if (state.subDataHex.trim().length > 0) {
    const { bytes, error } = parseHexTextarea(state.subDataHex);
    if (error) return { options: null, error };
    options.responseData = bytes;
  }
  return { options, error: null };
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

/** A labelled form field wrapper. */
function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint ? <p className="text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** A row of buttons for a 3-option toggle (Protocol / Direction). */
function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
}: {
  value: T;
  onValueChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  ariaLabel: string;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => {
        if (v) onValueChange(v as T);
      }}
      aria-label={ariaLabel}
      variant="outline"
      className="flex w-full h-10"
    >
      {options.map((opt) => (
        <ToggleGroupItem
          key={opt.value}
          value={opt.value}
          className="flex-1 h-10 text-xs sm:text-sm"
        >
          {opt.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** A number input that parses & clamps on blur, accepts decimal or hex. */
function NumberInput({
  value,
  onValueChange,
  min,
  max,
  id,
  placeholder,
  className,
}: {
  value: number;
  onValueChange: (n: number) => void;
  min: number;
  max: number;
  id?: string;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string>(String(value));

  // Resync the draft when the parent value changes externally (e.g. a default
  // reset, switching protocol, or new FC). This runs after every render where
  // `value` differs from the previous one — but since `value` only changes on
  // blur (we don't fire onChange during typing), the user's in-progress edit
  // is never clobbered.
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <Input
      id={id}
      inputMode="numeric"
      autoComplete="off"
      className={`h-10 font-mono ${className ?? ''}`}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const parsed = parseNumberInput(draft);
        const clamped = clamp(parsed, min, max);
        setDraft(String(clamped));
        onValueChange(clamped);
      }}
    />
  );
}

/** Render a single coloured byte chip. */
function ByteChip({
  hex,
  ascii,
  bg,
  fg,
  border,
  title,
}: {
  hex: string;
  ascii: string;
  bg: string;
  fg: string;
  border?: string;
  title?: string;
}) {
  const style: CSSProperties = { backgroundColor: bg, color: fg };
  if (border) style.border = `1px solid ${border}`;
  return (
    <span
      title={title}
      className="inline-flex h-6 min-w-[2rem] items-center justify-center rounded px-1 font-mono text-[11px] leading-none"
      style={style}
    >
      {hex}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function BuilderTab() {
  const { t } = useI18n();
  const { theme } = useTheme();
  const setInput = useAppStore((s) => s.setInput);
  const setTab = useAppStore((s) => s.setTab);

  const [state, setState] = useState<BuilderState>(DEFAULTS);
  const [copiedHex, setCopiedHex] = useState(false);
  const [copiedAscii, setCopiedAscii] = useState(false);

  /**
   * Translate with an inline English fallback. The `t()` from useI18n
   * returns the raw key string when a key is missing from the dictionary;
   * for keys not yet added to `en.ts` we pass a fallback so the UI never
   * shows e.g. "builder.direction" verbatim.
   */
  function tt(key: string, fallback: string): string {
    const v = t(key);
    return v === key ? fallback : v;
  }

  /** Convenience patch helper. */
  function patch(p: Partial<BuilderState>): void {
    setState((s) => ({ ...s, ...p }));
  }

  /* -------------------------------------------------------------- */
  /* Build + parse the frame (memoised)                             */
  /* -------------------------------------------------------------- */

  const built = useMemo(() => {
    const { options, error: optsErr } = stateToOptions(state);
    if (!options) return { error: optsErr ?? 'Invalid input', hex: '', ascii: '', parsed: null };
    try {
      const frame = buildFrame(options);
      let hex = '';
      let ascii = '';
      if (typeof frame === 'string') {
        // ASCII protocol: frame is the `:...\r\n` string.
        ascii = frame.replace(/\r\n$/, '');
        hex = ascii
          .slice(1)
          .match(/.{1,2}/g)
          ?.join(' ')
          .toUpperCase() ?? '';
      } else {
        hex = bytesToHexDump(frame);
        ascii = 'n/a';
      }
      // Parse the built frame so we can colourise it.
      let parsed: ParsedFrame | null = null;
      try {
        if (typeof frame === 'string') {
          parsed = parseFrame(frame, { protocol: 'ascii' });
        } else if (options.protocol === 'tcp') {
          parsed = parseFrame(frame, { protocol: 'tcp' });
        } else {
          parsed = parseFrame(frame, { protocol: 'rtu' });
        }
      } catch {
        parsed = null;
      }
      return { error: null, hex, ascii, parsed };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { error: msg, hex: '', ascii: '', parsed: null };
    }
  }, [state]);

  const renderable = useMemo(() => {
    if (!built.parsed) return null;
    return tokenizeFrame(built.parsed, theme, {
      labelOf: (key: string) => t(key),
    });
  }, [built.parsed, theme, t]);

  const hexDumpLines = useMemo(() => {
    if (!renderable) return [];
    return formatHexDump(renderable.bytes, { bytesPerLine: 16 });
  }, [renderable]);

  /* -------------------------------------------------------------- */
  /* Actions                                                        */
  /* -------------------------------------------------------------- */

  async function copyToClipboard(text: string, label: string, kind: 'hex' | 'ascii'): Promise<void> {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
      if (kind === 'hex') {
        setCopiedHex(true);
        setTimeout(() => setCopiedHex(false), 1500);
      } else {
        setCopiedAscii(true);
        setTimeout(() => setCopiedAscii(false), 1500);
      }
    } catch {
      toast.error('Clipboard unavailable');
    }
  }

  function sendToParse(): void {
    if (!built.hex) return;
    // For ASCII protocol, the `:...` string is what the parser expects.
    const text = state.protocol === 'ascii' ? built.ascii : built.hex;
    setInput(text, 'sample');
    setTab('parse');
    toast.success('Sent to Parse tab');
  }

  /* -------------------------------------------------------------- */
  /* Derived display flags                                          */
  /* -------------------------------------------------------------- */

  const fc = state.functionCode;
  const isTcp = state.protocol === 'tcp';
  const isAscii = state.protocol === 'ascii';
  const isException = state.direction === 'exception';
  const isResponse = state.direction === 'response';
  const isReadResponse = isResponse && READ_FCS.has(fc);

  const showStartAddress = !isException && START_ADDR_FCS.has(fc) && !isReadResponse;
  const showQuantity = !isException && QUANTITY_FCS.has(fc) && !isReadResponse;
  const showWriteSingle = !isException && fc === 0x05;
  const showWriteSingleRegister = !isException && fc === 0x06;
  const showWriteMultiple = !isException && WRITE_MULTIPLE_FCS.has(fc);
  const showSubFunction = !isException && SUB_FUNCTION_FCS.has(fc);
  const showReadResponseData = isReadResponse;
  const showSubDataHex =
    !isException &&
    !SUB_FUNCTION_FCS.has(fc) &&
    !READ_FCS.has(fc) &&
    !WRITE_SINGLE_FCS.has(fc) &&
    !WRITE_MULTIPLE_FCS.has(fc);

  const slaveLabel = isTcp
    ? t('field.unit_id')
    : t('builder.slave');

  /* -------------------------------------------------------------- */
  /* Render                                                         */
  /* -------------------------------------------------------------- */

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
      {/* ============ Left column: form ============ */}
      <div className="flex flex-col gap-4">
        {/* Header card */}
        <Card className="gap-0">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Hammer className="h-4 w-4 text-accent" />
              {t('builder.title')}
            </CardTitle>
            <CardDescription className="text-xs">
              {t('app.subtitle')}
            </CardDescription>
          </CardHeader>
        </Card>

        {/* Protocol + Direction */}
        <Card className="gap-4">
          <CardHeader className="pb-0">
            <CardTitle className="text-sm">{t('builder.protocol')} &amp; {tt('builder.direction', 'Direction')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label={t('builder.protocol')}>
              <SegmentedControl<ModbusProtocol>
                ariaLabel={t('builder.protocol')}
                value={state.protocol}
                onValueChange={(v) => patch({ protocol: v })}
                options={[
                  { value: 'rtu', label: 'RTU' },
                  { value: 'ascii', label: 'ASCII' },
                  { value: 'tcp', label: 'TCP' },
                ]}
              />
            </Field>
            <Field label={tt('builder.direction', 'Direction')}>
              <SegmentedControl<Direction>
                ariaLabel={tt('builder.direction', 'Direction')}
                value={state.direction}
                onValueChange={(v) => patch({ direction: v })}
                options={[
                  { value: 'request', label: t('direction.request') },
                  { value: 'response', label: t('direction.response') },
                  { value: 'exception', label: t('builder.exception') },
                ]}
              />
            </Field>
          </CardContent>
        </Card>

        {/* Identity & Function Code */}
        <Card className="gap-4">
          <CardHeader className="pb-0">
            <CardTitle className="text-sm">{t('builder.function')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={slaveLabel} htmlFor="builder-slave">
                <NumberInput
                  id="builder-slave"
                  value={state.slave}
                  onValueChange={(n) => patch({ slave: n })}
                  min={0}
                  max={255}
                />
              </Field>
              {isTcp ? (
                <Field label={tt('builder.transaction_id', 'Transaction ID')} htmlFor="builder-txn">
                  <NumberInput
                    id="builder-txn"
                    value={state.transactionId}
                    onValueChange={(n) => patch({ transactionId: n })}
                    min={0}
                    max={65535}
                  />
                </Field>
              ) : (
                <div className="hidden sm:block" />
              )}
            </div>

            <Field label={t('builder.function')} htmlFor="builder-fc">
              <Select
                value={hex2(fc)}
                onValueChange={(v) => patch({ functionCode: parseInt(v, 16) })}
              >
                <SelectTrigger id="builder-fc" className="h-10 w-full font-mono text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-[320px]">
                  {Object.keys(FUNCTION_CODES)
                    .map((k) => parseInt(k, 10))
                    .sort((a, b) => a - b)
                    .map((code) => (
                      <SelectItem key={code} value={hex2(code)} className="font-mono">
                        <span className="text-muted-foreground">{hex2(code)}</span>
                        <span className="ml-2">{functionCodeName(code)}</span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="font-mono">
                {hex2(fc)}
              </Badge>
              <span>{functionCodeName(fc)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Payload (conditional) */}
        {(showStartAddress ||
          showQuantity ||
          showWriteSingle ||
          showWriteSingleRegister ||
          showWriteMultiple ||
          showReadResponseData ||
          showSubFunction ||
          showSubDataHex ||
          isException) && (
          <Card className="gap-4">
            <CardHeader className="pb-0">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ArrowRightLeft className="h-3.5 w-3.5" />
                {t('builder.values')}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              {/* Exception code */}
              {isException && (
                <Field label={t('builder.exception_code')} htmlFor="builder-exc">
                  <Select
                    value={hex2(state.exceptionCode)}
                    onValueChange={(v) => patch({ exceptionCode: parseInt(v, 16) })}
                  >
                    <SelectTrigger id="builder-exc" className="h-10 w-full font-mono text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-[320px]">
                      {Object.keys(EXCEPTION_CODES)
                        .map((k) => parseInt(k, 10))
                        .sort((a, b) => a - b)
                        .map((code) => (
                          <SelectItem key={code} value={hex2(code)} className="font-mono">
                            <span className="text-muted-foreground">{hex2(code)}</span>
                            <span className="ml-2">
                              {EXCEPTION_CODES[code].name}
                            </span>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}

              {/* Start address */}
              {showStartAddress && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('builder.start_addr')} htmlFor="builder-start">
                    <NumberInput
                      id="builder-start"
                      value={state.startAddress}
                      onValueChange={(n) => patch({ startAddress: n })}
                      min={0}
                      max={65535}
                      placeholder="0x0000"
                    />
                  </Field>
                  {showQuantity && (
                    <Field label={t('builder.quantity')} htmlFor="builder-qty">
                      <NumberInput
                        id="builder-qty"
                        value={state.quantity}
                        onValueChange={(n) => patch({ quantity: n })}
                        min={1}
                        max={2000}
                      />
                    </Field>
                  )}
                </div>
              )}

              {/* Write single coil (FC 0x05) */}
              {showWriteSingle && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('builder.start_addr')} htmlFor="builder-ws-start">
                    <NumberInput
                      id="builder-ws-start"
                      value={state.startAddress}
                      onValueChange={(n) => patch({ startAddress: n })}
                      min={0}
                      max={65535}
                    />
                  </Field>
                  <Field label="Coil ON / OFF">
                    <div className="flex h-10 items-center gap-3 rounded-md border border-input px-3">
                      <Switch
                        checked={state.writeSingleCoilOn}
                        onCheckedChange={(v) => patch({ writeSingleCoilOn: v })}
                        aria-label="Coil state"
                      />
                      <span className="font-mono text-sm">
                        {state.writeSingleCoilOn ? '0xFF00 (ON)' : '0x0000 (OFF)'}
                      </span>
                    </div>
                  </Field>
                </div>
              )}

              {/* Write single register (FC 0x06) */}
              {showWriteSingleRegister && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('builder.start_addr')} htmlFor="builder-wsr-start">
                    <NumberInput
                      id="builder-wsr-start"
                      value={state.startAddress}
                      onValueChange={(n) => patch({ startAddress: n })}
                      min={0}
                      max={65535}
                    />
                  </Field>
                  <Field label={t('builder.values')} htmlFor="builder-wsr-val">
                    <NumberInput
                      id="builder-wsr-val"
                      value={state.writeSingleValue}
                      onValueChange={(n) => patch({ writeSingleValue: n })}
                      min={0}
                      max={65535}
                      placeholder="0x0000"
                    />
                  </Field>
                </div>
              )}

              {/* Write multiple (FC 0x0F / 0x10) */}
              {showWriteMultiple && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t('builder.start_addr')} htmlFor="builder-wm-start">
                      <NumberInput
                        id="builder-wm-start"
                        value={state.startAddress}
                        onValueChange={(n) => patch({ startAddress: n })}
                        min={0}
                        max={65535}
                      />
                    </Field>
                    <Field label={t('builder.quantity')} hint="Auto-derived from values if blank.">
                      <NumberInput
                        value={state.quantity}
                        onValueChange={(n) => patch({ quantity: n })}
                        min={1}
                        max={1968}
                      />
                    </Field>
                  </div>
                  <Field
                    label={
                      fc === 0x0f
                        ? 'Coil values (bits: 1 0 1 1, or hex bytes)'
                        : 'Register values (hex, e.g. "0001 0002 0003")'
                    }
                    htmlFor="builder-wm-text"
                  >
                    <Textarea
                      id="builder-wm-text"
                      className="font-mono text-xs min-h-[80px]"
                      value={state.writeMultipleText}
                      onChange={(e) => patch({ writeMultipleText: e.target.value })}
                      placeholder={fc === 0x0f ? '1 0 1 1 0 0 1 1' : '0001 0002 0003 0004'}
                    />
                  </Field>
                </>
              )}

              {/* Read response data */}
              {showReadResponseData && (
                <Field
                  label="Response data (hex bytes)"
                  htmlFor="builder-resp"
                  hint="Byte count is auto-computed from the data length."
                >
                  <Textarea
                    id="builder-resp"
                    className="font-mono text-xs min-h-[80px]"
                    value={state.responseHex}
                    onChange={(e) => patch({ responseHex: e.target.value })}
                    placeholder="00 01 0A FF"
                  />
                </Field>
              )}

              {/* Sub-function for FC 0x08 / 0x2B */}
              {showSubFunction && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label={fc === 0x2b ? 'MEI Type' : 'Sub-function'}
                    htmlFor="builder-sub"
                  >
                    <NumberInput
                      id="builder-sub"
                      value={state.subFunction}
                      onValueChange={(n) => patch({ subFunction: n })}
                      min={0}
                      max={65535}
                    />
                  </Field>
                  <Field label="Sub data (hex)" htmlFor="builder-sub-data">
                    <Input
                      id="builder-sub-data"
                      className="h-10 font-mono text-xs"
                      value={state.subDataHex}
                      onChange={(e) => patch({ subDataHex: e.target.value })}
                      placeholder="00 00"
                    />
                  </Field>
                </div>
              )}

              {/* Raw PDU data for less-common FCs */}
              {showSubDataHex && (
                <Field label="Raw PDU data (hex)" htmlFor="builder-raw-data">
                  <Textarea
                    id="builder-raw-data"
                    className="font-mono text-xs min-h-[80px]"
                    value={state.subDataHex}
                    onChange={(e) => patch({ subDataHex: e.target.value })}
                    placeholder="00 00"
                  />
                </Field>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* ============ Right column: output (sticky on lg+) ============ */}
      <div className="lg:sticky lg:top-4 lg:self-start">
        <Card className="gap-4">
          <CardHeader className="pb-0">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm">{t('builder.output')}</CardTitle>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => copyToClipboard(built.hex, 'Hex', 'hex')}
                  disabled={!built.hex}
                >
                  {copiedHex ? <ClipboardCheck className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
                  {t('builder.copy')}
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  className="h-8 gap-1.5 text-xs"
                  onClick={sendToParse}
                  disabled={!built.hex}
                >
                  <Send className="h-3.5 w-3.5" />
                  Send to Parse
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            {/* Build error */}
            {built.error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="font-medium">Build error</div>
                  <div className="mt-0.5 font-mono break-all">{built.error}</div>
                </div>
              </div>
            )}

            {/* Hex string */}
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Hex string</Label>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => copyToClipboard(built.hex, 'Hex', 'hex')}
                  disabled={!built.hex}
                >
                  {copiedHex ? <ClipboardCheck className="h-3 w-3" /> : <Clipboard className="h-3 w-3" />}
                  Copy
                </Button>
              </div>
              <div className="rounded-md border border-border bg-surfaceAlt p-3 font-mono text-xs break-all min-h-[2.5rem]">
                {built.hex || <span className="text-muted-foreground">—</span>}
              </div>
            </div>

            {/* ASCII representation */}
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">ASCII</Label>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => copyToClipboard(built.ascii, 'ASCII', 'ascii')}
                  disabled={!built.ascii || built.ascii === 'n/a'}
                >
                  {copiedAscii ? <ClipboardCheck className="h-3 w-3" /> : <Clipboard className="h-3 w-3" />}
                  Copy
                </Button>
              </div>
              <div className="rounded-md border border-border bg-surfaceAlt p-3 font-mono text-xs break-all min-h-[2.5rem]">
                {built.ascii ? (
                  <span className={built.ascii === 'n/a' ? 'text-muted-foreground' : ''}>
                    {built.ascii}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
            </div>

            <Separator />

            {/* Wireshark-style hex dump */}
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Byte view</Label>
              <div className="rounded-md border border-border bg-surfaceAlt p-3 overflow-x-auto">
                {hexDumpLines.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No bytes</div>
                ) : (
                  <div className="font-mono text-[11px] leading-relaxed">
                    {hexDumpLines.map((line) => (
                      <div
                        key={line.offset}
                        className="flex items-start gap-3 whitespace-nowrap"
                      >
                        <span className="text-muted-foreground select-none">
                          {line.offset}
                        </span>
                        <span className="flex flex-wrap gap-1">
                          {line.hex.map((b) => (
                            <ByteChip
                              key={b.offset}
                              hex={b.hex.toUpperCase()}
                              ascii={b.ascii}
                              bg={b.colors.bg}
                              fg={b.colors.fg}
                              border={b.colors.border}
                              title={`#${b.offset} · ${b.role}${
                                b.field ? ` · ${t(b.field)}` : ''
                              }`}
                            />
                          ))}
                        </span>
                        <span className="text-muted-foreground select-none">
                          {line.ascii}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Field-level summary */}
            {renderable && renderable.fields.length > 0 && (
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Fields</Label>
                <div className="rounded-md border border-border bg-surfaceAlt p-2 overflow-x-auto">
                  <table className="w-full text-[11px] font-mono">
                    <tbody>
                      {renderable.fields.map((f, i) => (
                        <tr key={i} className="border-b border-border/40 last:border-0">
                          <td className="py-1 pr-2 text-muted-foreground whitespace-nowrap">
                            {hex4(f.startOffset).slice(2)}–{hex4(f.endOffset).slice(2)}
                          </td>
                          <td className="py-1 pr-2 whitespace-nowrap">{f.label}</td>
                          <td className="py-1 text-right break-all">
                            {f.bytes.map((b) => hex2(b)).join(' ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Protocol / direction badge summary */}
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
              <Badge variant="outline" className="font-mono">
                {state.protocol.toUpperCase()}
              </Badge>
              <Badge variant="outline" className="font-mono">
                {state.direction}
              </Badge>
              <Badge variant="outline" className="font-mono">
                FC {hex2(fc)}
              </Badge>
              {built.parsed && (
                <Badge variant="outline" className="font-mono">
                  {t(`frame.${built.parsed.status}`)}
                </Badge>
              )}
              <span className="ml-auto">
                {isAscii ? 'LRC auto' : isTcp ? 'MBAP len auto' : 'CRC-16 auto'}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
