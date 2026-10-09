/**
 * 電訪開發 · 臨場反應陪練（UI）。
 * 業務主動提問、限時接話；客戶由劇本（離線）或 Gemini（改寫語氣）扮演。
 * 通話中刻意不給任何提示——回饋全部留到結束後。
 */
import {
  BAD_FLAGS,
  buildCoaching,
  buildCustomerPrompt,
  DIFFICULTIES,
  endSession,
  FIT_LABELS,
  FLAG_LABELS,
  judgeQuiz,
  newSession,
  overrideReplyText,
  respond,
  sessionStats,
  sessionToSrt,
  sessionToText,
  startSession,
  TIER_LABELS,
  TIME_LIMITS,
  timeoutTurn,
  DRILL_TRACKS,
} from './drill-engine.js';
import { DRILL_FOCUSES, evaluateFocus, getFocus, pickDrillFocus, RECENT_SYMPTOM_DAYS } from './drill-focus.js';
import { appendDrillLog, drillLogEntry, loadDrillLog, summarizeDrills } from './drill-log.js';
import { DRILL_PERSONAS, getPersona, randomPersona } from './drill-personas.js';
import { dateKey, shiftDateKey } from './symptom-engine.js';
import { callGemini, DEFAULT_MODEL } from './gemini.js';
import { PURPOSE_TYPES } from './purpose-types.js';
import { $, escapeHTML, renderReportList } from './utils.js';

const PREFS_KEY = 'callCoachDrillPrefs';
const DEFAULT_PREFS = { personaKey: 'random', limitSec: 30, difficulty: 'normal', engine: 'script', track: 'icebreak', tts: false, mic: false, focus: '' };
const END_LABELS = {
  manual: '你結束了通話',
  hangup: '客戶掛電話了',
  closed: '客戶答應下一步',
  maxTurns: '達到最大句數',
  icebreakWin: '破冰成功——客戶願意多聊',
  icebreakTime: '破冰回合結束',
};

let deps = {};
let session = null;
let prefs = loadPrefs();
let timerId = null;
let deadline = 0;
let promptShownAt = 0;
let busy = false;
let recognizer = null;
let aiWarned = false;
let quizAnswer = { tier: null, fit: null };
let recentPick = undefined;
let recentLoading = false;

