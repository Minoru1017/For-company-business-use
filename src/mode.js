const MODE_KEY = 'call_coach_mode';
const MODES = new Set(['dev', 'demo', 'drill', 'log']);

const TAGLINES = {
  dev: '電訪逐字稿分析工具——把每一通電話變成可複盤的專業判斷。<br><span>錄音檔直接 AI 轉錄 或 Vibe .vibe.json / SRT ・ 規則分析全程本地 ・ 僅轉錄與 AI 功能會傳送至 Google</span>',
  demo: 'DEMO 錄影本機轉錄 → 自動載入逐字稿 → 銷售分析。<br><span>MP4 不上雲 ・ 轉錄在本機 ・ 分析可選 AI</span>',
  drill: '電訪開發陪練——你主動問、客戶即時回、限時接話。<br><span>練不慌、不套話、不卡住 ・ 離線劇本可用 ・ 結束後一鍵送進完整分析</span>',
  log: '開發症狀紀錄——每天的漏斗、當天的錄音、跨通共同病症、明天只改一個動作。<br><span>公司電話系統 wav 直接匯入 ・ 錄音與筆記只存這台電腦 ・ 轉錄與 AI 診斷才會送出</span>',
};

const TITLES = {
  dev: 'CALL COACH｜顧問式銷售電訪分析',
  demo: 'CALL COACH｜DEMO 轉錄與分析',
  drill: 'CALL COACH｜電訪開發陪練',
  log: 'CALL COACH｜開發症狀紀錄',
};

export function resolveMode() {
  const hash = location.hash.replace('#', '');
  if (hash === 'demo' || hash === 'transcribe') return 'demo';
  if (hash === 'dev') return 'dev';
  if (hash === 'drill' || hash === 'practice') return 'drill';
  if (hash === 'log' || hash === 'symptom') return 'log';
  const saved = sessionStorage.getItem(MODE_KEY) || '';
  return MODES.has(saved) ? saved : '';
}

export function setMode(mode, { onChange } = {}) {
  sessionStorage.setItem(MODE_KEY, mode);
  location.hash = MODES.has(mode) ? mode : 'dev';
  applyMode(mode);
  onChange?.(mode);
}

export function applyMode(mode) {
  const chooser = document.getElementById('modeChooser');
  const main = document.getElementById('mainApp');
  const devSection = document.getElementById('devSection');
  const demoSection = document.getElementById('demoSection');
  const drillSection = document.getElementById('drillSection');
  const logSection = document.getElementById('logSection');
  const modeBar = document.getElementById('modeBar');
  const tagline = document.getElementById('heroTagline');

  if (!chooser || !main) return;

  const active = MODES.has(mode);
  chooser.hidden = active;
  main.hidden = !active;

  if (devSection) devSection.hidden = mode !== 'dev';
  if (demoSection) demoSection.hidden = mode !== 'demo';
  if (drillSection) drillSection.hidden = mode !== 'drill';
  if (logSection) logSection.hidden = mode !== 'log';

  if (modeBar) {
    modeBar.hidden = !active;
    modeBar.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
  }

  if (tagline) tagline.innerHTML = TAGLINES[mode] || TAGLINES.dev;
  document.title = TITLES[mode] || TITLES.dev;
}

export function initModeChooser({ onModeChange } = {}) {
  const chooser = document.getElementById('modeChooser');
  if (!chooser) return;

  chooser.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode, { onChange: onModeChange }));
  });

  document.getElementById('modeBar')?.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode, { onChange: onModeChange }));
  });

  window.addEventListener('hashchange', () => {
    const mode = resolveMode();
    if (mode) applyMode(mode);
  });

  const initial = resolveMode();
  if (initial) {
    applyMode(initial);
    onModeChange?.(initial);
  } else {
    applyMode('');
  }
}
