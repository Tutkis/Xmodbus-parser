'use client';

import { useSyncExternalStore } from 'react';
import {
  i18n,
  t as translate,
  setLocale,
  getLocale,
  subscribe,
  loadCustomDictionary,
  listLocales,
} from '@/lib/i18n';
import type { Locale } from '@/lib/i18n/types';

/**
 * React hook that subscribes to the i18n singleton and returns a stable
 * `t()` function plus the current locale. Re-renders on locale change.
 */
export function useI18n() {
  const locale = useSyncExternalStore(
    subscribe,
    getLocale,
    getLocale, // server snapshot
  );

  return {
    locale,
    t: translate,
    setLocale: (l: Locale | string) => setLocale(l),
    listLocales,
    loadCustomDictionary,
  };
}

export { i18n };