function loadPrefs() {
  try {
    const p = { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
    if (!getFocus(p.focus)) p.focus = '';
    return p;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs() {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

function panel() {
  return $('drillPanel');
}

function speechSupported() {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function ttsSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/* ------------------------------------------------------------------ */
/* Setup                                                                */
/* ------------------------------------------------------------------ */

function renderSetup() {
  stopTimer();
  stopMic();
  const hasKey = !!deps.getApiKey?.();
  const personaCards = [
    `<label class="drill-persona ${prefs.personaKey === 'random' ? 'on' : ''}">
      <input type="radio" name="drillPersona" value="random" ${prefs.personaKey === 'random' ? 'checked' : ''}>
      <span><b>盲抽</b><small>不知道誰會接電話——跟真實回撥一樣，邊聊邊判斷</small></span></label>`,
    ...DRILL_PERSONAS.map(
      (p) => `<label class="drill-persona ${prefs.personaKey === p.key ? 'on' : ''}">
      <input type="radio" name="drillPersona" value="${p.key}" ${prefs.personaKey === p.key ? 'checked' : ''}>
      <span><b>${escapeHTML(p.name)}</b><small>${escapeHTML(p.brief)}</small></span></label>`
    ),
  ].join('');
  const radios = (name, items, cur) =>
    items
      .map(
        (it) => `<label class="drill-opt ${String(cur) === String(it.value) ? 'on' : ''}"><input type="radio" name="${name}" value="${it.value}" ${String(cur) === String(it.value) ? 'checked' : ''}><span>${it.label}${it.desc ? `<small>${it.desc}</small>` : ''}</span></label>`
      )
      .join('');

  const trackRadios = Object.values(DRILL_TRACKS)
    .map(
      (t) =>
        `<label class="drill-opt ${prefs.track === t.key ? 'on' : ''}"><input type="radio" name="drillTrack" value="${t.key}" ${prefs.track === t.key ? 'checked' : ''}><span><b>${t.label}</b><small>${t.desc}</small></span></label>`
    )
    .join('');

  panel().innerHTML = `
  <div class="card drill-focus-card" id="drillFocusCard"></div>
  <div class="card drill-setup">
    <div class="drill-setup-grid">
      <div class="drill-track-block">
        <h3 class="drill-h">0 · 練什麼</h3>
        <div class="drill-opts drill-tracks">${trackRadios}</div>
      </div>
      <div>
        <h3 class="drill-h">1 · 誰會接電話</h3>
        <div class="drill-personas">${personaCards}</div>
        <p class="hint" style="margin-top:8px">你只看得到名單上的資料。客戶學 AI 的目的分級、真正的狀況，都要靠你問出來。</p>
      </div>
      <div>
        <h3 class="drill-h">2 · 每句限時</h3>
        <div class="drill-opts">${radios('drillLimit', TIME_LIMITS.map((s) => ({ value: s, label: `${s} 秒` })), prefs.limitSec)}</div>
        <h3 class="drill-h drill-diff-h">3 · 突襲頻率</h3>
        <div class="drill-opts drill-diff-opts">${radios('drillDiff', Object.values(DIFFICULTIES).map((d) => ({ value: d.key, label: d.label, desc: d.desc })), prefs.difficulty)}</div>
        <h3 class="drill-h">4 · 客戶由誰扮演</h3>
        <div class="drill-opts">${radios(
          'drillEngine',
          [
            { value: 'script', label: '離線劇本', desc: '不需要網路與 Key，回答固定但判定完整' },
            { value: 'ai', label: 'Gemini AI 客戶', desc: '同一套劇本，由 AI 改寫成更像真人的口吻' },
          ],
          prefs.engine
        )}</div>
        <div id="drillKeyRow" class="drill-key" ${prefs.engine === 'ai' && !hasKey ? '' : 'hidden'}>
          <input type="password" id="drillApiKey" class="field" placeholder="貼上 Gemini API Key（與下方 AI 深度分析共用）" autocomplete="off">
          <span class="hint">陪練對話是虛構劇本，不含真實客戶資料；仍會傳送到 Google。</span>
        </div>
        <h3 class="drill-h">5 · 語音（選用）</h3>
        <div class="drill-opts drill-checks">
          <label class="drill-opt ${prefs.tts ? 'on' : ''} ${ttsSupported() ? '' : 'off'}"><input type="checkbox" id="drillTts" ${prefs.tts ? 'checked' : ''} ${ttsSupported() ? '' : 'disabled'}><span>客戶台詞用語音唸出<small>${ttsSupported() ? '更像電話，計時從唸完才開始' : '此瀏覽器不支援'}</small></span></label>
          <label class="drill-opt ${prefs.mic ? 'on' : ''} ${speechSupported() ? '' : 'off'}"><input type="checkbox" id="drillMicOpt" ${prefs.mic ? 'checked' : ''} ${speechSupported() ? '' : 'disabled'}><span>用麥克風講話回答<small>${speechSupported() ? '講完自動送出（Chrome / Edge）' : '此瀏覽器不支援'}</small></span></label>
        </div>
      </div>
    </div>
    <div class="row drill-start-row">
      <button class="primary" id="drillStart" type="button">開始撥號 →</button>
      <span class="hint">撥出後不會有任何提示，跟真的電話一樣。所有回饋在掛電話後才看。</span>
    </div>
  </div>
    <div class="hint"><b>業績是做出來的</b>——陪練是「下水」：通話中<b>看不到逐字稿</b>，結束後才回放。練<b>不慌、不亂套、不卡住</b>；聽分享是輸入，這裡才是輸出。建議開啟客戶語音。</div>`;

  const root = panel();
  root.querySelectorAll('input[name="drillPersona"]').forEach((r) => {
    r.onchange = () => {
      prefs.personaKey = r.value;
      savePrefs();
      root.querySelectorAll('.drill-persona').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
    };
  });
  const bindOpt = (name, key, cast = (v) => v) => {
    root.querySelectorAll(`input[name="${name}"]`).forEach((r) => {
      r.onchange = () => {
        prefs[key] = cast(r.value);
        savePrefs();
        root.querySelectorAll(`input[name="${name}"]`).forEach((x) => x.closest('.drill-opt').classList.toggle('on', x.checked));
        if (name === 'drillEngine') $('drillKeyRow').hidden = !(prefs.engine === 'ai' && !deps.getApiKey?.());
      };
    });
  };
  bindOpt('drillLimit', 'limitSec', Number);
  bindOpt('drillDiff', 'difficulty');
  bindOpt('drillEngine', 'engine');
  bindOpt('drillTrack', 'track');
  root.querySelectorAll('input[name="drillTrack"]').forEach((r) => {
    r.addEventListener('change', () => {
      const f = getFocus(prefs.focus);
      if (f && f.track !== prefs.track) {
        prefs.focus = '';
        savePrefs();
        renderFocusCard();
      }
    });
  });
  const syncTrackUi = () => {
    const ice = prefs.track === 'icebreak';
    root.querySelector('.drill-diff-h')?.classList.toggle('muted', ice);
    root.querySelector('.drill-diff-opts')?.classList.toggle('muted', ice);
  };
  syncTrackUi();
  root.querySelectorAll('input[name="drillTrack"]').forEach((r) => {
    r.addEventListener('change', syncTrackUi);
  });
  $('drillTts').onchange = (e) => {
    prefs.tts = e.target.checked;
    savePrefs();
    e.target.closest('.drill-opt').classList.toggle('on', prefs.tts);
  };
  $('drillMicOpt').onchange = (e) => {
    prefs.mic = e.target.checked;
    savePrefs();
    e.target.closest('.drill-opt').classList.toggle('on', prefs.mic);
  };
  $('drillApiKey').onchange = (e) => {
    const v = e.target.value.trim();
    if (v) deps.setApiKey?.(v);
  };
  $('drillStart').onclick = startDrill;
  renderFocusCard();
  if (recentPick === undefined) loadRecentPick();
}

async function loadRecentPick() {
  recentPick = null;
  recentLoading = true;
  renderFocusCard();
  try {
    const agg = await deps.loadRecentSymptoms?.();
    recentPick = pickDrillFocus(agg);
  } catch (e) {
    console.warn('recent symptoms unavailable', e);
  }
  recentLoading = false;
  renderFocusCard();
}

function practiceLine() {
  const today = dateKey();
  const week = summarizeDrills(loadDrillLog(), shiftDateKey(today, -6), today);
  if (!week.count) return '最近 7 天還沒有陪練紀錄——每練完一次，分數會記在這裡並帶進每月總結。';
  return `最近 7 天陪練 <b>${week.count}</b> 次（${week.days} 天）· 平均 <b>${week.avgScore}</b> 分${week.focusCount ? ` · 重點達成 ${week.focusMet}/${week.focusCount}` : ''}`;
}

function renderFocusCard() {
  const el = $('drillFocusCard');
  if (!el) return;
  const active = getFocus(prefs.focus);
  const pick = recentPick;
  let body;
  if (active) {
    const fromPick = pick?.focus.key === active.key;
    body = `<p class="drill-focus-kicker">本次重點${fromPick ? ' · 來自症狀紀錄' : ''}</p>
      <p class="drill-focus-title"><b>${escapeHTML(active.label)}</b>——${escapeHTML(active.goal)}</p>
      <p class="hint">${escapeHTML(active.tip)}</p>
      <div class="row"><button type="button" id="drillFocusClear">取消重點</button></div>`;
  } else if (pick) {
    const top = pick.symptoms[0];
    const others = pick.symptoms.slice(1, 3).map((s) => `${escapeHTML(s.label)} ${s.count} 通`).join('、');
    body = `<p class="drill-focus-kicker">最近 ${RECENT_SYMPTOM_DAYS} 天症狀紀錄 · 已分析 ${pick.total} 通</p>
      <p class="drill-focus-title">最常見弱點：<b>${escapeHTML(top.label)}</b>（${top.count}/${pick.total} 通）${others ? `<small>，還有 ${others}</small>` : ''}</p>
      <p class="hint">建議這次只練「${escapeHTML(pick.focus.label)}」：${escapeHTML(pick.focus.goal)}</p>
      <div class="row"><button type="button" class="primary" id="drillFocusUse" data-focus="${pick.focus.key}">用這個弱點練 →</button></div>`;
  } else {
    body = `<p class="drill-focus-kicker">陪練重點</p>
      <p class="hint">${
        recentLoading
          ? '正在讀取症狀紀錄…'
          : `症狀紀錄最近 ${RECENT_SYMPTOM_DAYS} 天還沒有分析過的通話——批次分析後，這裡會自動挑出你最常見的弱點來練。`
      }</p>`;
  }
  const options = Object.values(DRILL_FOCUSES)
    .map((f) => `<option value="${f.key}" ${f.key === prefs.focus ? 'selected' : ''}>${escapeHTML(f.label)}</option>`)
    .join('');
  el.innerHTML = `${body}
    <div class="drill-focus-foot">
      <label class="hint">或自己選重點 <select id="drillFocusSel"><option value="">不設重點</option>${options}</select></label>
      <span class="hint drill-focus-stats">${practiceLine()}</span>
    </div>`;
  const use = $('drillFocusUse');
  if (use) use.onclick = () => applyFocus(use.dataset.focus);
  const clear = $('drillFocusClear');
  if (clear) clear.onclick = () => applyFocus('');
  $('drillFocusSel').onchange = (e) => applyFocus(e.target.value);
}

function applyFocus(key) {
  const f = getFocus(key);
  prefs.focus = f ? f.key : '';
  if (f) prefs.track = f.track;
  savePrefs();
  if (!session || session.ended) renderSetup();
}

/** 從其他模式（症狀紀錄）指定陪練重點；通話中不打斷 */
export function setDrillFocus(key) {
  const f = getFocus(key);
  if (!f) return null;
  if (session && !session.ended) {
    prefs.focus = f.key;
    prefs.track = f.track;
    savePrefs();
    return f;
  }
  session = null;
  recentPick = undefined;
  applyFocus(f.key);
  return f;
}

/* ------------------------------------------------------------------ */
/* Live call                                                            */
/* ------------------------------------------------------------------ */

function startDrill() {
  if (prefs.engine === 'ai') {
    const pending = $('drillApiKey')?.value.trim();
    if (pending) deps.setApiKey?.(pending);
    if (!deps.getApiKey?.()) {
      deps.showToast?.('AI 客戶需要 Gemini API Key，先貼上或改用離線劇本');
      $('drillKeyRow').hidden = false;
      return;
    }
  }
  const persona = prefs.personaKey === 'random' ? randomPersona() : getPersona(prefs.personaKey) || randomPersona();
  session = newSession({
    persona,
    track: prefs.track || 'full',
    difficulty: prefs.difficulty,
    limitSec: prefs.limitSec,
    engine: prefs.engine,
  });
  const focus = getFocus(prefs.focus);
  session.focus = focus && focus.track === session.track ? focus.key : '';
  quizAnswer = { tier: null, fit: null };
  aiWarned = false;
  renderLive();
  const { replies } = startSession(session);
  deliverReplies(replies, null).then(() => {
    if (!session.ended) startTimer();
  });
}

function renderLive() {
  const p = session.persona;
  panel().innerHTML = `
  <div class="card drill-live">
    <div class="drill-live-head">
      <div class="drill-caller"><span class="drill-live-dot"></span>通話中 · <b>${escapeHTML(p.name)}</b><small>${escapeHTML(p.brief)}</small></div>
      <div class="drill-timer"><span id="drillTimerNum">${session.limitSec}</span><span class="drill-timer-unit">秒</span></div>
    </div>
    <div class="drill-timer-track"><div id="drillTimerBar" style="width:100%"></div></div>
    <div class="drill-mood"><span>客戶耐心</span><div class="drill-mood-track"><div id="drillMoodBar"></div></div><span id="drillMoodNum" class="mono"></span></div>
    <div id="drillLog" class="drill-log drill-live-blind" aria-live="off"></div>
    <div class="drill-input">
      <textarea id="drillInput" rows="2" placeholder="你要說什麼？Enter 送出，Shift+Enter 換行" autocomplete="off"></textarea>
      <div class="drill-input-btns">
        <button id="drillMic" type="button" ${prefs.mic && speechSupported() ? '' : 'hidden'}>🎙 說話</button>
        <button class="primary" id="drillSend" type="button">送出</button>
        <button id="drillEnd" type="button">結束通話</button>
      </div>
    </div>
    <div class="hint drill-live-hint">第 <b id="drillTurnNum">0</b> 句 · <b>通話中看不到逐字稿</b>（結束後才回放）· 建議開啟「客戶台詞用語音唸出」或戴耳機 · 連續兩次沒接上會被掛電話</div>
  </div>`;
  updateMood();
  const input = $('drillInput');
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit(input.value);
    }
  };
  $('drillSend').onclick = () => submit(input.value);
  $('drillEnd').onclick = () => {
    if (busy || !session || session.ended) return;
    stopTimer();
    stopMic();
    endSession(session, 'manual');
    renderQuiz();
  };
  const mic = $('drillMic');
  if (mic) mic.onclick = () => (recognizer ? stopMic() : startMic());
  setTimeout(() => input.focus(), 50);
}

const LIVE_CUE = {
  situation: '🔊 客戶（情境干擾）…',
  hangup: '客戶已掛電話',
  objection: '🔊 客戶突襲…',
  pressure: '🔊 客戶在等你的回應…',
  pushback: '🔊 客戶語氣轉硬…',
  default: '🔊 客戶正在說話…',
};

function liveCueFor(who, { blank = false, kind = '' } = {}) {
  if (who === 'S') return blank ? '（限時內沒接上話）' : '✓ 已送出你的回應';
  if (kind === 'hangup') return LIVE_CUE.hangup;
  return LIVE_CUE[kind] || LIVE_CUE.default;
}

/** 通話進行中不顯示逐字稿，只留聲音提示；完整文字在 session.turns，結束後回放。 */
function appendBubble(who, text, { blank = false, kind = '' } = {}) {
  const log = $('drillLog');
  if (!log) return;
  const div = document.createElement('div');
  div.className = `drill-msg ${who === 'S' ? 's' : 'c'}${blank ? ' blank' : ''}${kind ? ` k-${kind}` : ''}`;
  const cue = liveCueFor(who, { blank, kind });
  div.innerHTML = `<span class="drill-who">${who === 'S' ? '你' : '客戶'}</span><div class="drill-text drill-audio-cue">${escapeHTML(cue)}</div>`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function updateMood() {
  const bar = $('drillMoodBar');
  if (!bar || !session) return;
  const m = session.mood;
  bar.style.width = `${m}%`;
  bar.className = m >= 60 ? 'ok' : m >= 30 ? 'warn' : 'bad';
  $('drillMoodNum').textContent = `${m}`;
}

function setInputEnabled(on) {
  const input = $('drillInput');
  if (!input) return;
  input.disabled = !on;
  $('drillSend').disabled = !on;
  if (on) input.focus();
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function speak(text) {
  return new Promise((resolve) => {
    if (!prefs.tts || !ttsSupported()) return resolve();
    const clean = String(text).replace(/[（(][^）)]*[）)]/g, '').trim();
    if (!clean || /^[…。.、\s]+$/.test(clean)) return resolve();
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'zh-TW';
    u.rate = 1.05;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      resolve();
    };
    const guard = setTimeout(finish, Math.min(12000, 1500 + clean.length * 260));
    u.onend = finish;
    u.onerror = finish;
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      finish();
    }
  });
}

async function rewordWithAI(classification, reply) {
  const apiKey = deps.getApiKey?.();
  if (!apiKey) return null;
  const model = deps.getModel?.() || DEFAULT_MODEL;
  try {
    const { parsed, usedTokens } = await callGemini({
      apiKey,
      model,
      text: buildCustomerPrompt(session, classification, reply),
    });
    deps.onGeminiUsed?.(usedTokens);
    const line = typeof parsed?.reply === 'string' ? parsed.reply.trim() : '';
    return line && line.length <= 120 ? line : null;
  } catch (e) {
    if (!aiWarned) {
      aiWarned = true;
      deps.showToast?.(`AI 客戶暫時無法回應（${e.message?.slice(0, 40) || '錯誤'}），改用劇本台詞`);
    }
    return null;
  }
}

async function deliverReplies(replies, classification) {
  for (const rep of replies) {
    let text = rep.text;
    if (session.engine === 'ai' && rep.reword && classification) {
      const alt = await rewordWithAI(classification, rep);
      if (alt) {
        text = alt;
        overrideReplyText(rep.turn, alt);
      }
    } else {
      await wait(rep.kind === 'objection' ? 900 : 450);
    }
    appendBubble('C', text, { kind: rep.kind });
    await speak(text);
  }
  promptShownAt = performance.now();
}

async function submit(raw) {
  const text = String(raw || '').trim();
  if (busy || !session || session.ended || !text) return;
  busy = true;
  stopTimer();
  const reactionMs = Math.max(0, Math.round(performance.now() - promptShownAt));
  $('drillInput').value = '';
  setInputEnabled(false);
  appendBubble('S', text);
  const r = respond(session, text, reactionMs);
  $('drillTurnNum').textContent = session.salesTurns;
  await deliverReplies(r.replies, r.classification);
  updateMood();
  busy = false;
  if (session.ended) {
    stopMic();
    await wait(600);
    renderQuiz();
    return;
  }
  setInputEnabled(true);
  startTimer();
}

async function onTimeout() {
  if (busy || !session || session.ended) return;
  busy = true;
  stopTimer();
  setInputEnabled(false);
  appendBubble('S', '（沒接上話）', { blank: true });
  const r = timeoutTurn(session);
  await deliverReplies(r.replies, null);
  updateMood();
  busy = false;
  if (session.ended) {
    stopMic();
    await wait(600);
    renderQuiz();
    return;
  }
  setInputEnabled(true);
  startTimer();
}

function startTimer() {
  stopTimer();
  deadline = performance.now() + session.limitSec * 1000;
  promptShownAt = performance.now();
  tick();
  timerId = setInterval(tick, 100);
}

function tick() {
  const num = $('drillTimerNum');
  const bar = $('drillTimerBar');
  if (!num || !bar || !session) return stopTimer();
  const left = Math.max(0, deadline - performance.now());
  const secs = Math.ceil(left / 1000);
  num.textContent = secs;
  const pct = (left / (session.limitSec * 1000)) * 100;
  bar.style.width = `${pct}%`;
  bar.className = secs <= 5 ? 'bad' : secs <= 10 ? 'warn' : '';
  num.parentElement.classList.toggle('urgent', secs <= 5);
  if (left <= 0) {
    stopTimer();
    onTimeout();
  }
}

function stopTimer() {
  if (timerId) clearInterval(timerId);
  timerId = null;
}

function startMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || recognizer) return;
  const rec = new SR();
  rec.lang = 'zh-TW';
  rec.interimResults = true;
  rec.continuous = false;
  const btn = $('drillMic');
  rec.onresult = (e) => {
    let finalText = '';
    let interim = '';
    for (const res of e.results) {
      if (res.isFinal) finalText += res[0].transcript;
      else interim += res[0].transcript;
    }
    const input = $('drillInput');
    if (input) input.value = finalText || interim;
    if (finalText) submit(finalText);
  };
  rec.onerror = () => stopMic();
  rec.onend = () => {
    recognizer = null;
    btn?.classList.remove('on');
    if (btn) btn.textContent = '🎙 說話';
  };
  recognizer = rec;
  btn?.classList.add('on');
  if (btn) btn.textContent = '● 聆聽中…點一下停止';
  try {
    rec.start();
  } catch {
    stopMic();
  }
}

