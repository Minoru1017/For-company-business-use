/* 同步套用外觀，避免首屏閃錯色（須在 CSS 前以一般 script 載入，不可 type=module） */
(function () {
  try {
    var k = 'call_coach_ui_theme';
    var v = localStorage.getItem(k);
    var pref = v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
    var dark =
      pref === 'dark' ||
      (pref === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    var t = dark ? 'dark' : 'light';
    document.documentElement.dataset.theme = t;
    document.documentElement.style.colorScheme = t;
  } catch (e) {
    document.documentElement.dataset.theme = 'light';
  }
})();
