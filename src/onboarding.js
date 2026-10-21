/**
 * 新手教學：首頁導覽（第一次打開）與工作區導覽（第一次進入任一模式）。
 * 每一步聚焦一個畫面元素；元素不在畫面上（窄螢幕收起側欄、區塊還沒內容）時改成置中說明，不會卡住。
 * 鍵盤：← → 換步、Esc 結束；Tab 只在說明卡內循環。
 */
import { EDITION } from './edition.js';
import { WS_HEADINGS } from './mode.js';

export const ONBOARDING_KEY = 'callCoachOnboarding';
export const TOUR_IDS = ['home', 'workspace'];

const MODE_TIPS = {
  dev: '上傳 Vibe 匯出的 SRT／VTT／TXT，或直接上傳錄音檔轉錄 → 標記誰是業務、誰是客戶 → 分析。手邊沒有檔案，可以先按「載入範例逐字稿」走一遍。',
  demo: '用本機助手把 DEMO 錄影（MP4）轉成逐字稿，邊回放邊標記關鍵時刻。還沒安裝助手也能先載入範例逐字稿試用。',
  drill: 'AI 扮演留過資料的潛在客戶：你主動提問、限時接話，練完看自己卡在顧問式銷售的哪一步。',
  log: '每通電話記下「斷在哪一步」的症狀，可匯入當天錄音、播放時按 M 標記話點；累積後用心智圖與批次分析找共同問題，最後只寫「明天改一件事」。',
  brief: '按下錄音，主管早會即時轉成文字；萃取重點後由你確認，再套用成專案方向。',
  deck: '從有邀約的開發紀錄產生 DEMO 簡報，只講客戶在意的事；可以直接全螢幕簡報或下載 PPTX。',
};

const MODE_LIST = [
  ['電訪逐字稿', '電話打完，分析一通電話問題出在哪'],
  ['錄影轉逐字稿', 'DEMO 錄影轉文字、回放複盤'],
  ['臨場反應陪練', '跟 AI 扮演的客戶練接話'],
  ['開發症狀紀錄', '每天記錄、匯入錄音、找共同問題'],
  ['主管早會', '錄音轉文字，整理成方向'],
  ['DEMO 簡報', '有邀約後做投其所好的簡報'],
];

function welcomeBody() {
  const lines = [
    '這是一套陪你練<b>顧問式銷售</b>的工具：上傳電訪或 DEMO 的逐字稿與錄音，找出卡在哪一步，再把改善落實到下一通電話。',
    '紀錄預設只存在<b>這台瀏覽器</b>；只有你按下 AI 功能時，內容才會送到 Google Gemini。',
  ];
  if (EDITION === 'public') lines.push('目前是<b>去識別公開版</b>：品牌、地點與帳號都換成通用名稱，雲端同步與試算表需要自行設定。');
  lines.push('接下來約一分鐘，帶你認識首頁。');
  return lines.map((l) => `<p>${l}</p>`).join('');
}

