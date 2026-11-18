/**
 * 介面淺色／深色主題。
 * 淺色＝Quest（暖米色卡片、黑黃重點）；深色＝儀表層（近黑畫布、紙色強調）。
 * 選擇存在本機；「跟隨系統」會聽 prefers-color-scheme。
 */

export const UI_THEME_KEY = 'call_coach_ui_theme';
export const UI_THEME_CHANGED_EVENT = 'callcoach:ui-theme';
export const UI_THEMES = ['light', 'dark', 'system'];
export const DEFAULT_UI_THEME = 'system';

export function normalizeUiTheme(value, fallback = DEFAULT_UI_THEME) {
  return UI_THEMES.includes(value) ? value : fallback;
}

export function getUiThemePref() {
  try {
    return normalizeUiTheme(localStorage.getItem(UI_THEME_KEY));
  } catch {
    return DEFAULT_UI_THEME;
  }
}

export function systemPrefersDark() {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/** 實際套用的 light｜dark（已解析 system） */
export function resolveUiTheme(pref = getUiThemePref()) {
  const p = normalizeUiTheme(pref);
  if (p === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return p;
}

export function applyUiTheme(resolved = resolveUiTheme()) {
  const theme = resolved === 'dark' ? 'dark' : 'light';
  if (typeof document === 'undefined') return theme;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  return theme;
}

export function setUiThemePref(value) {
  const next = normalizeUiTheme(value);
  const prev = getUiThemePref();
  try {
    localStorage.setItem(UI_THEME_KEY, next);
  } catch {
    /* ignore */
  }
  const resolved = applyUiTheme(resolveUiTheme(next));
  if (next !== prev && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(UI_THEME_CHANGED_EVENT, { detail: { pref: next, theme: resolved } }));
  }
  return { pref: next, theme: resolved };
}

export function cycleUiTheme(pref = getUiThemePref()) {
  const order = ['light', 'dark', 'system'];
  const i = order.indexOf(normalizeUiTheme(pref));
  return setUiThemePref(order[(i + 1) % order.length]);
}

export function uiThemeLabel(pref = getUiThemePref()) {
  const p = normalizeUiTheme(pref);
  if (p === 'light') return '淺色';
  if (p === 'dark') return '深色';
  return '跟隨系統';
}

export function onUiThemeChange(fn) {
  if (typeof window === 'undefined') return () => {};
  const h = (e) => fn(e.detail || { pref: getUiThemePref(), theme: resolveUiTheme() });
  window.addEventListener(UI_THEME_CHANGED_EVENT, h);
  return () => window.removeEventListener(UI_THEME_CHANGED_EVENT, h);
}

/** 內嵌於 <head> 的同步腳本字串，避免首屏閃一下錯色 */
export function bootUiThemeInlineScript() {
  return `(function(){try{var k=${JSON.stringify(UI_THEME_KEY)};var v=localStorage.getItem(k);var ok=v==='light'||v==='dark'||v==='system';var pref=ok?v:${JSON.stringify(DEFAULT_UI_THEME)};var dark=pref==='dark'||(pref==='system'&&window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches);var t=dark?'dark':'light';document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;}catch(e){document.documentElement.dataset.theme='light';}})();`;
}

/**
 * 掛上切換器：任何 [data-ui-theme-set] 可指定主題；
 * [data-ui-theme-cycle] 在淺色→深色→跟隨系統間輪替。
 */
export function initUiThemeControls(root = typeof document !== 'undefined' ? document : null) {
  if (!root) return () => {};
  applyUiTheme();

  const sync = () => {
    const pref = getUiThemePref();
    const theme = resolveUiTheme(pref);
    root.querySelectorAll('[data-ui-theme-set]').forEach((btn) => {
      const on = btn.dataset.uiThemeSet === pref;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    root.querySelectorAll('[data-ui-theme-cycle]').forEach((btn) => {
      btn.dataset.uiTheme = theme;
      btn.dataset.uiThemePref = pref;
      btn.setAttribute('aria-label', `外觀：${uiThemeLabel(pref)}（點擊切換）`);
      btn.title = `外觀：${uiThemeLabel(pref)}`;
      const label = btn.querySelector('[data-ui-theme-label]');
      if (label) label.textContent = uiThemeLabel(pref);
      const use = btn.querySelector('use');
      if (use) use.setAttribute('href', theme === 'dark' ? '#i-moon' : '#i-sun');
    });
  };

  const onClick = (e) => {
    const setBtn = e.target.closest?.('[data-ui-theme-set]');
    if (setBtn) {
      setUiThemePref(setBtn.dataset.uiThemeSet);
      return;
    }
    const cycleBtn = e.target.closest?.('[data-ui-theme-cycle]');
    if (cycleBtn) cycleUiTheme();
  };

  const onSystem = () => {
    if (getUiThemePref() === 'system') {
      applyUiTheme();
      sync();
    }
  };

  root.addEventListener('click', onClick);
  const unsub = onUiThemeChange(sync);
  let mql;
  try {
    mql = matchMedia('(prefers-color-scheme: dark)');
    mql.addEventListener?.('change', onSystem);
  } catch {
    /* ignore */
  }
  sync();
  return () => {
    root.removeEventListener('click', onClick);
    unsub();
    mql?.removeEventListener?.('change', onSystem);
  };
}
