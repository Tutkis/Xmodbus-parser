/**
 * @file themes/presets.ts
 * @description Built-in theme presets for the Modbus Analyzer.
 *
 * Three presets ship by default, each tuned for long SCADA-engineering
 * sessions. Palettes are borrowed from three of the most comfortable
 * community editor themes — no pure white, no pure black, no harsh
 * saturated blues:
 *
 *  - `day`            — *Catppuccin Latte*: warm soft "paper" light theme.
 *  - `night`          — *Catppuccin Mocha*: cozy warm dark theme, "tea at midnight".
 *  - `high_contrast`  — *Gruvbox Dark*: warm high-contrast for low-vision users
 *                       who still want colour comfort (not pure B&W).
 *
 * The hex values are taken directly (or blended) from the upstream palette
 * definitions so that designers familiar with those themes can intuit the
 * visual outcome without rendering.
 *
 * Upstream palette references:
 *  - Catppuccin Latte / Mocha — https://catppuccin.com/palette
 *  - Gruvbox Dark             — https://github.com/morhetz/gruvbox
 */
import type { Theme } from './types';

/* ------------------------------------------------------------------ *
 * DAY (light) — Catppuccin Latte
 * ------------------------------------------------------------------ *
 * Warm off-white surfaces with a slight cool-warm balance; text is soft
 * dark (#4c4f69) rather than pure black. Accent is Latte `mauve`
 * (#8839ef) — a warm purple — instead of a clinical blue. All byte-role
 * colours are drawn from the Latte palette so the hex grid stays
 * harmonious.
 */
export const dayTheme: Theme = {
  id: 'day',
  name: 'theme.light',
  isDark: false,
  colors: {
    bg:          '#eff1f5', // Latte base   — warm off-white
    surface:     '#e6e9ef', // Latte mantle — card surface
    surfaceAlt:  '#dce0e8', // Latte crust  — alt-row tint
    text:        '#4c4f69', // Latte text   — soft dark, NOT pure black
    textMuted:   '#6c6f85', // Latte subtext1
    border:      '#bcc0cc', // Latte surface1
    accent:      '#8839ef', // Latte mauve — warm purple accent
    requestBg:   '#e6e3e8', // subtle warm tint
    responseBg:  '#e3e8e3', // subtle warm green tint
    exceptionBg: '#f0dfe0', // soft warm red tint
    invalidBg:   '#f0e6df', // soft warm amber tint
    roles: {
      address:              { fg: '#fe640b', bg: '#fce5cf' }, // Latte peach
      unit_id:              { fg: '#fe640b', bg: '#fce5cf' },
      function:             { fg: '#40a02b', bg: '#dff3d6' }, // Latte green
      exception_flag:       { fg: '#d20f39', bg: '#f1d4da' }, // Latte red
      exception_code:       { fg: '#d20f39', bg: '#f1d4da' },
      start_addr_hi:        { fg: '#8839ef', bg: '#e4d5f7' }, // Latte mauve
      start_addr_lo:        { fg: '#8839ef', bg: '#e4d5f7' },
      quantity_hi:          { fg: '#ea76cb', bg: '#f6d9ec' }, // Latte pink
      quantity_lo:          { fg: '#ea76cb', bg: '#f6d9ec' },
      byte_count:           { fg: '#ea76cb', bg: '#f6d9ec' },
      data:                 { fg: '#df8e1d', bg: '#f5e5c8' }, // Latte yellow (warm amber)
      crc_lo:               { fg: '#d20f39', bg: '#f1d4da' }, // Latte red
      crc_hi:               { fg: '#d20f39', bg: '#f1d4da' },
      lrc:                  { fg: '#d20f39', bg: '#f1d4da' },
      mbap_transaction_hi:  { fg: '#8c8fa1', bg: '#d8dce4' }, // Latte overlay0
      mbap_transaction_lo:  { fg: '#8c8fa1', bg: '#d8dce4' },
      mbap_protocol_hi:     { fg: '#8c8fa1', bg: '#d8dce4' },
      mbap_protocol_lo:     { fg: '#8c8fa1', bg: '#d8dce4' },
      mbap_length_hi:       { fg: '#8c8fa1', bg: '#d8dce4' },
      mbap_length_lo:       { fg: '#8c8fa1', bg: '#d8dce4' },
      sub_function:         { fg: '#7287fd', bg: '#e0e1f7' }, // Latte lavender
      sub_data:             { fg: '#7287fd', bg: '#e0e1f7' },
      mei_type:             { fg: '#7287fd', bg: '#e0e1f7' },
      mei_data:             { fg: '#7287fd', bg: '#e0e1f7' },
      unknown:              { fg: '#9ca0b0', bg: 'transparent' },
    },
  },
};

