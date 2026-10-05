'use client';

import { useMemo } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { functionCodeName, EXCEPTION_CODES } from '@/lib/modbus';
import type { ParsedFrame } from '@/lib/modbus';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ArrowRight, ArrowLeft, AlertTriangle, Check, HelpingHand, Link2 } from 'lucide-react';

function statusIcon(frame: ParsedFrame) {
  if (frame.isException || frame.status === 'exception') {
    return <AlertTriangle className="h-3.5 w-3.5 text-red-500" />;
  }
  if (frame.status === 'valid') {
    return <Check className="h-3.5 w-3.5 text-emerald-500" />;
  }
  if (frame.status === 'truncated' || frame.status === 'malformed') {
    return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
  }
  if (frame.status === 'invalid_crc' || frame.status === 'invalid_lrc') {
    return <AlertTriangle className="h-3.5 w-3.5 text-red-500" />;
  }
  return <HelpingHand className="h-3.5 w-3.5 text-muted-foreground" />;
}

function directionIcon(direction: ParsedFrame['direction']) {
  if (direction === 'request') return <ArrowRight className="h-3 w-3 text-blue-500" />;
  if (direction === 'response') return <ArrowLeft className="h-3 w-3 text-emerald-500" />;
  return null;
}

function rowBg(frame: ParsedFrame, theme: ReturnType<typeof useTheme>['theme']): string {
  if (frame.isException || frame.status === 'exception') return theme.colors.exceptionBg;
  if (frame.status !== 'valid' && frame.status !== 'exception') return theme.colors.invalidBg;
  if (frame.direction === 'request') return theme.colors.requestBg;
  if (frame.direction === 'response') return theme.colors.responseBg;
  return 'transparent';
}

