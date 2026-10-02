'use client';

import { useEffect, type ReactNode } from 'react';
import { useTheme } from '@/hooks/use-theme';
import { useI18n } from '@/hooks/use-i18n';
import { i18n } from '@/lib/i18n';

/**
 * Client-side providers: initialises i18n from the browser language,
 * and applies the active theme's CSS variables to <html>.
 *
 * Wrap the app body with this so every tab/page gets theme + i18n.
 */
export function Providers({ children }: { children: ReactNode }) {
  // Both hooks apply their side-effects on mount and on changes.
  useTheme();
  const { locale, setLocale } = useI18n();

  // Detect browser language once.
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    // Only auto-set on first visit (no persisted locale yet).
    const stored = typeof localStorage !== 'undefined'
      ? localStorage.getItem('modbus-analyzer-locale')
      : null;
    if (stored) return;
    const nav = navigator.language?.toLowerCase() ?? 'en';
    let picked: 'en' | 'ru' | 'zh' = 'en';
    if (nav.startsWith('ru')) picked = 'ru';
    else if (nav.startsWith('zh')) picked = 'zh';
    setLocale(picked);
    try {
      localStorage.setItem('modbus-analyzer-locale', picked);
    } catch {
      /* ignore */
    }
  }, [setLocale]);

  // Persist locale on change.
  useEffect(() => {
    try {
      localStorage.setItem('modbus-analyzer-locale', locale);
    } catch {
      /* ignore */
    }
  }, [locale]);

  // Register service worker for offline PWA support.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    // Only register in production builds (dev HMR + SW conflicts).
    if (process.env.NODE_ENV !== 'production') return;
    const onLoad = () => {
      // Resolve SW path relative to current location so it works with
      // basePath (e.g. /repo-name/sw.js on GitHub Pages).
      const swUrl = new URL('./sw.js', window.location.href).href;
      navigator.serviceWorker.register(swUrl, { scope: './' }).catch(() => {
        // Silent fail — SW is a progressive enhancement.
      });
    };
    window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad);
  }, []);

  // Make i18n singleton reference the same instance for non-hook callers.
  void i18n;

  return <>{children}</>;
}
