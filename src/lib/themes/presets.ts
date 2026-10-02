/**
 * @file themes/presets.ts
 * @description Built-in theme presets for the Modbus Analyzer.
 *
 * Three presets ship by default:
 *  - `day`            — light theme with Tailwind-palette role colors
 *  - `night`          — dark theme with the same hues but inverted lightness
 *  - `high_contrast`  — pure saturated colors on pure black for max legibility
 *
 * Color values mirror Tailwind CSS v3 palette names where noted
 * (e.g. `amber-600`, `emerald-50`) so that designers familiar with Tailwind
 * can intuit the visual outcome without rendering.
 */
import type { Theme } from './types';

/* ------------------------------------------------------------------ *
 * DAY (light)
 * ------------------------------------------------------------------ */
export const dayTheme: Theme = {
  id: 'day',
  name: 'theme.light',
  isDark: false,
  colors: {
    bg: '#ffffff',
    surface: '#fafafa',
    surfaceAlt: '#f4f4f5',
    text: '#18181b',
    textMuted: '#71717a',
    border: '#e4e4e7',
    accent: '#3b82f6',
    requestBg: '#eff6ff',
    responseBg: '#f0fdf4',
    exceptionBg: '#fef2f2',
    invalidBg: '#fffbeb',
    roles: {
      address:              { fg: '#d97706', bg: '#fffbeb' }, // amber-600 / amber-50
      unit_id:              { fg: '#d97706', bg: '#fffbeb' },
      function:             { fg: '#059669', bg: '#ecfdf5' }, // emerald-600 / emerald-50
      exception_flag:       { fg: '#b91c1c', bg: '#fee2e2' }, // red-700 / red-100
      exception_code:       { fg: '#b91c1c', bg: '#fee2e2' },
      start_addr_hi:        { fg: '#7c3aed', bg: '#f5f3ff' }, // violet-600 / violet-50
      start_addr_lo:        { fg: '#7c3aed', bg: '#f5f3ff' },
      quantity_hi:          { fg: '#e11d48', bg: '#fff1f2' }, // rose-600 / rose-50
      quantity_lo:          { fg: '#e11d48', bg: '#fff1f2' },
      byte_count:           { fg: '#e11d48', bg: '#fff1f2' },
      data:                 { fg: '#0d9488', bg: '#f0fdfa' }, // teal-600 / teal-50
      crc_lo:               { fg: '#dc2626', bg: '#fef2f2' }, // red-600 / red-50
      crc_hi:               { fg: '#dc2626', bg: '#fef2f2' },
      lrc:                  { fg: '#dc2626', bg: '#fef2f2' },
      mbap_transaction_hi:  { fg: '#71717a', bg: '#f4f4f5' }, // zinc-500 / zinc-100
      mbap_transaction_lo:  { fg: '#71717a', bg: '#f4f4f5' },
      mbap_protocol_hi:     { fg: '#71717a', bg: '#f4f4f5' },
      mbap_protocol_lo:     { fg: '#71717a', bg: '#f4f4f5' },
      mbap_length_hi:       { fg: '#71717a', bg: '#f4f4f5' },
      mbap_length_lo:       { fg: '#71717a', bg: '#f4f4f5' },
      sub_function:         { fg: '#0891b2', bg: '#ecfeff' }, // cyan-600 / cyan-50
      sub_data:             { fg: '#0891b2', bg: '#ecfeff' },
      mei_type:             { fg: '#0891b2', bg: '#ecfeff' },
      mei_data:             { fg: '#0891b2', bg: '#ecfeff' },
      unknown:              { fg: '#a1a1aa', bg: 'transparent' }, // zinc-400
    },
  },
};

/* ------------------------------------------------------------------ *
 * NIGHT (dark)
 * ------------------------------------------------------------------ */
export const nightTheme: Theme = {
  id: 'night',
  name: 'theme.dark',
  isDark: true,
  colors: {
    bg: '#0a0a0b',
    surface: '#18181b',
    surfaceAlt: '#1f1f23',
    text: '#fafafa',
    textMuted: '#a1a1aa',
    border: '#27272a',
    accent: '#60a5fa',
    requestBg: '#0b1220',
    responseBg: '#0b2012',
    exceptionBg: '#2b0b0b',
    invalidBg: '#2b1a0b',
    roles: {
      address:              { fg: '#fbbf24', bg: 'rgba(217,119,6,0.18)' }, // amber-400
      unit_id:              { fg: '#fbbf24', bg: 'rgba(217,119,6,0.18)' },
      function:             { fg: '#34d399', bg: 'rgba(5,150,105,0.18)' }, // emerald-400
      exception_flag:       { fg: '#fca5a5', bg: 'rgba(185,28,28,0.28)' }, // red-300
      exception_code:       { fg: '#fca5a5', bg: 'rgba(185,28,28,0.28)' },
      start_addr_hi:        { fg: '#a78bfa', bg: 'rgba(124,58,237,0.18)' }, // violet-400
      start_addr_lo:        { fg: '#a78bfa', bg: 'rgba(124,58,237,0.18)' },
      quantity_hi:          { fg: '#fb7185', bg: 'rgba(225,29,72,0.18)' }, // rose-400
      quantity_lo:          { fg: '#fb7185', bg: 'rgba(225,29,72,0.18)' },
      byte_count:           { fg: '#fb7185', bg: 'rgba(225,29,72,0.18)' },
      data:                 { fg: '#2dd4bf', bg: 'rgba(13,148,136,0.18)' }, // teal-400
      crc_lo:               { fg: '#f87171', bg: 'rgba(220,38,38,0.18)' }, // red-400
      crc_hi:               { fg: '#f87171', bg: 'rgba(220,38,38,0.18)' },
      lrc:                  { fg: '#f87171', bg: 'rgba(220,38,38,0.18)' },
      mbap_transaction_hi:  { fg: '#a1a1aa', bg: 'rgba(113,113,122,0.18)' }, // zinc-400
      mbap_transaction_lo:  { fg: '#a1a1aa', bg: 'rgba(113,113,122,0.18)' },
      mbap_protocol_hi:     { fg: '#a1a1aa', bg: 'rgba(113,113,122,0.18)' },
      mbap_protocol_lo:     { fg: '#a1a1aa', bg: 'rgba(113,113,122,0.18)' },
      mbap_length_hi:       { fg: '#a1a1aa', bg: 'rgba(113,113,122,0.18)' },
      mbap_length_lo:       { fg: '#a1a1aa', bg: 'rgba(113,113,122,0.18)' },
      sub_function:         { fg: '#22d3ee', bg: 'rgba(8,145,178,0.18)' }, // cyan-400
      sub_data:             { fg: '#22d3ee', bg: 'rgba(8,145,178,0.18)' },
      mei_type:             { fg: '#22d3ee', bg: 'rgba(8,145,178,0.18)' },
      mei_data:             { fg: '#22d3ee', bg: 'rgba(8,145,178,0.18)' },
      unknown:              { fg: '#71717a', bg: 'transparent' }, // zinc-500
    },
  },
};