export function PacketList() {
  const { t } = useI18n();
  const { theme } = useTheme();
  const allFrames = useAppStore((s) => s.frames);
  const selectedFrameIndex = useAppStore((s) => s.selectedFrameIndex);
  const selectFrame = useAppStore((s) => s.selectFrame);
  const filterRules = useAppStore((s) => s.filterRules);
  const filterCombinator = useAppStore((s) => s.filterCombinator);

  const { filtered, filteredToAllIndex } = useMemo(() => {
    const active = filterRules.filter((r) => r.enabled && r.value.trim() !== '');
    if (active.length === 0) {
      return {
        filtered: allFrames,
        filteredToAllIndex: allFrames.map((_, i) => i),
      };
    }
    const out: ParsedFrame[] = [];
    const idx: number[] = [];
    for (let i = 0; i < allFrames.length; i++) {
      const f = allFrames[i];
      const results = active.map((rule) => matchRuleLocal(f, rule));
      const ok = filterCombinator === 'and' ? results.every(Boolean) : results.some(Boolean);
      if (ok) {
        out.push(f);
        idx.push(i);
      }
    }
    return { filtered: out, filteredToAllIndex: idx };
  }, [allFrames, filterRules, filterCombinator]);

  if (allFrames.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div className="text-muted-foreground text-sm">
          {t('pane.list_hint', { title: t('pane.list'), action: t('input.parse') })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground shrink-0">
        <span className="font-medium text-foreground">{t('pane.list')}</span>
        <span>·</span>
        <span>
          {filtered.length} / {allFrames.length}
        </span>
        {filterRules.filter((r) => r.enabled && r.value.trim()).length > 0 && (
          <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px]">
            {filterCombinator.toUpperCase()}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-surface border-b border-border">
            <tr className="text-left text-muted-foreground">
              <th className="px-2 py-1.5 font-medium w-[32px]">{t('column.index')}</th>
              <th className="px-2 py-1.5 font-medium w-[24px]">{t('column.direction')}</th>
              <th className="px-2 py-1.5 font-medium w-[36px] hidden xs:table-cell sm:table-cell">{t('column.station')}</th>
              <th className="px-2 py-1.5 font-medium w-[60px]">{t('column.function')}</th>
              <th className="px-2 py-1.5 font-medium">{t('column.info')}</th>
              <th className="px-2 py-1.5 font-medium w-[40px] hidden sm:table-cell">{t('column.length')}</th>
              <th className="px-2 py-1.5 font-medium w-[20px]"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((frame, displayIdx) => {
              const allIdx = filteredToAllIndex[displayIdx] ?? displayIdx;
              const isSelected = selectedFrameIndex === allIdx;
              const fc = frame.functionCode;
              const fcName = fc !== undefined ? functionCodeName(fc, t) : '—';
              const station = frame.slaveAddress ?? frame.unitId ?? '—';
              const exc = frame.isException && frame.exceptionCode !== undefined
                ? EXCEPTION_CODES[frame.exceptionCode]?.name ?? t('column.exception_short', { code: frame.exceptionCode })
                : null;

              // Combine hi/lo fields into 16-bit values for display.
              const addrFields = frame.fields.filter((f) => f.name.includes('start_address'));
              const qtyFields = frame.fields.filter((f) => f.name.includes('quantity'));
              const combinedAddr = combineHiLo(addrFields, frame);
              const combinedQty = combineHiLo(qtyFields, frame);
              const info = [
                combinedAddr !== null ? `@${combinedAddr}` : null,
                combinedQty !== null ? `q${combinedQty}` : null,
                exc,
              ].filter(Boolean).join(' ');

              return (
                <Tooltip key={allIdx}>
                  <TooltipTrigger asChild>
                    <tr
                      onClick={() => selectFrame(allIdx)}
                      className={cn(
                        'cursor-pointer border-b border-border/40 transition-colors',
                        isSelected && 'ring-1 ring-inset ring-accent',
                      )}
                      style={{
                        backgroundColor: isSelected
                          ? theme.colors.accent + '20'
                          : rowBg(frame, theme),
                      }}
                    >
                      <td className="px-2 py-1.5 font-mono text-muted-foreground">
                        {frame.pairedWith !== undefined ? (
                          <span className="inline-flex items-center gap-0.5">
                            <Link2 className="h-2.5 w-2.5 text-accent" />
                            {allIdx}
                          </span>
                        ) : allIdx}
                      </td>
                      <td className="px-2 py-1.5">{directionIcon(frame.direction)}</td>
                      <td className="px-2 py-1.5 font-mono hidden xs:table-cell sm:table-cell">{station}</td>
                      <td className="px-2 py-1.5 font-mono">
                        {fc !== undefined ? `0x${fc.toString(16).padStart(2, '0').toUpperCase()}` : '—'}
                      </td>
                      <td className="px-2 py-1.5 truncate max-w-[140px] sm:max-w-[200px]">
                        <span className="font-medium">{fcName}</span>
                        {info && <span className="text-muted-foreground ml-1 text-[10px] hidden sm:inline">{info}</span>}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-muted-foreground hidden sm:table-cell">{frame.raw.length}</td>
                      <td className="px-2 py-1.5">{statusIcon(frame)}</td>
                    </tr>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="font-mono text-xs max-w-md">
                    <div className="space-y-1">
                      <div>{t('pane.frame_tooltip', { index: allIdx, protocol: frame.protocol.toUpperCase(), direction: frame.direction })}</div>
                      <div className="text-muted-foreground">
                        {Array.from(frame.raw).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')}
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function matchRuleLocal(frame: ParsedFrame, rule: { field: string; op: string; value: string }): boolean {
  const v = rule.value.trim();
  if (!v) return true;
  let target: string | number | undefined;
  switch (rule.field) {
    case 'station': target = frame.slaveAddress ?? frame.unitId; break;
    case 'function': target = frame.functionCode; break;
    case 'direction': target = frame.direction; break;
    case 'status': target = frame.status; break;
    case 'register': {
      const n = parseNumLocal(v);
      if (n === null) return false;
      const af = frame.fields.find((f) => f.name.includes('start_address') || f.name.includes('address'));
      return !!(af && typeof af.value === 'number' && af.value === n);
    }
    case 'value': {
      const w = v.toLowerCase();
      if (frame.tokens.some((tk) => tk.value.toString(16).padStart(2, '0') === w)) return true;
      const n = parseNumLocal(v);
      return n !== null && frame.tokens.some((tk) => tk.value === n);
    }
  }
  if (target === undefined || target === null) return false;
  switch (rule.op) {
    case 'equals': return String(target) === v || target === parseNumLocal(v);
    case 'contains': return String(target).includes(v);
    case 'gt': { const n = parseNumLocal(v); return n !== null && typeof target === 'number' && target > n; }
    case 'lt': { const n = parseNumLocal(v); return n !== null && typeof target === 'number' && target < n; }
    case 'regex': { try { return new RegExp(v, 'i').test(String(target)); } catch { return false; } }
  }
  return false;
}
function parseNumLocal(s: string): number | null {
  s = s.trim().toLowerCase();
  if (s.startsWith('0x')) { const n = parseInt(s.slice(2), 16); return Number.isNaN(n) ? null : n; }
  const n = Number(s); return Number.isNaN(n) ? null : n;
}

/**
 * Combine hi/lo byte fields into a 16-bit value. Fields are sorted by
 * offset (hi comes first in Modbus big-endian). Falls back to reading
 * the raw frame bytes at the field offsets.
 */
function combineHiLo(
  fields: ParsedFrame['fields'],
  frame: ParsedFrame,
): number | null {
  if (fields.length === 0) return null;
  if (fields.length === 1 && typeof fields[0].value === 'number') {
    // Single combined field — use directly.
    return fields[0].value;
  }
  // Multiple fields (hi + lo) — combine by offset order.
  const sorted = [...fields].sort((a, b) => a.startOffset - b.startOffset);
  let result = 0;
  for (const f of sorted) {
    const byte = frame.raw[f.startOffset];
    if (byte === undefined) return null;
    result = (result << 8) | byte;
  }
  return result >>> 0;
}
