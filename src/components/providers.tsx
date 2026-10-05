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

  // Detect browser language or restore persisted locale on mount.
  // Runs ONCE — empty deps (setLocale is a stable singleton method).
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const stored = typeof localStorage !== 'undefined'
      ? localStorage.getItem('modbus-analyzer-locale')
      : null;
    if (stored) {
      setLocale(stored);
      return;
    }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    const registerSW = () => {
      const bp = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, '') || '';
      const swUrl = `${bp}/sw.js`;
      const scope = `${bp}/`;
      navigator.serviceWorker
        .register(swUrl, { scope, updateViaCache: 'none' })
        .then((reg) => {
          // Force update if a new SW is waiting.
          if (reg.waiting) {
            reg.waiting.postMessage('SKIP_WAITING');
          }
        })
        .catch(() => {
          // Silent fail — SW is a progressive enhancement.
        });
    };

    if (document.readyState === 'complete') {
      registerSW();
    } else {
      window.addEventListener('load', registerSW);
      return () => window.removeEventListener('load', registerSW);
    }
  }, []);

  // Make i18n singleton reference the same instance for non-hook callers.
  void i18n;

  return <>{children}</>;
}
