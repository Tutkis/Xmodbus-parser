/**
 * @file i18n/index.ts
 * @description Lightweight, dependency-free i18n runtime for the Modbus
 * Analyzer PWA.
 *
 * Design goals
 * -------------
 * - Zero third-party i18n dependency (keeps the PWA bundle tiny).
 * - Browser-safe: no `fs`, no DOM access — only in-memory state.
 * - Framework-agnostic: no React imports. React `useSyncExternalStore`
 *   wrappers will be added in a later task.
 * - Reactive: subscribers are notified on locale or dictionary changes.
 * - Graceful fallback: missing keys in the active locale fall back to EN;
 *   if EN also lacks the key, the raw key string is returned (and any
 *   interpolation params are still substituted, which is useful for
 *   user-supplied custom dictionaries).
 *
 * Usage
 * -----
 * ```ts
 * import { i18n, setLocale, t, loadCustomDictionary } from '@/lib/i18n';
 *
 * t('app.title');                       // 'Modbus Analyzer'
 * setLocale('ru');
 * t('field.slave_address');             // 'Адрес ведомого'
 * t('filter.op.gt');                    // 'больше'
 * t('nonexistent.key', { x: 1 });       // 'nonexistent.key' (key returned)
 * loadCustomDictionary('de', 'Deutsch', { 'app.title': 'Modbus-Analysator' });
 * setLocale('de');
 * t('app.title');                       // 'Modbus-Analysator'
 * t('field.slave_address');             // falls back to EN: 'Slave Address'
 * ```
 */
import type {
  Dictionary,
  DictionaryRegistry,
  I18n,
  InterpolationParams,
  Locale,
  LocaleChangeCallback,
  LocaleDescriptor,
} from './types';
import { en } from './dictionaries/en';
import { ru } from './dictionaries/ru';
import { zh } from './dictionaries/zh';

/**
 * Built-in locale display names (in their own language).
 * Used by `listLocales()` and to seed the registry metadata.
 */
const BUILTIN_LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  ru: 'Русский',
  zh: '中文',
};

/**
 * Default locale. The English dictionary is also the universal fallback
 * for missing keys in any other locale.
 */
const DEFAULT_LOCALE: Locale = 'en';

/**
 * Interpolate `{param}` placeholders in a template string with values
 * from `params`. Missing params are replaced with the empty string so
 * the result is always a plain string (never contains literal `{x}`).
 *
 * Numeric values are coerced via `String()`; this preserves integers
 * and floats naturally (e.g. `5` → `'5'`, `1.5` → `'1.5'`).
 *
 * @param template - translation string containing `{name}` placeholders
 * @param params   - map of placeholder name → string|number value
 * @returns the formatted string
 */
