/**
 * @file themes/index.ts
 * @description Reactive theme registry & CSS-variable serializer.
 *
 * The registry holds three built-in presets (`day`, `night`,
 * `high_contrast`) plus any number of user-loaded custom themes.
 *
 * The module is browser-safe and React-agnostic. React `useSyncExternalStore`
 * hooks will wrap this in a later task.
 *
 * Usage
 * -----
 * ```ts
 * import { getTheme, setTheme, subscribe, themeToCssVars, loadCustomTheme } from '@/lib/themes';
 *
 * setTheme('night');
 * const vars = themeToCssVars(getTheme());           // { '--bg': '#0a0a0b', ... }
 * loadCustomTheme({ name: 'My Theme', isDark: true, colors: { ... } });
 * ```
 */
import type {
  ByteRole,
  RoleColor,
  Theme,
  ThemeChangeCallback,
  ThemeColors,
  ThemeDescriptor,
  ThemeJSON,
  ThemeValidationResult,
} from './types';
import {
  BUILTIN_THEMES,
  dayTheme,
  getBuiltinTheme,
  highContrastTheme,
  nightTheme,
} from './presets';

/**
 * Default active theme when the registry is first constructed.
 * `day` is the safest default — light themes work in both light & dark
 * OS modes without surprise.
 */
const DEFAULT_THEME_ID = 'day';

/** Set of CSS color keys (excluding `roles`) that must be present & non-empty. */
const REQUIRED_COLOR_KEYS: ReadonlyArray<keyof ThemeColors> = [
  'bg',
  'surface',
  'surfaceAlt',
  'text',
  'textMuted',
  'border',
  'accent',
  'requestBg',
  'responseBg',
  'exceptionBg',
  'invalidBg',
];

/**
 * Validate a candidate theme object.
 *
 * Rules:
 * - Must be a plain object with a non-empty `name` string.
 * - Must contain a `colors` object.
 * - All `REQUIRED_COLOR_KEYS` must be present and non-empty strings.
 * - `colors.roles` must be an object.
 * - `colors.roles.unknown` is REQUIRED (acts as the default for unmapped roles).
 * - Each role entry must have non-empty `fg` and `bg` string values;
 *   `border` is optional but if present must be a non-empty string.
 *
 * @param obj - any unknown value (typically parsed from JSON)
 * @returns `{ ok, errors }` — `errors` is empty when `ok === true`
 */
