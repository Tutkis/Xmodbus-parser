'use client';

import { useSyncExternalStore, useEffect } from 'react';
import {
  getTheme,
  setTheme as setThemeFn,
  subscribe,
  listThemes,
  loadCustomTheme,
  validateTheme,
  themeToCssVars,
} from '@/lib/themes';
import type { Theme, ThemeJSON } from '@/lib/themes/types';

/**
 * React hook that subscribes to the theme registry, applies the active
 * theme's CSS variables to <html>, and reflects the dark class for
 * Tailwind's `.dark` variant.
 */
export function useTheme() {
  const theme = useSyncExternalStore(
    subscribe,
    getTheme,
    getTheme, // server snapshot
  );

  // Apply CSS variables + .dark class whenever theme changes.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const vars = themeToCssVars(theme);
    for (const [k, v] of Object.entries(vars)) {
      root.style.setProperty(k, v);
    }
    // Surface-level variables that map to shadcn/ui tokens so existing
    // components (Button, Card, etc.) follow the active theme.
    root.style.setProperty('--background', theme.colors.bg);
    root.style.setProperty('--foreground', theme.colors.text);
    root.style.setProperty('--card', theme.colors.surface);
    root.style.setProperty('--card-foreground', theme.colors.text);
    root.style.setProperty('--popover', theme.colors.surface);
    root.style.setProperty('--popover-foreground', theme.colors.text);
    root.style.setProperty('--border', theme.colors.border);
    root.style.setProperty('--input', theme.colors.border);
    root.style.setProperty('--muted', theme.colors.surfaceAlt);
    root.style.setProperty('--muted-foreground', theme.colors.textMuted);
    root.style.setProperty('--accent', theme.colors.accent);
    root.style.setProperty('--accent-foreground', theme.colors.text);
    root.style.setProperty('--secondary', theme.colors.surfaceAlt);
    root.style.setProperty('--secondary-foreground', theme.colors.text);
    root.style.setProperty('--radius', '0.5rem');

    if (theme.isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  return {
    theme,
    setTheme: (id: string) => setThemeFn(id),
    listThemes,
    loadCustomTheme: (json: ThemeJSON) => loadCustomTheme(json),
    validateTheme,
  };
}

export type { Theme, ThemeJSON };
