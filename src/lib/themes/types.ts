/**
 * @file themes/types.ts
 * @description Core types for the Modbus Analyzer theme system.
 *
 * A "theme" is a flat collection of:
 * 1. UI surface colors (page bg, card bg, borders, text, accent, etc.).
 * 2. Frame-row backgrounds (request / response / exception / invalid).
 * 3. A per-ByteRole color map: each byte in a parsed Modbus frame is
 *    classified into a *role* (e.g. `'crc_lo'`, `'function'`, `'data'`)
 *    and rendered with the matching role color.
 *
 * The theme system is intentionally CSS-color-only (hex, rgb(), hsl()…).
 * It is decoupled from React and from any styling engine; the caller is
 * responsible for either injecting CSS custom properties via
 * `themeToCssVars(theme)` or for directly reading `theme.colors` from
 * inline styles.
 */

/**
 * All ByteRole values recognized by the parser & colorizer.
 *
 * Roles are stable string literals — they must not change between versions
 * without a migration, since custom themes & persisted user preferences
 * reference them by name.
 *
 * Categories:
 *  - Routing/identity: address, unit_id, function
 *  - Exception: exception_flag, exception_code
 *  - Addressing fields: start_addr_hi/lo, quantity_hi/lo, byte_count
 *  - Payload: data
 *  - Checksums: crc_lo/hi, lrc
 *  - MBAP header (TCP): mbap_transaction_hi/lo, mbap_protocol_hi/lo, mbap_length_hi/lo
 *  - Encapsulated (MEI): sub_function, sub_data, mei_type, mei_data
 *  - Fallback: unknown
 */
export const BYTE_ROLES = [
  'address',
  'unit_id',
  'function',
  'exception_flag',
  'exception_code',
  'start_addr_hi',
  'start_addr_lo',
  'quantity_hi',
  'quantity_lo',
  'byte_count',
  'data',
  'crc_lo',
  'crc_hi',
  'lrc',
  'mbap_transaction_hi',
  'mbap_transaction_lo',
  'mbap_protocol_hi',
  'mbap_protocol_lo',
  'mbap_length_hi',
  'mbap_length_lo',
  'sub_function',
  'sub_data',
  'mei_type',
  'mei_data',
  'unknown',
] as const;

/** A single ByteRole value. String-typed so custom roles can be added. */
export type ByteRole = (typeof BYTE_ROLES)[number] | (string & {});

/**
 * Color definition for one byte cell.
 * - `fg`: text color of the hex/ascii glyph
 * - `bg`: cell background tint
 * - `border` (optional): 1px cell border, useful in high-contrast themes
 */
export interface RoleColor {
  fg: string;
  bg: string;
  border?: string;
}

/**
 * Surface & semantic colors used by app chrome (page, cards, rows, text).
 */
export interface ThemeColors {
  /** Page-level background. */
  bg: string;
  /** Card / panel background. */
  surface: string;
  /** Alternating row / sub-panel background. */
  surfaceAlt: string;
  /** Primary text color. */
  text: string;
  /** Muted / secondary text color. */
  textMuted: string;
  /** Border / divider color. */
  border: string;
  /** Accent / focus ring color. */
  accent: string;

  /** Background applied to a request frame row. */
  requestBg: string;
  /** Background applied to a response frame row. */
  responseBg: string;
  /** Background applied to an exception-response frame row. */
  exceptionBg: string;
  /** Background applied to an invalid (bad CRC/LRC/truncated) frame row. */
  invalidBg: string;

  /** Per-byte role color map. */
  roles: Record<string, RoleColor>;
}

/**
 * A complete theme definition. Built-in presets live in `presets.ts`;
 * users may construct their own via `loadCustomTheme`.
 */
export interface Theme {
  /** Stable identifier, e.g. `'day'`, `'night'`, `'high_contrast'`. */
  id: string;
  /** Human-readable name (i18n-friendly; usually an i18n key like `'theme.light'`). */
  name: string;
  /** `true` for dark themes — affects default rendering (scrollbars, etc.). */
  isDark: boolean;
  /** Surface + role colors. */
  colors: ThemeColors;
}

/**
 * Result of validating a candidate theme object. `errors` is empty when
 * `ok === true`.
 */
export interface ThemeValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Subscriber callback invoked when the active theme changes.
 */
export type ThemeChangeCallback = () => void;

