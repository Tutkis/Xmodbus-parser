'use client';

/**
 * @file timeline/sequence-diagram.tsx
 * @description Pure-SVG Modbus master↔slave sequence diagram.
 *
 * Layout
 * ------
 * Two vertical lanes (Master on the left, Slave on the right) with dashed
 * lifelines extending downward. Each parsed frame is rendered as one
 * horizontal arrow between the lanes, stacked top-to-bottom in stream
 * order. Paired request↔response frames share a subtle background
 * highlight (rounded rect spanning both rows).
 *
 * Geometry
 * --------
 * Three quantities are derived from a single `zoom` state in [0.5, 2.0]:
 *   - rowHeight   40 → 120 px (linear)
 *   - fontSize    10 → 16 px (linear)
 *   - laneDistance 200 → 600 px (piecewise-linear; at zoom = 1.0 it tracks
 *                               the available container width so "Fit"
 *                               fills the viewport)
 *
 * The SVG is rendered with an explicit pixel width; the parent wraps it
 * in an `overflow-x-auto` container, so when zoomed-in beyond the
 * container width the diagram scrolls horizontally. When narrower than
 * the container (zoom < 1.0 on a wide screen) it is centred via
 * `margin: 0 auto`.
 *
 * Why pure SVG?
 *   1. Full control over visual fidelity (markers, dashed lifelines,
 *      per-arrow colours) without a charting-lib dependency.
 *   2. SVG `<title>` elements give us native, dependency-free tooltips
 *      that also survive a future PDF export (the export task can simply
 *      serialise the SVG node).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ParsedFrame, RegisterMapEntry } from '@/lib/modbus';
import type { Theme } from '@/lib/themes/types';
import { useI18n } from '@/hooks/use-i18n';
import { FrameArrow, type ArrowColors } from './arrow';

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

/** Horizontal padding on each side of the lanes (room for labels). */
const SIDE_MARGIN = 96;
/** Height of the lane-header band at the top of the SVG. */
const HEADER_HEIGHT = 60;
/** Bottom padding inside the SVG. */
const BOTTOM_PADDING = 20;
/** Initial container width before the ResizeObserver fires (SSR-safe). */
const DEFAULT_CONTAINER_WIDTH = 960;

/* Zoom clamps. */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.0;

/* Geometry clamps per the spec. */
const ROW_HEIGHT_MIN = 40;
const ROW_HEIGHT_MAX = 120;
const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 16;
const LANE_DISTANCE_MIN = 200;
const LANE_DISTANCE_MAX = 600;

/* ------------------------------------------------------------------ */
/* Props                                                              */
/* ------------------------------------------------------------------ */

