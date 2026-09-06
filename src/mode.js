const MODE_KEY = 'call_coach_mode';

export function resolveMode() {
  const hash = location.hash.replace('#', '');
  if (hash === 'demo' || hash === 'transcribe') return 'demo';
  if (hash === 'dev') return 'dev';
  return sessionStorage.getItem(MODE_KEY) || '';
}

export function setMode(mode, { onChange } = {}) {
  sessionStorage.setItem(MODE_KEY, mode);
  location.hash = mode === 'demo' ? 'demo' : 'dev';
  applyMode(mode);
  onChange?.(mode);
}

export function applyMode(mode) {
  const chooser = document.getElementById('modeChooser');
  const main = document.getElementById('mainApp');
  const devSection = document.getElementById('devSection');
  const demoSection = document.getElementById('demoSection');
  const modeBar = document.getElementById('modeBar');
  const tagline = document.getElementById('heroTagline');

  if (!chooser || !main) return;

  const active = mode === 'dev' || mode === 'demo';
  chooser.hidden = active;
  main.hidden = !active;

  if (devSection) devSection.hidden = mode !== 'dev';
  if (demoSection) demoSection.hidden = mode !== 'demo';

  if (modeBar) {
    modeBar.hidden = !active;
    modeBar.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
  }

  if (tagline) {
    tagline.innerHTML =
      mode === 'demo'
        ? 'DEMO 錄影本機轉錄 → 自動載入逐字稿 → 銷售分析。<br><span>MP4 不上雲 ・ 轉錄在本機 ・ 分析可選 AI</span>'
        : '電訪逐字稿分析工具——把每一通電話變成可複盤的專業判斷。<br><span>Vibe .vibe.json / SRT ・ 規則分析全程本地 ・ 僅 AI 功能會傳送至 Google</span>';
  }

  document.title =
    mode === 'demo' ? 'CALL COACH｜DEMO 轉錄與分析' : 'CALL COACH｜顧問式銷售電訪分析';
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