/* ------------------------------------------------------------------ *
 * HIGH CONTRAST
 * ------------------------------------------------------------------ *
 * Pure saturated colors on pure black. Each role category uses a distinct
 * hue band so that the byte grid remains readable for users with low
 * vision or color-vision deficiencies (paired with shape/role labeling).
 */
export const highContrastTheme: Theme = {
  id: 'high_contrast',
  name: 'theme.high_contrast',
  isDark: true,
  colors: {
    bg: '#000000',
    surface: '#000000',
    surfaceAlt: '#0a0a0a',
    text: '#ffffff',
    textMuted: '#e5e5e5',
    border: '#ffffff',
    accent: '#ffff00',
    requestBg: '#000033',
    responseBg: '#003300',
    exceptionBg: '#330000',
    invalidBg: '#332200',
    roles: {
      address:              { fg: '#ffff00', bg: '#1a1a00', border: '#ffff00' }, // yellow
      unit_id:              { fg: '#ffff00', bg: '#1a1a00', border: '#ffff00' },
      function:             { fg: '#00ff00', bg: '#001a00', border: '#00ff00' }, // green
      exception_flag:       { fg: '#ff0000', bg: '#1a0000', border: '#ff0000' }, // red
      exception_code:       { fg: '#ff0000', bg: '#1a0000', border: '#ff0000' },
      start_addr_hi:        { fg: '#ff00ff', bg: '#1a001a', border: '#ff00ff' }, // magenta
      start_addr_lo:        { fg: '#ff00ff', bg: '#1a001a', border: '#ff00ff' },
      quantity_hi:          { fg: '#ff8800', bg: '#1a0f00', border: '#ff8800' }, // orange
      quantity_lo:          { fg: '#ff8800', bg: '#1a0f00', border: '#ff8800' },
      byte_count:           { fg: '#ff8800', bg: '#1a0f00', border: '#ff8800' },
      data:                 { fg: '#00ffff', bg: '#001a1a', border: '#00ffff' }, // cyan
      crc_lo:               { fg: '#ff4444', bg: '#1a0000', border: '#ff4444' },
      crc_hi:               { fg: '#ff4444', bg: '#1a0000', border: '#ff4444' },
      lrc:                  { fg: '#ff4444', bg: '#1a0000', border: '#ff4444' },
      mbap_transaction_hi:  { fg: '#cccccc', bg: '#1a1a1a', border: '#888888' },
      mbap_transaction_lo:  { fg: '#cccccc', bg: '#1a1a1a', border: '#888888' },
      mbap_protocol_hi:     { fg: '#cccccc', bg: '#1a1a1a', border: '#888888' },
      mbap_protocol_lo:     { fg: '#cccccc', bg: '#1a1a1a', border: '#888888' },
      mbap_length_hi:       { fg: '#cccccc', bg: '#1a1a1a', border: '#888888' },
      mbap_length_lo:       { fg: '#cccccc', bg: '#1a1a1a', border: '#888888' },
      sub_function:         { fg: '#88ff00', bg: '#0f1a00', border: '#88ff00' }, // lime
      sub_data:             { fg: '#88ff00', bg: '#0f1a00', border: '#88ff00' },
      mei_type:             { fg: '#88ff00', bg: '#0f1a00', border: '#88ff00' },
      mei_data:             { fg: '#88ff00', bg: '#0f1a00', border: '#88ff00' },
      unknown:              { fg: '#888888', bg: 'transparent', border: '#444444' },
    },
  },
};

/** Array of all built-in presets, in registry order. */
export const BUILTIN_THEMES: readonly Theme[] = [
  dayTheme,
  nightTheme,
  highContrastTheme,
];

/**
 * Look up a built-in theme by id. Returns `undefined` when not found.
 */
export function getBuiltinTheme(id: string): Theme | undefined {
  return BUILTIN_THEMES.find((t) => t.id === id);
}