/* ------------------------------------------------------------------ *
 * NIGHT (dark) — Catppuccin Mocha
 * ------------------------------------------------------------------ *
 * Warm dark purple-gray base (#1e1e2e) — NOT pure black. Text is a soft
 * warm white (#cdd6f4). Accent is Mocha `mauve` (#cba6f7). Byte-role
 * colours are drawn from the Mocha palette: peach, green, red, mauve,
 * pink, yellow — all comfortably distinguishable on the dark surface.
 */
export const nightTheme: Theme = {
  id: 'night',
  name: 'theme.dark',
  isDark: true,
  colors: {
    bg:          '#1e1e2e', // Mocha base    — warm dark purple-gray
    surface:     '#181825', // Mocha mantle  — card surface
    surfaceAlt:  '#313244', // Mocha surface0 — alt-row tint
    text:        '#cdd6f4', // Mocha text    — soft warm white
    textMuted:   '#a6adc8', // Mocha subtext0
    border:      '#45475a', // Mocha surface1
    accent:      '#cba6f7', // Mocha mauve — warm purple accent
    requestBg:   '#28283c', // subtle warm tint
    responseBg:  '#243024', // subtle warm green tint
    exceptionBg: '#3a232a', // subtle warm red tint
    invalidBg:   '#36291c', // subtle warm amber tint
    roles: {
      address:              { fg: '#fab387', bg: '#3a2c24' }, // Mocha peach
      unit_id:              { fg: '#fab387', bg: '#3a2c24' },
      function:             { fg: '#a6e3a1', bg: '#243024' }, // Mocha green
      exception_flag:       { fg: '#f38ba8', bg: '#3a232a' }, // Mocha red
      exception_code:       { fg: '#f38ba8', bg: '#3a232a' },
      start_addr_hi:        { fg: '#cba6f7', bg: '#2e2538' }, // Mocha mauve
      start_addr_lo:        { fg: '#cba6f7', bg: '#2e2538' },
      quantity_hi:          { fg: '#f5c2e7', bg: '#382535' }, // Mocha pink
      quantity_lo:          { fg: '#f5c2e7', bg: '#382535' },
      byte_count:           { fg: '#f5c2e7', bg: '#382535' },
      data:                 { fg: '#f9e2af', bg: '#38301c' }, // Mocha yellow (warm)
      crc_lo:               { fg: '#f38ba8', bg: '#3a232a' }, // Mocha red
      crc_hi:               { fg: '#f38ba8', bg: '#3a232a' },
      lrc:                  { fg: '#f38ba8', bg: '#3a232a' },
      mbap_transaction_hi:  { fg: '#9399b2', bg: '#2a2a3a' }, // Mocha overlay0
      mbap_transaction_lo:  { fg: '#9399b2', bg: '#2a2a3a' },
      mbap_protocol_hi:     { fg: '#9399b2', bg: '#2a2a3a' },
      mbap_protocol_lo:     { fg: '#9399b2', bg: '#2a2a3a' },
      mbap_length_hi:       { fg: '#9399b2', bg: '#2a2a3a' },
      mbap_length_lo:       { fg: '#9399b2', bg: '#2a2a3a' },
      sub_function:         { fg: '#b4befe', bg: '#28283c' }, // Mocha lavender
      sub_data:             { fg: '#b4befe', bg: '#28283c' },
      mei_type:             { fg: '#b4befe', bg: '#28283c' },
      mei_data:             { fg: '#b4befe', bg: '#28283c' },
      unknown:              { fg: '#6c7086', bg: 'transparent' },
    },
  },
};

