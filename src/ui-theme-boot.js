/* 同步套用外觀，避免首屏閃錯色（須在 CSS 前以一般 script 載入，不可 type=module） */
(function () {
  var root = typeof document !== 'undefined' ? document.documentElement : null;
  if (!root) return;
  try {
    var k = 'call_coach_ui_theme';
    var v = typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null;
    var pref = v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
    var dark =
      pref === 'dark' ||
      (pref === 'system' &&
        typeof matchMedia === 'function' &&
        matchMedia('(prefers-color-scheme: dark)').matches);
    var t = dark ? 'dark' : 'light';
    root.dataset.theme = t;
    root.style.colorScheme = t;
  } catch (e) {
    root.dataset.theme = 'light';
  }
})();