export interface SequenceDiagramProps {
  frames: ParsedFrame[];
  registerMap: RegisterMapEntry[];
  theme: Theme;
  /** Current zoom factor in [0.5, 2.0]; 1.0 = fit container. */
  zoom: number;
  /** Fired when the user clicks an arrow. */
  onSelect: (index: number) => void;
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                   */
/* ------------------------------------------------------------------ */

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Row height in SVG pixels as a function of zoom.
 *   zoom = 0.5 → 40px (compact)
 *   zoom = 1.0 → 80px (default, matches the spec's per-frame minimum)
 *   zoom = 2.0 → 120px (expanded)
 */
function rowHeightFor(zoom: number): number {
  return clamp(40 + ((zoom - 0.5) / 1.5) * 80, ROW_HEIGHT_MIN, ROW_HEIGHT_MAX);
}

/** Font size in SVG pixels as a function of zoom (10 → 16). */
function fontSizeFor(zoom: number): number {
  return clamp(10 + ((zoom - 0.5) / 1.5) * 6, FONT_SIZE_MIN, FONT_SIZE_MAX);
}

/**
 * Lane distance as a function of zoom AND the available container width.
 *
 * At zoom = 1.0 ("Fit"), the lane distance equals the container width
 * minus side-margins (clamped to 200–600). For zoom < 1.0 it shrinks
 * linearly toward 200; for zoom > 1.0 it grows linearly toward 600.
 */
function laneDistanceFor(zoom: number, containerWidth: number): number {
  const baseLane = clamp(
    containerWidth - SIDE_MARGIN * 2,
    LANE_DISTANCE_MIN,
    LANE_DISTANCE_MAX,
  );
  let dist: number;
  if (zoom <= 1.0) {
    // 0.5 → 200, 1.0 → baseLane
    const t = (zoom - 0.5) / 0.5; // 0..1
    dist = LANE_DISTANCE_MIN + t * (baseLane - LANE_DISTANCE_MIN);
  } else {
    // 1.0 → baseLane, 2.0 → LANE_DISTANCE_MAX
    const t = (zoom - 1.0) / 1.0; // 0..1
    dist = baseLane + t * (LANE_DISTANCE_MAX - baseLane);
  }
  return clamp(dist, LANE_DISTANCE_MIN, LANE_DISTANCE_MAX);
}

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */

export function SequenceDiagram({
  frames,
  registerMap,
  theme,
  zoom,
  onSelect,
}: SequenceDiagramProps): React.JSX.Element {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(
    DEFAULT_CONTAINER_WIDTH,
  );

  /* Track the available horizontal space so "Fit" zoom can fill it. */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* Derive geometry from zoom + container width. */
  const rowHeight = rowHeightFor(zoom);
  const fontSize = fontSizeFor(zoom);
  const laneDistance = laneDistanceFor(zoom, containerWidth);

  const masterX = SIDE_MARGIN;
  const slaveX = SIDE_MARGIN + laneDistance;
  const svgWidth = slaveX + SIDE_MARGIN;
  const frameCount = Math.max(1, frames.length);
  const svgHeight = HEADER_HEIGHT + frameCount * rowHeight + BOTTOM_PADDING;

  /* Theme-derived colour bundle for arrows. */
  const colors: ArrowColors = useMemo(
    () => ({
      request: theme.colors.roles.function?.fg ?? theme.colors.accent,
      response: theme.colors.roles.data?.fg ?? theme.colors.accent,
      exception: theme.colors.roles.exception_flag?.fg ?? '#dc2626',
      unknown: theme.colors.textMuted,
      text: theme.colors.text,
      textMuted: theme.colors.textMuted,
      border: theme.colors.border,
    }),
    [theme],
  );

  /* Build paired-group rectangles (one per request→response pair). */
  const pairs = useMemo(() => {
    const out: Array<{ a: number; b: number }> = [];
    frames.forEach((f, i) => {
      if (f.pairedWith !== undefined && f.pairedWith > i) {
        out.push({ a: i, b: f.pairedWith });
      }
    });
    return out;
  }, [frames]);

  const surface = theme.colors.surface;
  const surfaceAlt = theme.colors.surfaceAlt;
  const border = theme.colors.border;
  const text = theme.colors.text;
  const textMuted = theme.colors.textMuted;

  return (
    <div
      ref={containerRef}
      className="w-full overflow-x-auto"
      role="region"
      aria-label={t('timeline.title')}
    >
      <svg
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        role="img"
        aria-label="Modbus master↔slave sequence diagram"
        style={{
          display: 'block',
          margin: '0 auto',
          background: surface,
        }}
      >
        <defs>
          {/* Arrowhead markers — one per colour so stroke & marker match. */}
          <marker
            id="tl-arrow-request"
            viewBox="0 0 10 10"
            refX={9}
            refY={5}
            markerWidth={6}
            markerHeight={6}
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill={colors.request} />
          </marker>
          <marker
            id="tl-arrow-response"
            viewBox="0 0 10 10"
            refX={9}
            refY={5}
            markerWidth={6}
            markerHeight={6}
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill={colors.response} />
          </marker>
          <marker
            id="tl-arrow-exception"
            viewBox="0 0 10 10"
            refX={9}
            refY={5}
            markerWidth={6}
            markerHeight={6}
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill={colors.exception} />
          </marker>
          <marker
            id="tl-arrow-unknown"
            viewBox="0 0 10 10"
            refX={9}
            refY={5}
            markerWidth={6}
            markerHeight={6}
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill={colors.unknown} />
          </marker>
        </defs>

        {/* Paired request↔response highlight bands (rendered first so
            arrows draw on top). */}
        {pairs.map((p, idx) => {
          const yTop = HEADER_HEIGHT + p.a * rowHeight;
          const yBot = HEADER_HEIGHT + (p.b + 1) * rowHeight;
          const w = Math.max(0, slaveX - masterX) + 16;
          return (
            <rect
              key={`pair-${idx}`}
              x={masterX - 8}
              y={yTop}
              width={w}
              height={yBot - yTop}
              rx={8}
              fill={surfaceAlt}
              opacity={0.5}
            />
          );
        })}

        {/* Lane headers ------------------------------------------------- */}
        <g>
          {/* Master header pill */}
          <rect
            x={masterX - 52}
            y={10}
            width={104}
            height={HEADER_HEIGHT - 20}
            rx={8}
            fill={surfaceAlt}
            stroke={border}
          />
          <g transform={`translate(${masterX - 26}, ${30})`}>
            {/* Inline "CPU" glyph (rect + pins) */}
            <rect
              x={-7}
              y={-7}
              width={14}
              height={14}
              rx={2}
              fill="none"
              stroke={text}
              strokeWidth={1.5}
            />
            <rect x={-3} y={-3} width={6} height={6} fill={text} />
            <line x1={-7} y1={-3} x2={-10} y2={-3} stroke={text} strokeWidth={1.5} />
            <line x1={-7} y1={3} x2={-10} y2={3} stroke={text} strokeWidth={1.5} />
            <line x1={7} y1={-3} x2={10} y2={-3} stroke={text} strokeWidth={1.5} />
            <line x1={7} y1={3} x2={10} y2={3} stroke={text} strokeWidth={1.5} />
          </g>
          <text
            x={masterX + 6}
            y={35}
            textAnchor="middle"
            fontSize={fontSize + 2}
            fontWeight="bold"
            fill={text}
            fontFamily="var(--font-sans)"
          >
            {t('timeline.master')}
          </text>

          {/* Slave header pill */}
          <rect
            x={slaveX - 52}
            y={10}
            width={104}
            height={HEADER_HEIGHT - 20}
            rx={8}
            fill={surfaceAlt}
            stroke={border}
          />
          <g transform={`translate(${slaveX - 26}, ${30})`}>
            {/* Inline "server" glyph (rect + rack lines + LED dot) */}
            <rect
              x={-7}
              y={-7}
              width={14}
              height={14}
              rx={2}
              fill="none"
              stroke={text}
              strokeWidth={1.5}
            />
            <line x1={-4} y1={-3} x2={4} y2={-3} stroke={text} strokeWidth={1.5} />
            <line x1={-4} y1={0} x2={4} y2={0} stroke={text} strokeWidth={1.5} />
            <line x1={-4} y1={3} x2={4} y2={3} stroke={text} strokeWidth={1.5} />
            <circle cx={5} cy={-4} r={1} fill={colors.response} />
          </g>
          <text
            x={slaveX + 6}
            y={35}
            textAnchor="middle"
            fontSize={fontSize + 2}
            fontWeight="bold"
            fill={text}
            fontFamily="var(--font-sans)"
          >
            {t('timeline.slave')}
          </text>
        </g>

        {/* Lifelines (dashed) ------------------------------------------ */}
        <line
          x1={masterX}
          y1={HEADER_HEIGHT}
          x2={masterX}
          y2={svgHeight - BOTTOM_PADDING / 2}
          stroke={border}
          strokeWidth={1}
          strokeDasharray="3 4"
        />
        <line
          x1={slaveX}
          y1={HEADER_HEIGHT}
          x2={slaveX}
          y2={svgHeight - BOTTOM_PADDING / 2}
          stroke={border}
          strokeWidth={1}
          strokeDasharray="3 4"
        />

        {/* Arrows ------------------------------------------------------- */}
        {frames.map((f, i) => (
          <FrameArrow
            key={i}
            frame={f}
            index={i}
            y={HEADER_HEIGHT + i * rowHeight + rowHeight / 2}
            masterX={masterX}
            slaveX={slaveX}
            rowHeight={rowHeight}
            fontSize={fontSize}
            colors={colors}
            registerMap={registerMap}
            onSelect={onSelect}
          />
        ))}

        {/* Trailing muted hint when no frames at all (defensive). */}
        {frames.length === 0 && (
          <text
            x={svgWidth / 2}
            y={svgHeight / 2}
            textAnchor="middle"
            fontSize={fontSize}
            fill={textMuted}
            fontFamily="var(--font-sans)"
          >
            —
          </text>
        )}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Exported geometry helpers (used by the parent tab for the "Fit"
 * button & zoom-slider range).                                       */
/* ------------------------------------------------------------------ */

export const TIMELINE_ZOOM_MIN = ZOOM_MIN;
export const TIMELINE_ZOOM_MAX = ZOOM_MAX;
