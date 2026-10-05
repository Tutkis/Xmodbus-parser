'use client';

/**
 * @file tabs/timeline-tab.tsx
 * @description Timeline tab — graphical Modbus master↔slave sequence
 * diagram rendered as pure SVG.
 *
 * Composition
 * ------------
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Sticky header: summary stats (total / requests / responses / │
 *   │ exceptions) + zoom toolbar + Export-PDF button                │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │ <SequenceDiagram> SVG                                         │
 *   │   Master ──── lifeline │ lifeline ──── Slave                  │
 *   │     ●──────────── arrow ────────▶                             │
 *   │     ◀──────────── arrow ─────────●                            │
 *   │   …                                                           │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * State
 * -----
 *   - `zoom` (0.5–2.0) is the only local UI state. Everything else
 *     comes from the Zustand store (frames, settings.registerMap) or
 *     the i18n / theme hooks.
 *   - Frames > 200 are sliced for performance; a warning banner is
 *     shown above the diagram in that case.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  Download,
  Maximize,
  Minus,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { useAppStore } from '@/lib/store/app-store';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  SequenceDiagram,
  TIMELINE_ZOOM_MAX,
  TIMELINE_ZOOM_MIN,
} from '@/components/timeline/sequence-diagram';

/** Slice threshold above which we render only the first N frames. */
const MAX_RENDERED_FRAMES = 200;

/* ------------------------------------------------------------------ */
/* Tab component                                                      */
/* ------------------------------------------------------------------ */

