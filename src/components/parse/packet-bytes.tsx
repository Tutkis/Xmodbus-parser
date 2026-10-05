'use client';

import { useMemo, useState } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { tokenizeFrame, detectChanges } from '@/lib/colorize';
import type { ParsedField, ParsedFrame } from '@/lib/modbus';
import { functionCodeName, EXCEPTION_CODES } from '@/lib/modbus';
import { cn } from '@/lib/utils';
import { Grid3x3, AlignJustify } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface Props {
  highlightedField: ParsedField | null;
}

type ViewMode = 'grid' | 'hex';

export function PacketBytes({ highlightedField }: Props) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const selectedFrameIndex = useAppStore((s) => s.selectedFrameIndex);
  const frames = useAppStore((s) => s.frames);
  const allFrames = frames;
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [hoveredField, setHoveredField] = useState<string | null>(null);

  const frame: ParsedFrame | null =
    selectedFrameIndex !== null && frames[selectedFrameIndex] ? frames[selectedFrameIndex] : null;

  const prevFrame: ParsedFrame | null =
    selectedFrameIndex !== null && selectedFrameIndex > 0
      ? allFrames[selectedFrameIndex - 1]
      : null;

  const renderable = useMemo(() => {
    if (!frame) return null;
    return tokenizeFrame(frame as never, theme);
  }, [frame, theme]);

  const changedOffsets = useMemo(() => {
    if (!frame || !prevFrame) return new Set<number>();
    return detectChanges(prevFrame as never, frame as never);
  }, [frame, prevFrame]);

  const highlightOffsets = useMemo(() => {
    if (!highlightedField) return null;
    const set = new Set<number>();
    for (let i = highlightedField.startOffset; i < highlightedField.endOffset; i++) {
      set.add(i);
    }
    return set;
  }, [highlightedField]);

  // Active field for highlighting (from details hover or internal hover)
  const activeFieldName = hoveredField ?? highlightedField?.name ?? null;

  if (!frame || !renderable) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div className="text-muted-foreground text-sm">{t('pane.bytes')}</div>
      </div>
    );
  }

  const totalBytes = frame.raw.length;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground shrink-0">
        <span className="font-medium text-foreground">{t('pane.bytes')}</span>
        <span>·</span>
        <span className="font-mono">{totalBytes} B</span>
        {prevFrame && changedOffsets.size > 0 && (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
            {t('bytes.changed', { count: changedOffsets.size })}
          </span>
        )}
        <div className="flex-1" />
        {/* View mode toggle */}
        <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={viewMode === 'grid' ? 'default' : 'ghost'}
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => setViewMode('grid')}
              >
                <Grid3x3 className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('bytes.view_grid')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={viewMode === 'hex' ? 'default' : 'ghost'}
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => setViewMode('hex')}
              >
                <AlignJustify className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('bytes.view_hex')}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-2">
        {viewMode === 'grid' ? (
          <FrameGrid
            frame={frame}
            renderable={renderable}
            changedOffsets={changedOffsets}
            highlightOffsets={highlightOffsets}
            activeFieldName={activeFieldName}
            onHoverField={setHoveredField}
            theme={theme}
            t={t}
          />
        ) : (
          <HexDump
            renderable={renderable}
            changedOffsets={changedOffsets}
            highlightOffsets={highlightOffsets}
          />
        )}
      </div>

      {/* Legend */}
      <div className="border-t border-border px-3 py-2 shrink-0">
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          {Array.from(new Set(renderable.bytes.map((b) => b.role))).slice(0, 8).map((role) => {
            const sample = renderable.bytes.find((b) => b.role === role);
            if (!sample) return null;
            return (
              <span
                key={role}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5"
                style={{ color: sample.colors.fg, backgroundColor: sample.colors.bg }}
              >
                {roleLabel(role, t)}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Grid view — 4 rows: hex / band / decimal / info                     */
/* ------------------------------------------------------------------ */

interface GridProps {
  frame: ParsedFrame;
  renderable: ReturnType<typeof tokenizeFrame>;
  changedOffsets: Set<number>;
  highlightOffsets: Set<number> | null;
  activeFieldName: string | null;
  onHoverField: (name: string | null) => void;
  theme: ReturnType<typeof useTheme>['theme'];
  t: (k: string, params?: Record<string, string | number>) => string;
}

function FrameGrid({
  frame,
  renderable,
  changedOffsets,
  highlightOffsets,
  activeFieldName,
  onHoverField,
  theme,
  t,
}: GridProps) {
  const totalBytes = frame.raw.length;
  // For very long frames, allow horizontal scroll
  const minWidth = totalBytes > 20 ? `${totalBytes * 32}px` : '100%';

  // Group bytes by field to build band segments
  const segments = useMemo(() => {
    return frame.fields.map((f) => {
      const span = f.endOffset - f.startOffset;
      const role = getRoleForField(f.name);
      const decimalValue = getDecimalValue(f, frame, t);
      return { field: f, span, role, decimalValue };
    });
  }, [frame, t]);

  const gridColumnTemplate = `repeat(${totalBytes}, minmax(28px, 1fr))`;

  return (
    <div style={{ minWidth }} className="overflow-x-auto">
      <div
        className="grid gap-[2px]"
        style={{ gridTemplateColumns: gridColumnTemplate }}
      >
        {/* Row 1: Hex bytes (each spans 1 column) */}
        {renderable.bytes.map((b, i) => {
          const isChanged = changedOffsets.has(b.offset);
          const isHighlighted = highlightOffsets?.has(b.offset);
          const isActive = activeFieldName && b.field === activeFieldName;
          return (
            <div
              key={`hex-${i}`}
              className="text-center font-mono text-[11px] sm:text-xs font-medium rounded px-0.5 py-1 cursor-pointer transition-transform"
              style={{
                color: b.colors.fg,
                backgroundColor: b.colors.bg,
                outline: isChanged ? '1px solid #f59e0b' : undefined,
                boxShadow: isActive || isHighlighted ? `inset 0 0 0 2px ${theme.colors.accent}` : undefined,
                transform: isActive || isHighlighted ? 'translateY(-2px)' : undefined,
                zIndex: isActive || isHighlighted ? 5 : undefined,
                position: 'relative' as const,
              }}
              onMouseEnter={() => onHoverField(b.field ?? null)}
              onMouseLeave={() => onHoverField(null)}
              title={b.field ? `${t(b.field)}: 0x${b.hex}` : `0x${b.hex}`}
            >
              {b.hex}
            </div>
          );
        })}

        {/* Row 2: Color band (segments span N columns) */}
        {segments.map((seg, i) => {
          const colors = getRoleColors(seg.role, theme);
          const isActive = activeFieldName === seg.field.name;
          return (
            <div
              key={`band-${i}`}
              className="rounded text-[9px] sm:text-[10px] font-semibold uppercase tracking-wide flex items-center justify-center overflow-hidden text-ellipsis whitespace-nowrap cursor-pointer transition-filter px-1 py-0.5"
              style={{
                gridColumn: `span ${seg.span}`,
                backgroundColor: colors.bg,
                color: colors.fg,
                boxShadow: isActive ? `inset 0 0 0 2px ${theme.colors.accent}` : undefined,
              }}
              onMouseEnter={() => onHoverField(seg.field.name)}
              onMouseLeave={() => onHoverField(null)}
            >
              {roleLabel(seg.role, t)}
            </div>
          );
        })}

        {/* Row 3: Decimal values (horizontal text, span N columns) */}
        {segments.map((seg, i) => {
          const isActive = activeFieldName === seg.field.name;
          const hasValue = seg.decimalValue !== null;
          if (!hasValue) {
            // Empty cell to maintain grid alignment
            return <div key={`dec-${i}`} style={{ gridColumn: `span ${seg.span}` }} />;
          }
          return (
            <div
              key={`dec-${i}`}
              className="rounded flex items-center justify-center gap-1 px-1 py-0.5 cursor-pointer overflow-hidden"
              style={{
                gridColumn: `span ${seg.span}`,
                backgroundColor: theme.colors.surfaceAlt,
                border: `1px solid ${theme.colors.border}`,
                boxShadow: isActive ? `inset 0 0 0 2px ${theme.colors.accent}` : undefined,
              }}
              onMouseEnter={() => onHoverField(seg.field.name)}
              onMouseLeave={() => onHoverField(null)}
            >
              <span className="text-[9px] text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                {seg.decimalValue!.label}:
              </span>
              <span className="text-[10px] sm:text-[11px] font-mono font-semibold text-foreground whitespace-nowrap overflow-hidden text-ellipsis">
                {seg.decimalValue!.value}
              </span>
            </div>
          );
        })}

        {/* Row 4: Field info (size + hex) */}
        {segments.map((seg, i) => (
          <div
            key={`info-${i}`}
            className="text-center text-[9px] text-muted-foreground font-mono overflow-hidden text-ellipsis whitespace-nowrap px-1"
            style={{ gridColumn: `span ${seg.span}` }}
          >
            {seg.span}B · 0x{seg.field.bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('')}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hex dump view (original, for toggle)                                */
/* ------------------------------------------------------------------ */

function HexDump({
  renderable,
  changedOffsets,
  highlightOffsets,
}: {
  renderable: ReturnType<typeof tokenizeFrame>;
  changedOffsets: Set<number>;
  highlightOffsets: Set<number> | null;
}) {
  const bytesPerLine = 16;
  const lines: Array<{
    offset: number;
    offsetHex: string;
    bytes: typeof renderable.bytes;
    ascii: string;
  }> = [];
  for (let i = 0; i < renderable.bytes.length; i += bytesPerLine) {
    const slice = renderable.bytes.slice(i, i + bytesPerLine);
    lines.push({
      offset: i,
      offsetHex: i.toString(16).padStart(8, '0'),
      bytes: slice,
      ascii: slice.map((b) => b.ascii).join(''),
    });
  }

  return (
    <div className="font-mono text-[11px] sm:text-xs leading-relaxed">
      {lines.map((line) => (
        <div
          key={line.offset}
          className="flex items-start gap-2 px-1 hover:bg-surfaceAlt rounded"
        >
          <span className="text-muted-foreground select-none w-[60px] shrink-0">
            {line.offsetHex}
          </span>
          <span className="flex-1 flex flex-wrap gap-0.5">
            {Array.from({ length: bytesPerLine }).map((_, i) => {
              const b = line.bytes[i];
              if (!b) {
                return (
                  <span key={i} className="inline-block w-[22px] sm:w-[26px] text-center">{' '}</span>
                );
              }
              const isChanged = changedOffsets.has(b.offset);
              const isHighlighted = highlightOffsets?.has(b.offset);
              return (
                <span
                  key={i}
                  title={b.field ? `${b.field}: 0x${b.hex}` : `0x${b.hex} (${b.value})`}
                  className={cn(
                    'inline-block w-[22px] sm:w-[26px] text-center rounded px-0.5',
                    isHighlighted && 'ring-1 ring-accent',
                  )}
                  style={{
                    color: b.colors.fg,
                    backgroundColor: b.colors.bg,
                    outline: isChanged ? '1px solid #f59e0b' : undefined,
                    fontWeight: isChanged || isHighlighted ? 600 : 400,
                  }}
                >
                  {b.hex}
                </span>
              );
            })}
          </span>
          <span className="text-muted-foreground select-none w-[80px] sm:w-[120px] shrink-0">
            {line.ascii}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function roleLabel(role: string, t: (k: string, params?: Record<string, string | number>) => string): string {
  const key = `role.${role}`;
  const translated = t(key);
  return translated === key ? role : translated;
}

function getRoleForField(fieldName: string): string {
  if (fieldName.includes('slave_address') || fieldName.includes('address')) return 'address';
  if (fieldName.includes('unit_id')) return 'unit_id';
  if (fieldName.includes('function_code')) return 'function';
  if (fieldName.includes('start_address')) return 'start_addr';
  if (fieldName.includes('quantity')) return 'quantity';
  if (fieldName.includes('byte_count')) return 'byte_count';
  if (fieldName.includes('crc')) return 'crc';
  if (fieldName.includes('lrc')) return 'lrc';
  if (fieldName.includes('transaction')) return 'mbap_transaction';
  if (fieldName.includes('protocol')) return 'mbap_protocol';
  if (fieldName.includes('length')) return 'mbap_length';
  if (fieldName.includes('exception')) return 'exception_code';
  if (fieldName.includes('data')) return 'data';
  return 'unknown';
}

function getRoleColors(role: string, theme: ReturnType<typeof useTheme>['theme']) {
  // Map role prefix to theme role colors
  const roleKey = role.startsWith('mbap_') ? `${role}_hi` : role;
  const colors = theme.colors.roles[roleKey] || theme.colors.roles.unknown || { fg: '#999', bg: 'transparent' };
  // For band segments, use the solid color (not the tinted background)
  // We'll use the fg color as the band background for better visibility
  return { fg: '#1a1a1a', bg: colors.fg };
}

function getDecimalValue(
  field: ParsedField,
  frame: ParsedFrame,
  t: (k: string, params?: Record<string, string | number>) => string,
): { label: string; value: string } | null {
  const name = field.name;

  // Slave address / unit ID
  if (name.includes('slave_address') || name.includes('unit_id')) {
    return { label: t('decimal.slave'), value: String(field.value) };
  }

  // Function code
  if (name.includes('function_code')) {
    const fc = frame.functionCode ?? 0;
    return { label: 'FC', value: `0x${fc.toString(16).padStart(2, '0').toUpperCase()}` };
  }

  // Start address
  if (name.includes('start_address')) {
    return { label: t('decimal.addr'), value: String(field.value) };
  }

  // Quantity
  if (name.includes('quantity')) {
    return { label: t('decimal.qty'), value: String(field.value) };
  }

  // Byte count
  if (name.includes('byte_count')) {
    return { label: t('decimal.bc'), value: String(field.value) };
  }

  // CRC / LRC
  if (name.includes('crc')) {
    return { label: 'CRC', value: frame.crcValid ? '✓' : '✗' };
  }
  if (name.includes('lrc')) {
    return { label: 'LRC', value: frame.lrcValid ? '✓' : '✗' };
  }

  // MBAP fields
  if (name.includes('transaction')) {
    return { label: t('decimal.tx'), value: String(field.value) };
  }
  if (name.includes('protocol')) {
    return { label: t('decimal.proto'), value: String(field.value) };
  }
  if (name.includes('length') && name.includes('mbap')) {
    return { label: t('decimal.len'), value: String(field.value) };
  }

  // Exception code
  if (name.includes('exception')) {
    const code = frame.exceptionCode ?? 0;
    const excName = EXCEPTION_CODES[code]?.name ?? `Code ${code}`;
    return { label: t('decimal.exc'), value: excName };
  }

  // Data — try to decode register values
  if (name.includes('data') && field.bytes.length >= 2) {
    const values: number[] = [];
    for (let i = 0; i + 1 < field.bytes.length; i += 2) {
      values.push((field.bytes[i] << 8) | field.bytes[i + 1]);
    }
    return { label: t('decimal.regs'), value: values.join(' · ') };
  }

  return null;
}
