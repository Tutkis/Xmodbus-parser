'use client';

import { useMemo } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { tokenizeFrame, detectChanges } from '@/lib/colorize';
import type { ParsedField, ParsedFrame } from '@/lib/modbus';
import { cn } from '@/lib/utils';

interface Props {
  /** Currently highlighted field (from PacketDetails hover/select). */
  highlightedField: ParsedField | null;
}

export function PacketBytes({ highlightedField }: Props) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const selectedFrameIndex = useAppStore((s) => s.selectedFrameIndex);
  const frames = useAppStore((s) => s.frames);
  const allFrames = frames;

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

  if (!frame || !renderable) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div className="text-muted-foreground text-sm">{t('pane.bytes')}</div>
      </div>
    );
  }

  // Build hex dump lines (16 bytes per line)
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
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground shrink-0">
        <span className="font-medium text-foreground">{t('pane.bytes')}</span>
        <span>·</span>
        <span className="font-mono">{frame.raw.length} bytes</span>
        {prevFrame && changedOffsets.size > 0 && (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
            {changedOffsets.size} changed
          </span>
        )}
      </div>
      <div className="flex-1 overflow-auto p-2">
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
                      <span
                        key={i}
                        className="inline-block w-[22px] sm:w-[26px] text-center"
                      >
                        {' '}
                      </span>
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
                {roleLabel(role)}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function roleLabel(role: string): string {
  const map: Record<string, string> = {
    address: 'Addr',
    unit_id: 'Unit',
    function: 'FC',
    exception_flag: 'Exc',
    exception_code: 'ExcCode',
    start_addr_hi: 'AddrHi',
    start_addr_lo: 'AddrLo',
    quantity_hi: 'QtyHi',
    quantity_lo: 'QtyLo',
    byte_count: 'BC',
    data: 'Data',
    crc_lo: 'CRC',
    crc_hi: 'CRC',
    lrc: 'LRC',
    mbap_transaction_hi: 'Tx',
    mbap_transaction_lo: 'Tx',
    mbap_protocol_hi: 'Proto',
    mbap_protocol_lo: 'Proto',
    mbap_length_hi: 'Len',
    mbap_length_lo: 'Len',
    sub_function: 'Sub',
    sub_data: 'SubData',
    mei_type: 'MEI',
    mei_data: 'MEIData',
    unknown: '?',
  };
  return map[role] ?? role;
}