function stopMic() {
  if (!recognizer) return;
  try {
    recognizer.stop();
  } catch {
    /* ignore */
  }
  recognizer = null;
  const btn = $('drillMic');
  if (btn) {
    btn.classList.remove('on');
    btn.textContent = '🎙 說話';
  }
}

/* ------------------------------------------------------------------ */
/* Quiz + debrief                                                       */
/* ------------------------------------------------------------------ */

function renderQuiz() {
  stopTimer();
  stopMic();
  if (ttsSupported()) window.speechSynthesis.cancel();
  if (session.track === 'icebreak') {
    renderDebrief(null);
    return;
  }
  const reason = END_LABELS[session.endReason] || '通話結束';
  panel().innerHTML = `
  <div class="card drill-quiz">
    <p class="drill-quiz-kicker">${escapeHTML(reason)} · 共 ${session.salesTurns} 句</p>
    <h3 class="drill-h">先憑印象判斷，再看回饋</h3>
    <p class="drill-quiz-q">客戶學 AI 的目的，你判斷是哪一級？</p>
    <div class="drill-choices" data-q="tier">
      ${PURPOSE_TYPES.map((t) => `<button type="button" data-v="${t.key}">${t.label}<small>${escapeHTML(t.purpose)}</small></button>`).join('')}
    </div>
    <p class="drill-quiz-q">適配判斷？</p>
    <div class="drill-choices" data-q="fit">
      ${Object.entries(FIT_LABELS).map(([k, v]) => `<button type="button" data-v="${k}">${v}</button>`).join('')}
    </div>
    <div class="row" style="margin-top:14px">
      <button class="primary" id="drillReveal" type="button" disabled>看回饋 →</button>
      <button id="drillSkipQuiz" type="button">跳過判斷</button>
    </div>
  </div>`;
  panel()
    .querySelectorAll('.drill-choices button')
    .forEach((btn) => {
      btn.onclick = () => {
        const q = btn.closest('.drill-choices').dataset.q;
        quizAnswer[q] = btn.dataset.v;
        btn.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
        $('drillReveal').disabled = !(quizAnswer.tier && quizAnswer.fit);
      };
    });
  $('drillReveal').onclick = () => renderDebrief(judgeQuiz(session, quizAnswer));
  $('drillSkipQuiz').onclick = () => renderDebrief(null);
}