function interpolate(
  template: string,
  params?: InterpolationParams,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

/**
 * Factory that creates a fresh, isolated i18n instance. The module also
 * exports a default singleton `i18n` for app-wide use; tests may use this
 * factory to avoid cross-test state contamination.
 */
export function createI18n(): I18n {
  /** Locale code → dictionary. */
  const dictionaries: DictionaryRegistry = {
    en: { ...en },
    ru: { ...ru },
    zh: { ...zh },
  };

  /** Tracks which locales were user-loaded (vs built-in). */
  const customFlags: Record<string, boolean> = {
    en: false,
    ru: false,
    zh: false,
  };

  /** Display names for locales (built-in + custom). */
  const localeNames: Record<string, string> = { ...BUILTIN_LOCALE_NAMES };

  /** Currently active locale code. */
  let currentLocale: string = DEFAULT_LOCALE;

  /** Subscribers notified on any state change. */
  const subscribers = new Set<LocaleChangeCallback>();

  /** Notify all subscribers. Safe to call from anywhere. */
  function notify(): void {
    subscribers.forEach((cb) => {
      try {
        cb();
      } catch {
        // Swallow subscriber errors so one bad listener can't break others.
      }
    });
  }

  /** Lookup a key in a specific dictionary, returning `undefined` if missing. */
  function lookup(dict: Dictionary | undefined, key: string): string | undefined {
    if (!dict) return undefined;
    const value = dict[key];
    return typeof value === 'string' ? value : undefined;
  }

  return {
    /**
     * Translate a key with optional `{param}` interpolation.
     *
     * Resolution order:
     * 1. Active locale dictionary
     * 2. English fallback dictionary
     * 3. The raw key itself (with params still substituted)
     *
     * @param key    - dotted i18n key, e.g. `'field.slave_address'`
     * @param params - optional map of `{name}` placeholders to values
     */
    t(key: string, params?: InterpolationParams): string {
      const active = dictionaries[currentLocale];
      const value =
        lookup(active, key) ??
        lookup(dictionaries.en, key) ??
        key;
      return interpolate(value, params);
    },

    /**
     * Set the active locale. If the code is unknown (no dictionary loaded),
     * the call is ignored and the locale stays unchanged.
     *
     * @param locale - locale code (built-in `Locale` or custom string)
     */
    setLocale(locale: Locale | string): void {
      if (typeof locale !== 'string' || locale.length === 0) return;
      if (!dictionaries[locale]) return;
      if (locale === currentLocale) return;
      currentLocale = locale;
      notify();
    },

    /** Returns the currently active locale code. */
    getLocale(): string {
      return currentLocale;
    },

    /**
     * Subscribe to locale / dictionary changes. Returns an unsubscribe
     * function. Callbacks are stored in a `Set` so duplicate subscriptions
     * are deduplicated by reference.
     */
    subscribe(cb: LocaleChangeCallback): () => void {
      if (typeof cb !== 'function') return () => {};
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    /**
     * Merge a user-provided dictionary under the given locale code.
     *
     * Behaviour:
     * - If the code already exists (built-in OR custom), the new entries
     *   are MERGED on top — existing keys are overwritten, others preserved.
     * - If the code is new, a fresh custom locale is registered.
     * - Setting the locale to the freshly loaded code is the UI's job.
     *
     * @param code - locale code, e.g. `'de'`, `'fr'`, or `'custom-1'`
     * @param name - human-readable display name (e.g. `'Deutsch'`)
     * @param json - flat dictionary of dotted-key → translated string
     */
    loadCustomDictionary(code: string, name: string, json: Dictionary): void {
      if (typeof code !== 'string' || code.length === 0) return;
      if (!json || typeof json !== 'object') return;
      const safeName = typeof name === 'string' && name.length > 0 ? name : code;
      const incoming: Dictionary = {};
      // Sanitize: only accept string values; ignore everything else.
      for (const [k, v] of Object.entries(json)) {
        if (typeof k === 'string' && typeof v === 'string') {
          incoming[k] = v;
        }
      }
      dictionaries[code] = { ...(dictionaries[code] ?? {}), ...incoming };
      localeNames[code] = safeName;
      // Built-ins remain non-custom; new codes are flagged custom.
      if (!(code in BUILTIN_LOCALE_NAMES)) {
        customFlags[code] = true;
      }
      notify();
    },

    /** List all available locales (built-in first, then custom alphabetically). */
    listLocales(): LocaleDescriptor[] {
      const codes = Object.keys(dictionaries);
      codes.sort((a, b) => {
        const aBuiltin = a in BUILTIN_LOCALE_NAMES ? 0 : 1;
        const bBuiltin = b in BUILTIN_LOCALE_NAMES ? 0 : 1;
        if (aBuiltin !== bBuiltin) return aBuiltin - bBuiltin;
        return a.localeCompare(b);
      });
      return codes.map((code) => ({
        code,
        name: localeNames[code] ?? code,
        isCustom: customFlags[code] === true,
      }));
    },

    /** Returns `true` if the key exists in the active locale OR the EN fallback. */
    has(key: string): boolean {
      return (
        lookup(dictionaries[currentLocale], key) !== undefined ||
        lookup(dictionaries.en, key) !== undefined
      );
    },

    /** Read-only dictionary accessor (for debugging / export). */
    getDictionary(code: string): Dictionary | undefined {
      const dict = dictionaries[code];
      return dict ? { ...dict } : undefined;
    },
  };
}

/** Singleton i18n instance for app-wide use. */
export const i18n: I18n = createI18n();

/**
 * Module-level convenience function bound to the singleton instance.
 * Mirrors `i18n.t` so callers can `import { t } from '@/lib/i18n'`.
 */
export function t(key: string, params?: InterpolationParams): string {
  return i18n.t(key, params);
}

/** Set the active locale (delegates to the singleton). */
export function setLocale(locale: Locale | string): void {
  i18n.setLocale(locale);
}

/** Get the active locale code (delegates to the singleton). */
export function getLocale(): string {
  return i18n.getLocale();
}

/** Subscribe to changes (delegates to the singleton). Returns unsubscribe. */
export function subscribe(cb: LocaleChangeCallback): () => void {
  return i18n.subscribe(cb);
}

/** Load a custom dictionary under the given code (delegates to the singleton). */
export function loadCustomDictionary(
  code: string,
  name: string,
  json: Dictionary,
): void {
  i18n.loadCustomDictionary(code, name, json);
}

/** List available locales (delegates to the singleton). */
export function listLocales(): LocaleDescriptor[] {
  return i18n.listLocales();
}

/** Check key existence (delegates to the singleton). */
export function has(key: string): boolean {
  return i18n.has(key);
}

/** Read-only dictionary accessor (delegates to the singleton). */
export function getDictionary(code: string): Dictionary | undefined {
  return i18n.getDictionary(code);
}

export type {
  Dictionary,
  DictionaryRegistry,
  I18n,
  InterpolationParams,
  Locale,
  LocaleChangeCallback,
  LocaleDescriptor,
};