export function TimelineTab(): React.JSX.Element {
  const { t } = useI18n();
  const { theme } = useTheme();

  const frames = useAppStore((s) => s.frames);
  const registerMap = useAppStore((s) => s.settings.registerMap);
  const selectFrame = useAppStore((s) => s.selectFrame);
  const setTab = useAppStore((s) => s.setTab);

  const [zoom, setZoom] = useState<number>(1.0);

  /* Summary stats for the sticky header. */
  const stats = useMemo(() => {
    let requests = 0;
    let responses = 0;
    let exceptions = 0;
    let unknown = 0;
    for (const f of frames) {
      if (f.isException) exceptions++;
      if (f.direction === 'request') requests++;
      else if (f.direction === 'response') responses++;
      else unknown++;
    }
    return {
      total: frames.length,
      requests,
      responses,
      exceptions,
      unknown,
    };
  }, [frames]);

  /* Slice for performance when the stream is large. */
  const renderedFrames = useMemo(
    () => (frames.length > MAX_RENDERED_FRAMES ? frames.slice(0, MAX_RENDERED_FRAMES) : frames),
    [frames],
  );
  const truncated = frames.length > MAX_RENDERED_FRAMES;

  /* Click handler: select the frame in the store and jump to the Parse
     tab so the user can inspect byte-level detail. */
  const handleSelect = useCallback(
    (index: number) => {
      selectFrame(index);
      setTab('parse');
    },
    [selectFrame, setTab],
  );

  /* Zoom helpers. */
  const clampZoom = (z: number) =>
    Math.max(TIMELINE_ZOOM_MIN, Math.min(TIMELINE_ZOOM_MAX, z));
  const zoomIn = () => setZoom((z) => clampZoom(+(z + 0.1).toFixed(2)));
  const zoomOut = () => setZoom((z) => clampZoom(+(z - 0.1).toFixed(2)));
  const zoomFit = () => setZoom(1.0);
  const zoom100 = () => setZoom(1.0);

  const handleExportPdf = () => {
    toast({
      title: t('timeline.title'),
      description: t('timeline.pdf_export_soon'),
    });
  };

  /* ---- Empty state ------------------------------------------------- */
  if (frames.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
          <div
            className="grid h-12 w-12 place-items-center rounded-full border"
            style={{ borderColor: theme.colors.border, color: theme.colors.textMuted }}
          >
            <ArrowLeftRight className="h-6 w-6" />
          </div>
          <div>
            <div className="text-sm font-medium" style={{ color: theme.colors.text }}>
              {t('timeline.title')}
            </div>
            <div
              className="mt-1 text-xs"
              style={{ color: theme.colors.textMuted }}
            >
              {t('timeline.empty_hint')}
            </div>
          </div>
          <Button size="sm" onClick={() => setTab('parse')}>
            {t('app.tab.parse')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  /* ---- Main render ------------------------------------------------- */
  return (
    <Card className="gap-0 py-0">
      {/* Sticky header: stats + toolbar */}
      <div
        className="sticky top-14 z-30 flex flex-wrap items-center gap-2 border-b px-3 py-2 sm:px-4"
        style={{
          borderColor: theme.colors.border,
          background: theme.colors.surface,
        }}
      >
        {/* Summary stats */}
        <div className="flex flex-wrap items-center gap-1.5">
          <StatBadge
            label={t('timeline.total')}
            value={stats.total}
            color={theme.colors.text}
            bg={theme.colors.surfaceAlt}
            border={theme.colors.border}
          />
          <StatBadge
            label={t('timeline.request')}
            value={stats.requests}
            color={theme.colors.roles.function?.fg ?? theme.colors.accent}
            bg={theme.colors.requestBg}
            border={theme.colors.border}
          />
          <StatBadge
            label={t('timeline.response')}
            value={stats.responses}
            color={theme.colors.roles.data?.fg ?? theme.colors.accent}
            bg={theme.colors.responseBg}
            border={theme.colors.border}
          />
          {stats.exceptions > 0 && (
            <StatBadge
              label={t('timeline.exceptions')}
              value={stats.exceptions}
              color={theme.colors.roles.exception_flag?.fg ?? '#dc2626'}
              bg={theme.colors.exceptionBg}
              border={theme.colors.border}
            />
          )}
          {stats.unknown > 0 && (
            <StatBadge
              label={t('timeline.unknown')}
              value={stats.unknown}
              color={theme.colors.textMuted}
              bg={theme.colors.surfaceAlt}
              border={theme.colors.border}
            />
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {/* Zoom controls */}
          <div
            className="flex items-center gap-1 rounded-md border px-1 py-0.5"
            style={{ borderColor: theme.colors.border }}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={zoomOut}
                  disabled={zoom <= TIMELINE_ZOOM_MIN}
                  aria-label={t('timeline.zoom_out')}
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('timeline.zoom_out')}</TooltipContent>
            </Tooltip>

            <Slider
              className="w-24"
              min={Math.round(TIMELINE_ZOOM_MIN * 100)}
              max={Math.round(TIMELINE_ZOOM_MAX * 100)}
              step={5}
              value={[Math.round(zoom * 100)]}
              onValueChange={(v) => setZoom(v[0] / 100)}
              aria-label={t('timeline.zoom_level')}
            />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={zoomIn}
                  disabled={zoom >= TIMELINE_ZOOM_MAX}
                  aria-label={t('timeline.zoom_in')}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('timeline.zoom_in')}</TooltipContent>
            </Tooltip>

            <span
              className="w-10 text-center text-[11px] font-mono"
              style={{ color: theme.colors.textMuted }}
            >
              {Math.round(zoom * 100)}%
            </span>
          </div>

          <Separator
            orientation="vertical"
            decorative
            className="self-stretch w-px"
            style={{ height: 24 }}
          />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={zoomFit}
                aria-label={t('timeline.fit_to_container')}
              >
                <Maximize className="h-3.5 w-3.5" />
                <span className="hidden sm:inline ml-1 text-xs">{t('timeline.fit')}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('timeline.fit_to_container')}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={zoom100}
                aria-label={t('timeline.reset_100')}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span className="hidden sm:inline ml-1 text-xs">{t('timeline.pct_100')}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('timeline.reset_100')}</TooltipContent>
          </Tooltip>

          <Separator
            orientation="vertical"
            decorative
            className="self-stretch w-px"
            style={{ height: 24 }}
          />

          <Button
            variant="outline"
            size="sm"
            className="h-7"
            onClick={handleExportPdf}
          >
            <Download className="h-3.5 w-3.5" />
            <span className="text-xs">{t('timeline.export_pdf')}</span>
          </Button>
        </div>
      </div>

      {/* Truncation warning */}
      {truncated && (
        <div
          className="flex items-center gap-2 px-3 py-1.5 text-xs sm:px-4"
          style={{
            background: theme.colors.invalidBg,
            color: theme.colors.text,
            borderBottom: `1px solid ${theme.colors.border}`,
          }}
        >
          <AlertTriangle
            className="h-3.5 w-3.5 shrink-0"
            style={{ color: theme.colors.roles.exception_flag?.fg ?? '#dc2626' }}
          />
          <span>
            {t('timeline.truncation_warning', { shown: MAX_RENDERED_FRAMES, total: frames.length })}
          </span>
        </div>
      )}

      {/* The diagram itself */}
      <div className="px-1 py-2 sm:px-2">
        <SequenceDiagram
          frames={renderedFrames}
          registerMap={registerMap}
          theme={theme}
          zoom={zoom}
          onSelect={handleSelect}
        />
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Stat badge                                                         */
/* ------------------------------------------------------------------ */

interface StatBadgeProps {
  label: string;
  value: number;
  color: string;
  bg: string;
  border: string;
}

function StatBadge({ label, value, color, bg, border }: StatBadgeProps) {
  return (
    <Badge
      variant="outline"
      className="gap-1.5 px-2 py-0.5 text-[11px] font-normal"
      style={{ borderColor: border, backgroundColor: bg, color }}
    >
      <span
        className="font-mono font-semibold"
        style={{ color }}
      >
        {value}
      </span>
      <span style={{ color: 'inherit', opacity: 0.85 }}>{label}</span>
    </Badge>
  );
}