function flagBadges(flags = []) {
  return flags
    .filter((f) => FLAG_LABELS[f])
    .map((f) => `<span class="drill-flag ${BAD_FLAGS.has(f) ? 'bad' : 'good'}">${FLAG_LABELS[f]}</span>`)
    .join('');
}

const C_KIND_LABEL = { objection: '突襲', pressure: '催促', hangup: '掛電話', pushback: '打回', deflect: '帶開', repeat: '不耐', vague: '敷衍', situation: '情境' };

function renderDebrief(quiz) {
  const stats = sessionStats(session);
  const coaching = buildCoaching(session, stats, quiz);
  const p = session.persona;
  const trackLabel = DRILL_TRACKS[session.track]?.label || '完整通話';
  const scoreColor = stats.score >= 80 ? 'var(--ok)' : stats.score >= 60 ? 'var(--warn)' : 'var(--bad)';
  const avg = stats.salesLines ? `${(stats.avgReactionMs / 1000).toFixed(1)}s` : '—';
  const focusRes = evaluateFocus(session.focus, stats, quiz);
  if (!session.logged) {
    session.logged = true;
    appendDrillLog(drillLogEntry({ session, stats, focus: focusRes }));
  }
  const today = dateKey();
  const month = summarizeDrills(loadDrillLog(), `${today.slice(0, 7)}-01`, today);
  const focusHtml = focusRes
    ? `<div class="card drill-focus-result ${focusRes.met ? 'ok' : 'bad'}">
        <span class="drill-flag ${focusRes.met ? 'good' : 'bad'}">${focusRes.met ? '重點達成' : '重點還沒做到'}</span>
        <b>本次重點 · ${escapeHTML(focusRes.label)}</b>
        <span class="hint">${escapeHTML(focusRes.goal)}——${escapeHTML(focusRes.detail)}</span>
      </div>`
    : '';
  const timeline = session.turns
    .map((t) => {
      if (t.who === 'S') {
        const blank = t.kind === 'blank';
        return `<div class="drill-msg s${blank ? ' blank' : ''}"><span class="drill-who">你${t.reactionMs != null && !blank ? `<em>${(t.reactionMs / 1000).toFixed(1)}s</em>` : ''}</span><div class="drill-text">${blank ? '（沒接上話）' : escapeHTML(t.text)}<div class="drill-flags">${flagBadges(t.flags)}</div></div></div>`;
      }
      const tag = C_KIND_LABEL[t.kind] ? `<span class="drill-flag c">${C_KIND_LABEL[t.kind]}</span>` : '';
      return `<div class="drill-msg c k-${t.kind}"><span class="drill-who">客戶</span><div class="drill-text">${escapeHTML(t.text)}${tag ? `<div class="drill-flags">${tag}</div>` : ''}</div></div>`;
    })
    .join('');
  const quizHtml = quiz
    ? `<p><b>你的判斷：</b>${quiz.tierAnswer ? TIER_LABELS[quiz.tierAnswer] : '—'} ／ ${quiz.fitAnswer ? FIT_LABELS[quiz.fitAnswer] : '—'}
       <span class="drill-flag ${quiz.tierCorrect ? 'good' : 'bad'}">分級${quiz.tierCorrect ? '正確' : '錯誤'}</span>
       <span class="drill-flag ${quiz.fitCorrect ? 'good' : 'bad'}">適配${quiz.fitCorrect ? '正確' : '不同'}</span></p>`
    : '<p class="hint" style="margin:0">（跳過了判斷）</p>';

  panel().innerHTML = `
  <div class="drill-debrief">
    <div class="stats drill-stats">
      <div class="stat"><div class="num" style="color:${scoreColor}">${stats.score}</div><div class="lbl">臨場分數 · ${stats.verdict}</div></div>
      <div class="stat"><div class="num">${avg}</div><div class="lbl">平均反應</div></div>
      <div class="stat"><div class="num" style="color:${stats.timeouts ? 'var(--bad)' : 'var(--ok)'}">${stats.timeouts}</div><div class="lbl">卡住次數</div></div>
      <div class="stat"><div class="num" style="color:${stats.canned + stats.fear + stats.tooEarly ? 'var(--bad)' : 'var(--ok)'}">${stats.canned + stats.fear + stats.tooEarly}</div><div class="lbl">套話／恐嚇／太早推</div></div>
      <div class="stat"><div class="num">${stats.objectionsHandled}／${stats.objectionsThrown}</div><div class="lbl">突襲接住</div></div>
      <div class="stat"><div class="num">${stats.generalLayers}＋${stats.tierLayers}</div><div class="lbl">一般層＋分級層</div></div>
    </div>
    <p class="hint drill-track-badge">模式：${escapeHTML(trackLabel)} · 本月第 ${month.count} 次陪練，平均 ${month.avgScore ?? '—'} 分（已記入每月總結）</p>
    ${focusHtml}
    <div class="card drill-reveal">
      <h3 class="drill-h">劇本揭曉：${escapeHTML(p.name)}</h3>
      <p><b>隱藏分級：</b>${TIER_LABELS[p.tier]}（${escapeHTML(PURPOSE_TYPES.find((t) => t.key === p.tier)?.aiPurpose || '')}）</p>
      <p><b>劇本適配：</b>${FIT_LABELS[p.fit]} — ${escapeHTML(p.fitReason)}</p>
      ${quizHtml}
    </div>
    <div class="drill-coach">
      <div class="card"><h3 class="drill-h ok">做得好</h3><ul class="report" id="drillGood"></ul></div>
      <div class="card"><h3 class="drill-h bad">待加強</h3><ul class="report" id="drillBad"></ul></div>
    </div>
    <div class="card">
      <h3 class="drill-h">逐句回放<small class="drill-h-sub">每句的反應秒數與判定</small></h3>
      <div class="drill-log drill-log-replay">${timeline}</div>
    </div>
    <div class="row drill-debrief-actions">
      <button class="primary" id="drillToAnalysis" type="button">送入完整分析（六步驟／五層／報告）→</button>
      <button id="drillCopy" type="button">複製陪練紀錄</button>
      <button id="drillAgain" type="button">再練一次（同劇本）</button>
      <button id="drillNew" type="button">換劇本</button>
    </div>
    <p class="hint">複製下來的紀錄含每句判定，可以拿去跟資深夥伴討論修正——這是訓練工具，不是通話流程。</p>
  </div>`;
  renderReportList('drillGood', coaching.good, '這通還沒有亮點——先從限時內開口、問具體問題開始');
  renderReportList('drillBad', coaching.bad, '沒有明顯失誤，維持這個節奏');
  panel().querySelectorAll('ul.report li').forEach((li) => li.classList.add('open'));

  $('drillToAnalysis').onclick = () => {
    const date = new Date().toISOString().slice(0, 10);
    deps.onTranscriptReady?.(sessionToSrt(session), `陪練-${p.name}-${date}.srt`);
  };
  $('drillCopy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(sessionToText(session, stats, coaching, quiz));
      deps.showToast?.('陪練紀錄已複製');
    } catch {
      deps.showToast?.('無法存取剪貼簿，請手動選取複製');
    }
  };
  $('drillAgain').onclick = () => {
    prefs.personaKey = p.key;
    savePrefs();
    startDrill();
  };
  $('drillNew').onclick = () => {
    session = null;
    renderSetup();
  };
}

/* ------------------------------------------------------------------ */

/** 回到陪練模式時重讀症狀紀錄（期間可能分析了新的通話） */
export function refreshDrillFocus() {
  if (session && !session.ended) return;
  if (!$('drillFocusCard')) return;
  loadRecentPick();
}

export function initDrill(options = {}) {
  deps = options;
  if (!panel()) return;
  renderSetup();
  window.addEventListener('beforeunload', stopTimer);
}
