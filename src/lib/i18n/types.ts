/**
 * @file i18n/types.ts
 * @description Core types for the lightweight, dependency-free i18n system.
 *
 * The i18n system is designed to be:
 * - Browser-safe (no Node-only APIs, no DOM access required)
 * - Framework-agnostic (no React imports; React hooks wrap this in a later task)
 * - Tiny bundle footprint (no `i18next` dependency for PWA optimization)
 * - Reactive via a simple subscribe/notify pub-sub model
 *
 * Dictionaries are FLAT objects keyed by dotted strings
 * (e.g. `'app.title'`, `'fc.03'`, `'field.slave_address'`).
 */

/**
 * Supported built-in locale codes.
 *
 * The system can accept additional custom locales via `loadCustomDictionary`,
 * but the three built-in ones are guaranteed to ship with translations.
 */
export type Locale = 'en' | 'ru' | 'zh';

/**
 * Flat dictionary map: dotted-key → translated string.
 */
export type Dictionary = Record<string, string>;

/**
 * Map of locale code → dictionary. Built-ins are keyed by `Locale`;
 * user-uploaded custom dictionaries are keyed by an arbitrary string code
 * (e.g. `'de'`, `'fr'`, `'custom-1'`).
 */
export type DictionaryRegistry = Record<string, Dictionary>;

/**
 * Human-readable locale descriptor returned by `listLocales`.
 */
export interface LocaleDescriptor {
  /** Locale code, e.g. `'en'`, `'ru'`, `'zh'`, or a custom code. */
  code: Locale | string;
  /** Display name in the locale's own language (e.g. `'English'`, `'Русский'`, `'中文'`). */
  name: string;
  /** `true` when this locale was added via `loadCustomDictionary` rather than built-in. */
  isCustom: boolean;
}

/**
 * Interpolation parameter map passed to `t()`.
 *
 * Values may be `string` or `number`; both are coerced to string at format time.
 * Example: `t('field.quantity', { count: 5 })` with template
 * `'Quantity: {count}'` → `'Quantity: 5'`.
 */
export type InterpolationParams = Record<string, string | number>;

/**
 * Callback fired when the active locale or any dictionary changes.
 * Receives no arguments; subscribers should re-read translations via `t()`.
 */
export type LocaleChangeCallback = () => void;

/**
 * Public i18n API surface. The module exports a singleton instance that
 * implements this interface; tests or alternate consumers may construct
 * their own instance via the factory pattern (see `createI18n` in index.ts).
 */
export interface I18n {
  /** Translate a key with optional `{param}` interpolation. */
  t: (key: string, params?: InterpolationParams) => string;
  /** Set the active locale. Falls back to `'en'` if the locale is unknown. */
  setLocale: (locale: Locale | string) => void;
  /** Get the currently active locale code. */
  getLocale: () => string;
  /** Subscribe to locale/dictionary changes. Returns an unsubscribe function. */
  subscribe: (cb: LocaleChangeCallback) => () => void;
  /** Merge a user-provided dictionary under a custom (or built-in) locale code. */
  loadCustomDictionary: (code: string, name: string, json: Dictionary) => void;
  /** List all available locales, built-in and custom. */
  listLocales: () => LocaleDescriptor[];
  /** Return `true` if the key exists in the active locale or the EN fallback. */
  has: (key: string) => boolean;
  /** Direct read-only access to a dictionary for a given locale (for debugging). */
  getDictionary: (code: string) => Dictionary | undefined;
}
