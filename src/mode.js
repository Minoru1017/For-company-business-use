const MODE_KEY = 'call_coach_mode';
const MODES = new Set(['dev', 'demo', 'drill', 'log']);

import { MODE_ROLES, PHILOSOPHY } from './coach-philosophy.js';

const TAGLINES = {
  dev: `${MODE_ROLES.dev.title}。<br><span>${MODE_ROLES.dev.blurb} ・ 規則分析本機 ・ 三通自寫複盤解鎖 AI 交叉對照</span>`,
  demo: `${MODE_ROLES.demo.title}。<br><span>${MODE_ROLES.demo.blurb} ・ MP4 本機轉錄</span>`,
  drill: `${MODE_ROLES.drill.title}。<br><span>${MODE_ROLES.drill.blurb} ・ 通話中不看逐字稿</span>`,
  log: `${MODE_ROLES.log.title}。<br><span>${MODE_ROLES.log.blurb} ・ wav 只存本機</span>`,
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
  document.body.classList.toggle('in-workspace', active);

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

export function goToModeHome() {
  try {
    sessionStorage.removeItem(MODE_KEY);
  } catch {
    /* ignore */
  }
  location.hash = '';
  applyMode('');
}

export function initModeChooser({ onModeChange, beforeModeSelect } = {}) {
  const chooser = document.getElementById('modeChooser');
  if (!chooser) return;

  const go = (mode) => {
    if (beforeModeSelect && beforeModeSelect(mode) === false) return;
    setMode(mode, { onChange: onModeChange });
  };

  chooser.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => go(btn.dataset.mode));
  });

  document.getElementById('modeBar')?.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => go(btn.dataset.mode));
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
