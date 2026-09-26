/**
 * 每日三通「自寫複盤」——先自己思考，再解鎖 AI 單通分析。
 * 資料只存本機 localStorage。
 */

export const JOURNAL_STORAGE_KEY = 'call_coach_reflection_journal_v1';
export const REQUIRED_CALLS_PER_DAY = 3;

/** 各欄最少字元（避免空泛一句帶過） */
export const FIELD_MIN_LEN = 12;

export const JOURNAL_FIELD_LABELS = {
  iDid: '我做了什麼（含時間點或順序）',
  customerSaid: '客戶回應了什麼（盡量原話）',
  toneEffect: '我什麼樣的語氣／講法，可能讓客戶這樣回應',
  customerMind: '客戶當下可能在想什麼（推測＋理由）',
};

function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function loadRoot() {
  try {
    const raw = localStorage.getItem(JOURNAL_STORAGE_KEY);
    if (!raw) return { days: {} };
    const j = JSON.parse(raw);
    if (!j || typeof j !== 'object') return { days: {} };
    if (!j.days || typeof j.days !== 'object') return { days: {} };
    return j;
  } catch {
    return { days: {} };
  }
}

function saveRoot(root) {
  localStorage.setItem(JOURNAL_STORAGE_KEY, JSON.stringify(root));
}

export function normalizeSourceName(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 120);
}

export function emptyEntry(slot = 0) {
  return {
    slot,
    callTitle: '',
    linkedSource: '',
    iDid: '',
    customerSaid: '',
    toneEffect: '',
    customerMind: '',
    updatedAt: 0,
  };
}

export function getDayJournal(dateKey = todayKey()) {
  const root = loadRoot();
  const day = root.days[dateKey];
  if (!day?.entries?.length) {
    return {
      dateKey,
      entries: [0, 1, 2].map((i) => emptyEntry(i)),
      updatedAt: 0,
    };
  }
  const entries = [0, 1, 2].map((i) => {
    const e = day.entries.find((x) => x.slot === i) || day.entries[i];
    return { ...emptyEntry(i), ...e, slot: i };
  });
  return { dateKey, entries, updatedAt: day.updatedAt || 0 };
}

export function saveDayJournal(dateKey, entries) {
  const root = loadRoot();
  const cleaned = entries.slice(0, REQUIRED_CALLS_PER_DAY).map((e, i) => ({
    slot: i,
    callTitle: String(e.callTitle || '').trim(),
    linkedSource: normalizeSourceName(e.linkedSource),
    iDid: String(e.iDid || '').trim(),
    customerSaid: String(e.customerSaid || '').trim(),
    toneEffect: String(e.toneEffect || '').trim(),
    customerMind: String(e.customerMind || '').trim(),
    updatedAt: Date.now(),
  }));
  root.days[dateKey] = { entries: cleaned, updatedAt: Date.now() };
  saveRoot(root);
  return getDayJournal(dateKey);
}

export function fieldComplete(value) {
  return String(value || '').trim().length >= FIELD_MIN_LEN;
}

export function isEntryComplete(entry) {
  if (!entry) return false;
  return (
    fieldComplete(entry.iDid) &&
    fieldComplete(entry.customerSaid) &&
    fieldComplete(entry.toneEffect) &&
    fieldComplete(entry.customerMind)
  );
}

export function countCompleteEntries(dayJournal) {
  return (dayJournal?.entries || []).filter(isEntryComplete).length;
}

export function isAiAnalysisUnlocked(dateKey = todayKey()) {
  const day = getDayJournal(dateKey);
  return countCompleteEntries(day) >= REQUIRED_CALLS_PER_DAY;
}

export function unlockStatusMessage(dateKey = todayKey()) {
  const day = getDayJournal(dateKey);
  const n = countCompleteEntries(day);
  if (n >= REQUIRED_CALLS_PER_DAY) {
    return { unlocked: true, complete: n, required: REQUIRED_CALLS_PER_DAY, message: '今日三通自寫複盤已完成，可進行 AI 單通分析。' };
  }
  return {
    unlocked: false,
    complete: n,
    required: REQUIRED_CALLS_PER_DAY,
    message: `請先完成今日 ${REQUIRED_CALLS_PER_DAY} 通自寫複盤（目前 ${n}/${REQUIRED_CALLS_PER_DAY}）。主管要求：開發分析必須先自己思考，AI 只做交叉對照，不能代替你想。`,
  };
}