export const TOURS = {
  home: [
    { id: 'welcome', title: '歡迎使用 Call Coach', body: welcomeBody },
    {
      id: 'brand',
      target: '.home-brand-switch',
      title: '先選要經營的品牌',
      body: '<p>DEMO 簡報與 DEMO 後複盤依品牌分開存放，切換後畫面只顯示該品牌的資料；客戶主檔兩個品牌共用。</p>',
    },
    {
      id: 'day-type',
      target: '#dayTypeToggle',
      title: '今天是上班日嗎？',
      body: '<p>上班日可以直接進入各個工作模式。選「非上班日」時，要先完成當天的 AI 趨勢與銷售技巧影片心得，才會開放工作模式。</p>',
    },
    {
      id: 'today',
      target: '#todayPanel',
      title: '每天先看「今天」',
      body: '<p>這裡顯示昨天寫下「要改的一件事」、今天已完成幾通自寫複盤，以及這週的開發漏斗。下方按鈕會帶你去做下一步。</p>',
    },
    {
      id: 'modes',
      target: '.mode-cards',
      title: '六個工作模式',
      body: () =>
        `<ul class="ob-list">${MODE_LIST.map(([name, use]) => `<li><b>${name}</b><span>${use}</span></li>`).join('')}</ul>`,
    },
    {
      id: 'start',
      target: '.mode-card[data-mode="dev"]',
      title: '建議從這裡開始',
      body: '<p>第一次使用，先進「電訪逐字稿」。上傳一份逐字稿或錄音，規則分析全程在本機完成；沒有檔案也可以用內建範例。</p>',
    },
    {
      id: 'data',
      target: '#homeCloudBtn',
      title: '資料與備份',
      body: '<p>換電腦或清除瀏覽器資料前，請先用「備份／還原」匯出一份；也可以登入雲端，用你自己的同步密碼加密後同步到其他裝置。</p>',
    },
    {
      id: 'replay',
      target: '#onboardingHomeBtn',
      title: '隨時可以重看',
      body: '<p>按「新手教學」會重新播放這段導覽。第一次進入工作模式時，也會有一段工作區的簡短說明。</p>',
    },
  ],
  workspace: [
    {
      id: 'mode-bar',
      target: ['#modeBar', '#sidebarMenu'],
      title: '左側切換模式',
      body: '<p>六個工作模式都在側欄，隨時切換，不必回首頁；按最上方的 CALL COACH 回到首頁。手機上側欄收在左上角的 ☰ 選單裡。</p>',
    },
    {
      id: 'mode-tip',
      target: '.ws-head',
      title: (mode) => `目前在「${WS_HEADINGS[mode]?.title || '工作區'}」`,
      body: (mode) => `<p>${MODE_TIPS[mode] || MODE_TIPS.dev}</p>`,
    },
    {
      id: 'sections',
      target: (mode) => `#${mode}Section .sec-head`,
      title: '照編號由上往下做',
      body: '<p>每個模式都拆成編號區塊（01、02…），由上往下完成即可。寬螢幕右側的「本頁」章節導覽可以直接跳到某一段。</p>',
    },
    {
      id: 'recent',
      target: ['.app-sidebar-recent', '#sidebarMenu'],
      title: '最近項目',
      body: '<p>分析過的逐字稿會留在這裡，可以搜尋、點一下重新打開；「新增逐字稿」會清空目前畫面重新開始。</p>',
    },
    {
      id: 'backup',
      target: ['.app-sidebar-foot', '#sidebarMenu'],
      title: '備份、雲端與清空',
      body: '<p>資料只存在這台瀏覽器。定期「備份／還原」匯出一份檔案；「清空紀錄」會刪除這台裝置上的資料，按之前請先備份。</p>',
    },
    {
      id: 'replay',
      target: ['#onboardingSidebarBtn', '#sidebarMenu'],
      title: '隨時可以重看',
      body: '<p>側欄底部的「新手教學」可以重看這段說明。祝今天的電話順利！</p>',
    },
  ],
};

/* ---------- 狀態 ---------- */

function defaultStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadTourState(storage = defaultStorage()) {
  try {
    const v = JSON.parse(storage?.getItem(ONBOARDING_KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function isTourDone(id, storage = defaultStorage()) {
  return !!loadTourState(storage)[id];
}

export function markTourDone(id, storage = defaultStorage()) {
  const next = { ...loadTourState(storage), [id]: new Date().toISOString() };
  try {
    storage?.setItem(ONBOARDING_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function resetTours(storage = defaultStorage()) {
  try {
    storage?.removeItem(ONBOARDING_KEY);
  } catch {
    /* ignore */
  }
}

/** 步驟欄位可以是字串或依目前模式產生的函式；target 可給多個，依序取第一個看得到的 */
export function resolveStep(step, mode = '') {
  const v = (x) => (typeof x === 'function' ? x(mode) : x);
  const target = v(step.target) || [];
  return { id: step.id, targets: Array.isArray(target) ? target : [target], title: v(step.title) || '', body: v(step.body) || '' };
}

function findTarget(selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    const rect = usableRect(el);
    if (rect) return { el, rect };
  }
  return { el: null, rect: null };
}

/* ---------- 位置 ---------- */

/**
 * 說明卡放在目標的下、上、右、左（依序挑第一個放得下的）；都放不下就貼在畫面底部。
 * target 為 null 時置中。座標都以視窗為準。
 */
export function placeCard(target, card, view, { gap = 14, margin = 12 } = {}) {
  const clampX = (x) => Math.max(margin, Math.min(x, view.width - card.width - margin));
  const clampY = (y) => Math.max(margin, Math.min(y, view.height - card.height - margin));
  if (!target) return { side: 'center', top: clampY((view.height - card.height) / 2), left: clampX((view.width - card.width) / 2) };

  const bottom = target.top + target.height;
  const right = target.left + target.width;
  const cx = target.left + target.width / 2 - card.width / 2;
  const cy = target.top + target.height / 2 - card.height / 2;
  if (view.height - bottom - gap - margin >= card.height) return { side: 'bottom', top: bottom + gap, left: clampX(cx) };
  if (target.top - gap - margin >= card.height) return { side: 'top', top: target.top - gap - card.height, left: clampX(cx) };
  if (view.width - right - gap - margin >= card.width) return { side: 'right', top: clampY(cy), left: right + gap };
  if (target.left - gap - margin >= card.width) return { side: 'left', top: clampY(cy), left: target.left - gap - card.width };
  return { side: 'inside', top: view.height - card.height - margin, left: clampX(cx) };
}

/** 目標看得到、而且有面積才聚焦；否則該步改成置中說明 */
export function usableRect(el) {
  if (!el || el.closest?.('[hidden]')) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (r.right <= 0 || r.left >= vw) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height, fullHeight: r.height > vh * 0.7 };
}

/* ---------- 畫面 ---------- */

let active = null;

export function isTourActive() {
  return !!active;
}

export function startTour(id, { mode = '', storage = defaultStorage(), onClose } = {}) {
  const steps = TOURS[id];
  if (!steps?.length || typeof document === 'undefined') return null;
  stopTour();

  const root = document.createElement('div');
  root.className = 'ob-root';
  root.dataset.tour = id;
  root.innerHTML = `
    <div class="ob-scrim"></div>
    <div class="ob-spot" aria-hidden="true"></div>
    <section class="ob-card" role="dialog" aria-modal="true" aria-labelledby="obTitle" aria-describedby="obBody" tabindex="-1">
      <p class="ob-kicker"><span>新手教學</span><span class="ob-count mono" id="obCount"></span></p>
      <h3 class="ob-title" id="obTitle"></h3>
      <div class="ob-body" id="obBody"></div>
      <div class="ob-dots" aria-hidden="true">${steps.map(() => '<i></i>').join('')}</div>
      <div class="ob-actions">
        <button type="button" class="ob-btn ob-skip" data-ob="skip">略過教學</button>
        <span class="ob-actions-gap"></span>
        <button type="button" class="ob-btn" data-ob="prev">上一步</button>
        <button type="button" class="ob-btn ob-next" data-ob="next">下一步</button>
      </div>
    </section>`;
  document.body.appendChild(root);
  document.body.classList.add('ob-open');

  const card = root.querySelector('.ob-card');
  const spot = root.querySelector('.ob-spot');
  const prevFocus = document.activeElement;
  const state = { id, mode, index: 0, root };
  let raf = 0;

  const position = () => {
    const { rect } = findTarget(resolveStep(steps[state.index], mode).targets);
    root.classList.toggle('ob-centered', !rect);
    if (rect) {
      const pad = 6;
      Object.assign(spot.style, {
        top: `${rect.top - pad}px`,
        left: `${rect.left - pad}px`,
        width: `${rect.width + pad * 2}px`,
        height: `${rect.height + pad * 2}px`,
      });
    }
    const view = { width: window.innerWidth, height: window.innerHeight };
    const size = { width: card.offsetWidth, height: card.offsetHeight };
    const spotRect = rect && { top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 };
    const p = placeCard(spotRect, size, view);
    card.dataset.side = p.side;
    card.style.top = `${Math.round(p.top)}px`;
    card.style.left = `${Math.round(p.left)}px`;
  };
  const schedule = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(position);
  };

  const render = () => {
    const step = resolveStep(steps[state.index], mode);
    const last = state.index === steps.length - 1;
    root.dataset.step = step.id;
    root.querySelector('#obTitle').textContent = step.title;
    root.querySelector('#obBody').innerHTML = step.body;
    root.querySelector('#obCount').textContent = `${state.index + 1} / ${steps.length}`;
    root.querySelectorAll('.ob-dots i').forEach((d, i) => d.classList.toggle('on', i <= state.index));
    root.querySelector('[data-ob="prev"]').hidden = state.index === 0;
    root.querySelector('[data-ob="skip"]').hidden = last;
    root.querySelector('[data-ob="next"]').textContent = last ? '完成' : step.targets.length ? '下一步' : '開始導覽';
    const { el, rect } = findTarget(step.targets);
    if (rect && (rect.top < 0 || rect.top + Math.min(rect.height, 160) > window.innerHeight)) {
      el.scrollIntoView({ block: rect.fullHeight ? 'start' : 'center' });
    }
    position();
    card.focus({ preventScroll: true });
  };

  const close = (finished) => {
    if (active !== state) return;
    markTourDone(id, storage);
    stopTour();
    if (prevFocus && typeof prevFocus.focus === 'function' && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
    onClose?.({ id, finished });
  };
  const go = (delta) => {
    const next = state.index + delta;
    if (next < 0) return;
    if (next >= steps.length) return close(true);
    state.index = next;
    render();
  };

  root.addEventListener('click', (e) => {
    const act = e.target.closest('[data-ob]')?.dataset.ob;
    if (act === 'next') go(1);
    else if (act === 'prev') go(-1);
    else if (act === 'skip') close(false);
  });
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close(false);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(-1);
    } else if (e.key === 'Tab') {
      const items = [...card.querySelectorAll('button:not([hidden])')];
      if (!items.length) return;
      const i = items.indexOf(document.activeElement);
      e.preventDefault();
      const n = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i + 1) % items.length;
      items[n].focus();
    }
  };
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, true);

  state.cleanup = () => {
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('scroll', schedule, true);
    root.remove();
    document.body.classList.remove('ob-open');
  };
  state.go = go;
  state.close = close;
  active = state;
  render();
  return state;
}

export function stopTour() {
  if (!active) return;
  const s = active;
  active = null;
  s.cleanup();
}

/**
 * 首頁第一次打開自動播放首頁導覽；第一次進入任一模式自動播放工作區導覽。
 * 「新手教學」按鈕（首頁頁首、側欄底部）隨時重播當下這一段。
 */
export function initOnboarding({ getMode = () => document.body.dataset.mode || '', storage = defaultStorage(), delay = 500 } = {}) {
  if (typeof document === 'undefined') return { start: () => null };
  let timer = 0;
  const startFor = (mode) => (mode ? startTour('workspace', { mode, storage }) : startTour('home', { storage }));
  const maybeAuto = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const mode = getMode();
      const id = mode ? 'workspace' : 'home';
      if (active) {
        if (active.id === id && active.mode === mode) return;
        stopTour();
      }
      if (!isTourDone(id, storage)) startFor(mode);
    }, delay);
  };

  document.getElementById('onboardingHomeBtn')?.addEventListener('click', () => startFor(''));
  document.getElementById('onboardingSidebarBtn')?.addEventListener('click', () => {
    document.body.classList.remove('sidebar-open');
    startFor(getMode());
  });
  window.addEventListener('hashchange', maybeAuto);
  maybeAuto();
  return { start: startFor };
}