/**
 * Public theme registry entry returned by `listThemes()`.
 */
export interface ThemeDescriptor {
  id: string;
  name: string;
  isDark: boolean;
  isCustom: boolean;
}

/**
 * A custom theme JSON document as a user might upload it. Mirrors the
 * `Theme` shape but `id` may be omitted (the registry assigns one).
 *
 * Documented inline (JSDoc) as a JSON schema guide for end users.
 */
export interface ThemeJSON {
  /** Optional — if omitted, an id will be generated. */
  id?: string;
  /** Display name. */
  name: string;
  /** `true` for dark themes. */
  isDark?: boolean;
  /** Surface + role colors. */
  colors: ThemeColors;
}

/*
 * === USER-FACING JSON SCHEMA (for `loadCustomTheme` uploads) ============
 *
 * Custom themes are JSON files matching the following shape:
 *
 * {
 *   "id": "my_theme",                       // optional; auto-generated if missing
 *   "name": "My Custom Theme",              // required, any string
 *   "isDark": true,                         // optional, default false
 *   "colors": {                             // required
 *     "bg": "#0a0a0b",
 *     "surface": "#18181b",
 *     "surfaceAlt": "#1f1f23",
 *     "text": "#fafafa",
 *     "textMuted": "#a1a1aa",
 *     "border": "#27272a",
 *     "accent": "#3b82f6",
 *     "requestBg": "#0b1220",
 *     "responseBg": "#0b2012",
 *     "exceptionBg": "#2b0b0b",
 *     "invalidBg": "#2b1a0b",
 *     "roles": {
 *       "address":       { "fg": "#d97706", "bg": "#fffbeb" },
 *       "unit_id":       { "fg": "#d97706", "bg": "#fffbeb" },
 *       "function":      { "fg": "#059669", "bg": "#ecfdf5" },
 *       "exception_flag":{ "fg": "#b91c1c", "bg": "#fee2e2" },
 *       "exception_code":{ "fg": "#b91c1c", "bg": "#fee2e2" },
 *       "start_addr_hi": { "fg": "#7c3aed", "bg": "#f5f3ff" },
 *       "start_addr_lo": { "fg": "#7c3aed", "bg": "#f5f3ff" },
 *       "quantity_hi":   { "fg": "#e11d48", "bg": "#fff1f2" },
 *       "quantity_lo":   { "fg": "#e11d48", "bg": "#fff1f2" },
 *       "byte_count":    { "fg": "#e11d48", "bg": "#fff1f2" },
 *       "data":          { "fg": "#0d9488", "bg": "#f0fdfa" },
 *       "crc_lo":        { "fg": "#dc2626", "bg": "#fef2f2" },
 *       "crc_hi":        { "fg": "#dc2626", "bg": "#fef2f2" },
 *       "lrc":           { "fg": "#dc2626", "bg": "#fef2f2" },
 *       "mbap_transaction_hi": { "fg": "#71717a", "bg": "#f4f4f5" },
 *       "mbap_transaction_lo": { "fg": "#71717a", "bg": "#f4f4f5" },
 *       "mbap_protocol_hi":    { "fg": "#71717a", "bg": "#f4f4f5" },
 *       "mbap_protocol_lo":    { "fg": "#71717a", "bg": "#f4f4f5" },
 *       "mbap_length_hi":      { "fg": "#71717a", "bg": "#f4f4f5" },
 *       "mbap_length_lo":      { "fg": "#71717a", "bg": "#f4f4f5" },
 *       "sub_function":  { "fg": "#0891b2", "bg": "#ecfeff" },
 *       "sub_data":      { "fg": "#0891b2", "bg": "#ecfeff" },
 *       "mei_type":      { "fg": "#0891b2", "bg": "#ecfeff" },
 *       "mei_data":      { "fg": "#0891b2", "bg": "#ecfeff" },
 *       "unknown":       { "fg": "#a1a1aa", "bg": "transparent" }
 *     }
 *   }
 * }
 *
 * Notes:
 * - `bg`, `surface`, `text`, `border`, `accent` and the four row backgrounds
 *   are REQUIRED string colors.
 * - Any color string accepted by CSS (hex, rgb(), hsl(), named, 'transparent')
 *   is permitted; the validator only checks for non-empty strings.
 * - Missing role entries fall back to the `unknown` role color.
 * - `roles.unknown` is required (acts as the default for any unmapped role).
 */