/** 依檔名／標題找今日最相近的一筆複盤 */
export function findEntryForSource(dayJournal, sourceName) {
  const src = normalizeSourceName(sourceName);
  if (!src) return null;
  const entries = (dayJournal?.entries || []).filter(isEntryComplete);
  const exact = entries.find((e) => e.linkedSource && e.linkedSource === src);
  if (exact) return exact;
  const title = entries.find((e) => e.callTitle && (src.includes(e.callTitle) || e.callTitle.includes(src)));
  if (title) return title;
  return null;
}

export function formatEntryForPrompt(entry) {
  if (!entry) return '';
  const head = entry.callTitle || entry.linkedSource || '（未命名通話）';
  return [
    `通話：${head}`,
    `1. 我做了什麼：${entry.iDid}`,
    `2. 客戶回應了什麼：${entry.customerSaid}`,
    `3. 語氣／講法與客戶反應：${entry.toneEffect}`,
    `4. 客戶當下可能在想：${entry.customerMind}`,
  ].join('\n');
}

export const REFLECTION_CROSSCHECK_INSTRUCTION = `

【業務先寫的複盤（優先尊重；你的任務是交叉對照，不是重寫一份給他抄）】
{{USER_REFLECTION}}

請在 JSON 最外層多加 reflection_crosscheck（繁體中文）：
"reflection_crosscheck":{
  "agree":["與業務自寫一致、且逐字稿也支持的觀點（1-4條）"],
  "gaps":[{"area":"主題","yours":"業務寫的","ai_view":"依逐字稿你看到的","coach_tip":"一句可執行的修正"}],
  "tone_check":"業務對「語氣→客戶反應」的推測是否站得住腳",
  "customer_mind_check":"業務對客戶內心的推測 vs 你從對話讀到的",
  "remember":"提醒：過幾小時他應記得的是自己的推理，不是背你的摘要"
}
若未提供業務複盤則 reflection_crosscheck 可省略。`;

export function appendReflectionToPrompt(basePrompt, userReflectionText) {
  const block = String(userReflectionText || '').trim();
  if (!block) return basePrompt;
  return basePrompt + REFLECTION_CROSSCHECK_INSTRUCTION.replace('{{USER_REFLECTION}}', block);
}

export function renderReflectionCrosscheckHtml(xc) {
  if (!xc || typeof xc !== 'object') return '';
  const agree = (xc.agree || []).map((s) => `<li>${escape(s)}</li>`).join('');
  const gaps = (xc.gaps || [])
    .map(
      (g) =>
        `<li><b>${escape(g.area || '差異')}</b>：你寫「${escape(g.yours || '')}」→ AI 看「${escape(g.ai_view || '')}」<span class="hint">｜${escape(g.coach_tip || '')}</span></li>`
    )
    .join('');
  const remember = xc.remember ? `<p class="hint">${escape(xc.remember)}</p>` : '';
  return `
    <div class="reflection-crosscheck card" style="margin-top:16px;padding:14px;border:1px solid var(--line)">
      <h3 style="margin:0 0 10px;font-family:var(--disp)">自寫複盤 × AI 交叉對照</h3>
      ${agree ? `<p><b>與你一致</b></p><ul class="report">${agree}</ul>` : ''}
      ${gaps ? `<p><b>值得再想的差異</b></p><ul class="report">${gaps}</ul>` : ''}
      ${xc.tone_check ? `<p><b>語氣推測</b>：${escape(xc.tone_check)}</p>` : ''}
      ${xc.customer_mind_check ? `<p><b>客戶心思</b>：${escape(xc.customer_mind_check)}</p>` : ''}
      ${remember}
    </div>`;
}

function escape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