export function validateTheme(obj: unknown): ThemeValidationResult {
  const errors: string[] = [];

  if (!obj || typeof obj !== 'object') {
    return { ok: false, errors: ['Theme must be an object.'] };
  }
  const root = obj as Record<string, unknown>;

  if (typeof root.name !== 'string' || root.name.trim().length === 0) {
    errors.push('`name` must be a non-empty string.');
  }
  if (typeof root.isDark !== 'undefined' && typeof root.isDark !== 'boolean') {
    errors.push('`isDark` must be a boolean if present.');
  }

  const colors = root.colors as unknown;
  if (!colors || typeof colors !== 'object') {
    errors.push('`colors` must be an object.');
    return { ok: false, errors };
  }
  const c = colors as Record<string, unknown>;

  for (const key of REQUIRED_COLOR_KEYS) {
    const v = c[key];
    if (typeof v !== 'string' || v.trim().length === 0) {
      errors.push(`\`colors.${key}\` must be a non-empty string.`);
    }
  }

  const roles = c.roles as unknown;
  if (!roles || typeof roles !== 'object') {
    errors.push('`colors.roles` must be an object.');
    return { ok: errors.length === 0, errors };
  }
  const rolesObj = roles as Record<string, unknown>;

  if (
    !rolesObj.unknown ||
    typeof rolesObj.unknown !== 'object'
  ) {
    errors.push('`colors.roles.unknown` is required (default for unmapped roles).');
  }

  for (const [roleName, roleVal] of Object.entries(rolesObj)) {
    if (!roleVal || typeof roleVal !== 'object') {
      errors.push(`\`colors.roles.${roleName}\` must be an object.`);
      continue;
    }
    const r = roleVal as Record<string, unknown>;
    if (typeof r.fg !== 'string' || r.fg.trim().length === 0) {
      errors.push(`\`colors.roles.${roleName}.fg\` must be a non-empty string.`);
    }
    if (typeof r.bg !== 'string' || r.bg.trim().length === 0) {
      errors.push(`\`colors.roles.${roleName}.bg\` must be a non-empty string.`);
    }
    if (
      typeof r.border !== 'undefined' &&
      (typeof r.border !== 'string' || r.border.trim().length === 0)
    ) {
      errors.push(`\`colors.roles.${roleName}.border\` must be a non-empty string if present.`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Coerce a validated-but-untyped value into a `Theme`. Callers should
 * run `validateTheme` first; this helper assumes a structurally-sane
 * input. It deep-copies the colors so callers cannot mutate the
 * registry's internal state by holding the JSON reference.
 */
function normalizeTheme(obj: ThemeJSON, fallbackId?: string): Theme {
  const id =
    typeof obj.id === 'string' && obj.id.length > 0
      ? obj.id
      : fallbackId ?? `custom-${Date.now().toString(36)}`;
  return {
    id,
    name: obj.name,
    isDark: obj.isDark === true,
    colors: JSON.parse(JSON.stringify(obj.colors)) as ThemeColors,
  };
}

/** Registry state — kept private to the module via closure. */
interface RegistryState {
  themes: Map<string, Theme>;
  customIds: Set<string>;
  activeId: string;
  subscribers: Set<ThemeChangeCallback>;
}

/** Create a fresh, isolated theme registry. */
function createRegistry(): RegistryState {
  const themes = new Map<string, Theme>();
  const customIds = new Set<string>();
  for (const t of BUILTIN_THEMES) {
    themes.set(t.id, t);
  }
  return {
    themes,
    customIds,
    activeId: DEFAULT_THEME_ID,
    subscribers: new Set(),
  };
}

let state: RegistryState = createRegistry();

/** Notify all subscribers that the active theme (or registry) changed. */
function notify(): void {
  state.subscribers.forEach((cb) => {
    try {
      cb();
    } catch {
      // Swallow subscriber errors so one bad listener can't break others.
    }
  });
}

/**
 * Resolve a role color from a theme, falling back to `unknown` when the
 * role is not explicitly defined. If even `unknown` is missing (should
 * not happen for validated themes), returns a neutral default.
 *
 * @param theme - the active theme
 * @param role  - ByteRole name
 */
export function resolveRoleColor(theme: Theme, role: string): RoleColor {
  const r = theme.colors.roles[role] ?? theme.colors.roles.unknown;
  if (r) return r;
  return { fg: theme.colors.textMuted, bg: 'transparent' };
}

/**
 * Get the currently active theme. Always returns a valid `Theme` object.
 */
export function getTheme(): Theme {
  return state.themes.get(state.activeId) ?? dayTheme;
}

/**
 * Set the active theme by id. If the id is unknown, the call is a no-op.
 *
 * @param id - theme id (built-in or custom)
 */
export function setTheme(id: string): void {
  if (typeof id !== 'string' || id.length === 0) return;
  if (!state.themes.has(id)) return;
  if (id === state.activeId) return;
  state.activeId = id;
  notify();
}

/**
 * Register a custom theme. The theme is validated first; if validation
 * fails, an Error is thrown with the joined error list.
 *
 * @param json - theme JSON (see {@link ThemeJSON})
 * @returns the normalized, registered Theme
 * @throws Error when validation fails
 */
export function loadCustomTheme(json: ThemeJSON): Theme {
  const result = validateTheme(json);
  if (!result.ok) {
    throw new Error(`Invalid theme: ${result.errors.join(' ')}`);
  }
  const theme = normalizeTheme(json);
  state.themes.set(theme.id, theme);
  state.customIds.add(theme.id);
  notify();
  return theme;
}

/**
 * Register a pre-built `Theme` object directly (skipping JSON validation).
 * Useful for programmatic construction in tests or by power-user code.
 * Marks the theme as custom.
 *
 * @param theme - a complete Theme object
 */
export function setCustomTheme(theme: Theme): void {
  if (!theme || typeof theme !== 'object') return;
  if (typeof theme.id !== 'string' || theme.id.length === 0) return;
  state.themes.set(theme.id, theme);
  state.customIds.add(theme.id);
  notify();
}

/**
 * Subscribe to theme changes (active theme set, custom theme added).
 * Returns an unsubscribe function.
 */
export function subscribe(cb: ThemeChangeCallback): () => void {
  if (typeof cb !== 'function') return () => {};
  state.subscribers.add(cb);
  return () => state.subscribers.delete(cb);
}

/**
 * List all registered themes (built-in first, then custom alphabetically).
 */
export function listThemes(): ThemeDescriptor[] {
  const out: ThemeDescriptor[] = [];
  const builtins: ThemeDescriptor[] = [];
  const customs: ThemeDescriptor[] = [];
  for (const t of state.themes.values()) {
    const desc: ThemeDescriptor = {
      id: t.id,
      name: t.name,
      isDark: t.isDark,
      isCustom: state.customIds.has(t.id),
    };
    if (desc.isCustom) customs.push(desc);
    else builtins.push(desc);
  }
  customs.sort((a, b) => a.id.localeCompare(b.id));
  out.push(...builtins, ...customs);
  return out;
}

/**
 * Convert a theme into a flat map of CSS custom properties for injection
 * into a `:root` (or scoped) style rule.
 *
 * Naming convention:
 *  - Surface colors: `--bg`, `--surface`, `--surface-alt`, `--text`,
 *    `--text-muted`, `--border`, `--accent`
 *  - Row backgrounds: `--row-request`, `--row-response`, `--row-exception`,
 *    `--row-invalid`
 *  - Role colors: `--role-<name>-fg`, `--role-<name>-bg`, `--role-<name>-border`
 *    (border omitted when not set)
 *
 * @param theme - the theme to serialize
 * @returns a `Record<string, string>` of CSS var name → value
 */
export function themeToCssVars(theme: Theme): Record<string, string> {
  const c = theme.colors;
  const vars: Record<string, string> = {
    '--bg': c.bg,
    '--surface': c.surface,
    '--surface-alt': c.surfaceAlt,
    '--text': c.text,
    '--text-muted': c.textMuted,
    '--border': c.border,
    '--accent': c.accent,
    '--row-request': c.requestBg,
    '--row-response': c.responseBg,
    '--row-exception': c.exceptionBg,
    '--row-invalid': c.invalidBg,
  };
  for (const [roleName, roleColor] of Object.entries(c.roles)) {
    const safeName = roleName.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
    vars[`--role-${safeName}-fg`] = roleColor.fg;
    vars[`--role-${safeName}-bg`] = roleColor.bg;
    if (typeof roleColor.border === 'string') {
      vars[`--role-${safeName}-border`] = roleColor.border;
    }
  }
  return vars;
}

/**
 * Reset the registry to its initial state — clears all custom themes and
 * resets the active theme to the default. Primarily intended for tests.
 */
export function _resetRegistry(): void {
  state = createRegistry();
  notify();
}

export type {
  ByteRole,
  RoleColor,
  Theme,
  ThemeChangeCallback,
  ThemeColors,
  ThemeDescriptor,
  ThemeJSON,
  ThemeValidationResult,
};
export { BYTE_ROLES } from './types';
export {
  BUILTIN_THEMES,
  dayTheme,
  getBuiltinTheme,
  highContrastTheme,
  nightTheme,
} from './presets';