/* ------------------------------------------------------------------ *
 * HIGH CONTRAST — Gruvbox Dark
 * ------------------------------------------------------------------ *
 * For users who need strong contrast but still want warmth (not pure
 * B&W). Gruvbox is the community gold standard for warm high-contrast:
 * base bg #282828 (warm dark gray), fg #ebdbb2 (warm cream). All
 * accent colours are fully saturated warm Gruvbox hues — orange, green,
 * bright red, purple, yellow, aqua, blue — chosen to remain
 * distinguishable for users with common color-vision deficiencies when
 * paired with the role labels.
 */
export const highContrastTheme: Theme = {
  id: 'high_contrast',
  name: 'theme.high_contrast',
  isDark: true,
  colors: {
    bg:          '#282828', // Gruvbox bg   — warm dark gray
    surface:     '#3c3836', // Gruvbox bg1  — card surface
    surfaceAlt:  '#504945', // Gruvbox bg2  — alt-row tint
    text:        '#ebdbb2', // Gruvbox fg   — warm cream
    textMuted:   '#a89984', // Gruvbox gray1
    border:      '#7c6f64', // Gruvbox bg4
    accent:      '#fabd2f', // Gruvbox yellow — warm gold accent
    requestBg:   '#3a3530',
    responseBg:  '#333a30',
    exceptionBg: '#452d2d',
    invalidBg:   '#403a2d',
    roles: {
      address:              { fg: '#fe8019', bg: '#4a3326' }, // Gruvbox orange
      unit_id:              { fg: '#fe8019', bg: '#4a3326' },
      function:             { fg: '#b8bb26', bg: '#3a4030' }, // Gruvbox green
      exception_flag:       { fg: '#fb4934', bg: '#452d2d' }, // Gruvbox bright red
      exception_code:       { fg: '#fb4934', bg: '#452d2d' },
      start_addr_hi:        { fg: '#d3869b', bg: '#403040' }, // Gruvbox purple
      start_addr_lo:        { fg: '#d3869b', bg: '#403040' },
      quantity_hi:          { fg: '#fabd2f', bg: '#403a2d' }, // Gruvbox yellow
      quantity_lo:          { fg: '#fabd2f', bg: '#403a2d' },
      byte_count:           { fg: '#fabd2f', bg: '#403a2d' },
      data:                 { fg: '#8ec07c', bg: '#2d3a35' }, // Gruvbox aqua (warm green)
      crc_lo:               { fg: '#fb4934', bg: '#452d2d' }, // Gruvbox red
      crc_hi:               { fg: '#fb4934', bg: '#452d2d' },
      lrc:                  { fg: '#fb4934', bg: '#452d2d' },
      mbap_transaction_hi:  { fg: '#928374', bg: '#3c3836' }, // Gruvbox gray
      mbap_transaction_lo:  { fg: '#928374', bg: '#3c3836' },
      mbap_protocol_hi:     { fg: '#928374', bg: '#3c3836' },
      mbap_protocol_lo:     { fg: '#928374', bg: '#3c3836' },
      mbap_length_hi:       { fg: '#928374', bg: '#3c3836' },
      mbap_length_lo:       { fg: '#928374', bg: '#3c3836' },
      sub_function:         { fg: '#83a598', bg: '#2d3540' }, // Gruvbox blue (warm-toned)
      sub_data:             { fg: '#83a598', bg: '#2d3540' },
      mei_type:             { fg: '#83a598', bg: '#2d3540' },
      mei_data:             { fg: '#83a598', bg: '#2d3540' },
      unknown:              { fg: '#7c6f64', bg: 'transparent' },
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
