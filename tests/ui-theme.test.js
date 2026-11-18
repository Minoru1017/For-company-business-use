import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_UI_THEME,
  UI_THEME_KEY,
  applyUiTheme,
  cycleUiTheme,
  getUiThemePref,
  normalizeUiTheme,
  resolveUiTheme,
  setUiThemePref,
  uiThemeLabel,
} from '../src/ui-theme.js';

let store;
let root;
beforeEach(() => {
  store = new Map();
  root = { dataset: {}, style: { colorScheme: '' }, removeAttribute(name) { if (name === 'data-theme') delete this.dataset.theme; } };
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
  vi.stubGlobal('document', { documentElement: root });
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })),
  );
});

describe('ui-theme', () => {
  it('normalizes and defaults to system', () => {
    expect(normalizeUiTheme('nope')).toBe(DEFAULT_UI_THEME);
    expect(getUiThemePref()).toBe('system');
    expect(uiThemeLabel('light')).toBe('淺色');
    expect(uiThemeLabel('dark')).toBe('深色');
    expect(uiThemeLabel('system')).toBe('跟隨系統');
  });

  it('resolves system against prefers-color-scheme', () => {
    expect(resolveUiTheme('system')).toBe('light');
    matchMedia.mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} });
    expect(resolveUiTheme('system')).toBe('dark');
    expect(resolveUiTheme('light')).toBe('light');
    expect(resolveUiTheme('dark')).toBe('dark');
  });

  it('persists preference and sets data-theme', () => {
    const r = setUiThemePref('dark');
    expect(r).toEqual({ pref: 'dark', theme: 'dark' });
    expect(store.get(UI_THEME_KEY)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    applyUiTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('cycles light → dark → system', () => {
    setUiThemePref('light');
    expect(cycleUiTheme().pref).toBe('dark');
    expect(cycleUiTheme().pref).toBe('system');
    expect(cycleUiTheme().pref).toBe('light');
  });
});
