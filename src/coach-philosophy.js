/**
 * Call Coach 產品價值觀（8/25 大會：業績是做出來的 → 聽自己 → 找問題 → 再做）。
 * 文案與流程判斷集中在此，避免各模式各說各話。
 */

/** 核心循環：產品內所有模式都應對回這四步 */
export const COACH_CYCLE = [
  { key: 'do', label: '做', line: '自己打、自己講——不是只聽分享或只看報告' },
  { key: 'listen', label: '聽自己', line: '回放原話，記「客戶當下怎麼回、我什麼語氣」' },
  { key: 'find', label: '找問題', line: '先誠實卡點；有效與否只有你自己最清楚' },
  { key: 'again', label: '再做', line: '只改一個動作，下一通驗證' },
];

/** 各模式在循環裡的定位 */
export const MODE_ROLES = {
  drill: {
    step: 'do',
    title: '臨場陪練 = 下水練',
    blurb: '像學游泳要喝過水：限時開口、被反駁、被掛斷——輸入代替不了這一段。',
    cta: '開始撥號',
  },
  log: {
    step: 'listen',
    title: '症狀紀錄 = 聽自己 + 量有在動',
    blurb: '漏斗證明有在打；批次分析找跨通病症；改善筆記是「找問題」的產出。',
    cta: '記錄今天',
  },
  dev: {
    step: 'find',
    title: '電訪分析 = 找問題、對原話',
    blurb: '規則報告是本機鏡子；三通自寫複盤完成後，AI 只做交叉對照，不代替你想。',
    cta: '上傳逐字稿',
  },
  demo: {
    step: 'listen',
    title: 'DEMO = 輸入 + 回放',
    blurb: '看錄影、轉逐字稿是輸入；要變強仍得回到自己打、自己講。',
    cta: '本機轉錄',
  },
  brief: {
    step: 'listen',
    stepLabel: '聽指示',
    title: '主管早會 = 聽指示、定方向',
    blurb: '按錄音即時轉文字，萃取重點、你確認後套用成專案方向——AI 分析與頁首都會跟著對齊。',
    cta: '開始錄音',
  },
};

export const PHILOSOPHY = {
  headline: '業績是做出來的，不是聽出來的',
  sub:
    '聽分享是輸入；真正變強是自己上場——講完才會遇到反駁與語氣。Call Coach 幫你「聽自己、找問題、再去做」，AI 是第二意見，不是代替記憶。',
  aiRole:
    '你是第二意見教練：先尊重業務自寫的複盤與當下判斷，用逐字稿或彙總交叉對照，指出一致與差異；不要給一份讓他背了就算的分析。',
  askBeforeAi: [
    '這通我自己做了什麼、客戶怎麼回？',
    '哪一句話可能讓客戶這樣反應？',
    '我覺得客戶當下在想什麼——依據是什麼？',
    '若結果不如預期，我先卡在哪（不是名單／產品）？',
  ],
};

/**
 * @returns {{ tone: 'ok'|'neutral'|'warn', text: string }}
 */
export function monthPaceMessage(date = new Date()) {
  const day = date.getDate();
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  if (day <= 10) {
    return {
      tone: 'ok',
      text: '月初（1～10 日）：把「做＋聽自己」跑起來，該抓的邀約先抓，別把整月押在最後一週。',
    };
  }
  if (day >= last - 6) {
    return {
      tone: 'warn',
      text: `月底（${last - 6}～${last} 日）：若現在才慌，代表節奏晚了——先聽今天最糟的一通，改一個動作，比盲目加通數有用。`,
    };
  }
  return {
    tone: 'neutral',
    text: '月中：量可以證明有在動，好不好只有你知道——今天有沒有「聽自己」並寫下要改的一件事？',
  };
}

export function renderCycleHtml({ compact = false } = {}) {
  const items = COACH_CYCLE.map(
    (s) =>
      `<li class="coach-cycle-item" data-step="${s.key}"><b>${s.label}</b>${compact ? '' : `<span>${s.line}</span>`}</li>`
  ).join('');
  return `<ol class="coach-cycle ${compact ? 'compact' : ''}">${items}</ol>`;
}

export function renderHomePhilosophyHtml() {
  return `
    <div class="coach-home card">
      <p class="coach-home-head">${PHILOSOPHY.headline}</p>
      <p class="hint coach-home-sub">${PHILOSOPHY.sub}</p>
      ${renderCycleHtml()}
      <p class="hint coach-home-map">五種模式對應循環：<b>陪練＝做</b> · <b>症狀＝聽自己</b> · <b>電訪＝找問題</b> · <b>DEMO＝輸入回放</b> · <b>早會＝聽指示定方向</b></p>
    </div>`;
}

export function renderHeroBarHtml(mode) {
  const role = MODE_ROLES[mode];
  if (!role) return '';
  const pace = monthPaceMessage();
  // 模式標題與 blurb 已在頁首 tagline 出現，這裡只留每月節奏提醒，避免重複
  return `
    <div class="coach-hero-bar coach-pace-${pace.tone}">
      <span class="coach-hero-mode">${role.stepLabel || (role.step === 'do' ? '做' : role.step === 'listen' ? '聽自己' : '找問題')}</span>
      <span class="coach-pace coach-pace-${pace.tone}">${pace.text}</span>
    </div>`;
}

export function renderMonthPaceHtml(date = new Date()) {
  const p = monthPaceMessage(date);
  return `<p class="coach-pace coach-pace-${p.tone} coach-pace-inline">${p.text}</p>`;
}

export function renderSelfAskBeforeAiHtml() {
  const lis = PHILOSOPHY.askBeforeAi.map((q) => `<li>${q}</li>`).join('');
  return `<ul class="coach-ask-ai hint">${lis}</ul>`;
}

/** 給 Gemini 類 prompt 的前置價值觀（短） */
export const AI_PHILOSOPHY_PREAMBLE = `[Call Coach 產品原則] ${PHILOSOPHY.aiRole} 鼓勵業務記住的是自己的推理過程，不是背你的摘要。\n\n`;
