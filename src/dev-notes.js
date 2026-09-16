/**
 * 逐字稿 →「開發重點」筆記（電訪複盤用）。
 * 格式：角色[mm:ss] 或 角色[mm:ss]~[mm:ss] + 一句摘要；另附氛圍與客戶語調變化。
 */
import { detectKeyMoments } from './key-moments.js';
import { RULES } from './rules.js';
import { disclosureLevel } from './trust.js';
import { isQuestion } from './speaker.js';
import { buildTranscript, chunkTranscript } from './gemini.js';
import { fmt } from './utils.js';

const STEP_HINTS = [
  { key: 'connect', re: RULES.steps[0].re, verb: '連結／開場' },
  { key: 'discovery', re: /了解|請問|方便|狀況|目前|平常|怎麼|什麼|哪些/, verb: '挖掘／提問' },
  { key: 'clarify', re: RULES.steps[2].re, verb: '釐清現況與代價' },
  { key: 'diagnose', re: RULES.steps[3].re, verb: '判斷適配' },
  { key: 'recommend', re: RULES.steps[4].re, verb: '對接方案' },
  { key: 'decision', re: RULES.steps[5].re, verb: '邀約／決策' },
];

const INVITE_RE = /約|見面|線上|簡報|說明會|安排|時間|有空|參考|傳.*給你|寄.*給你/;
const INTRO_RE = /我們|公司|服務|在做|提供|課程|培訓|方案|模式/;

function roleLabel(spk) {
  return spk === 'C' ? '客戶' : '業務';
}

function timeTag(start, end) {
  const a = fmt(start);
  if (end != null && end - start >= 4) return `[${a}]~[${fmt(end)}]`;
  return `[${a}]`;
}

function compressText(text, max = 22) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function summarizeSalesLine(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '（無內容）';
  if (INVITE_RE.test(t) && /約|時間|見面|說明/.test(t)) return '進到邀約流程';
  if (INTRO_RE.test(t) && t.length > 40) return '告知我們在做什麼／服務模式';
  for (const st of STEP_HINTS) {
    if (st.re.test(t)) {
      if (isQuestion(t)) return `${st.verb.replace(/／.*$/, '')}${extractQuestionTopic(t)}`;
      return st.verb;
    }
  }
  if (isQuestion(t)) return `問${extractQuestionTopic(t)}`;
  if (/告知|說明|介紹|其實我們/.test(t)) return compressText(t, 28);
  return compressText(t, 24);
}

function extractQuestionTopic(text) {
  const t = String(text || '');
  const patterns = [
    /(?:什麼|哪些|哪(?:一|些|個|方面)|如何|怎麼|是不是|有沒有|會不會)(.{2,18})/,
    /(.{2,12})(嗎|呢|？|\?)\s*$/,
    /請問(.{2,16})/,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m && m[1]) {
      return m[1].replace(/[？?吗嗎呢吧，,。\s]+$/g, '').slice(0, 14) || '相關狀況';
    }
  }
  return compressText(t.replace(/^[嗯啊喔對好，。\s]+/, ''), 12);
}

function summarizeCustomerLine(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= 20) return t;
  return compressText(t, 18);
}

/** 合併連續同角色片段，避免一行一句過碎。 */
export function mergeSpeakerRuns(segs, { maxGapSec = 2.5 } = {}) {
  if (!segs.length) return [];
  const runs = [];
  let cur = null;
  for (const s of segs) {
    if (
      cur &&
      cur.spk === s.spk &&
      s.start - cur.end <= maxGapSec
    ) {
      cur.end = s.end;
      cur.text = `${cur.text} ${s.text}`.trim();
      cur.chars = (cur.chars || 0) + (s.chars || 0);
      cur._idxEnd = s._idx ?? cur._idxEnd;
    } else {
      if (cur) runs.push(cur);
      cur = { ...s, text: s.text, _idxStart: s._idx ?? 0, _idxEnd: s._idx ?? 0 };
    }
  }
  if (cur) runs.push(cur);
  return runs;
}

function attachIndices(segs) {
  return segs.map((s, i) => ({ ...s, _idx: i }));
}

function pickTimelineRuns(segs) {
  const indexed = attachIndices(segs);
  const runs = mergeSpeakerRuns(indexed);
  const out = [];
  for (const r of runs) {
    const dur = r.end - r.start;
    const isSales = r.spk === 'S';
    const summary = isSales ? summarizeSalesLine(r.text) : summarizeCustomerLine(r.text);
    const tooShort = !isSales && r.chars <= 2 && !/可以|好呀|沒問題|想了解/.test(r.text);
    const salesMonologue = isSales && dur < 3 && r.chars < 25;
    if (tooShort && out.length && out[out.length - 1].spk === 'C') continue;
    if (salesMonologue && out.length && out[out.length - 1].spk === 'S') {
      const prev = out[out.length - 1];
      prev.end = r.end;
      prev.text = `${prev.text} ${r.text}`;
      prev.summary = summarizeSalesLine(prev.text);
      continue;
    }
    out.push({
      spk: r.spk,
      start: r.start,
      end: r.end,
      text: r.text,
      summary,
    });
  }
  return out;
}

function atmosphereFromMoments(moments) {
  return (moments || []).slice(0, 6).map((m) => ({
    start: fmt(m.start),
    end: fmt(m.end),
    quote: compressText(m.salesText, 36),
    atmosphere: `${m.label}：${m.detail}`,
  }));
}

function detectToneShifts(segs) {
  const cust = segs.filter((s) => s.spk === 'C');
  const shifts = [];
  let prevLevel = disclosureLevel(cust[0]?.text || '');
  let prevShort = (cust[0]?.chars || 0) <= 4;

  for (let i = 1; i < cust.length; i++) {
    const s = cust[i];
    const level = disclosureLevel(s.text);
    const short = s.chars <= 4;
    const positive = /可以呀|好啊|沒問題|想了解|有興趣|方便|好啊|行啊|OK|ok/i.test(s.text);
    const askBack = /簡介|參考|資料|傳|寄|多少錢|費用|怎麼收/.test(s.text);

    let note = '';
    if (positive && prevShort) note = '從短答／觀望轉為願意往下聊';
    else if (askBack && i > 0) note = '語調轉為主動索取資訊（興趣升溫）';
    else if (level >= 2 && prevLevel <= 1) note = '開始透露困擾或具體狀況（信任加深）';
    else if (level >= 3 && prevLevel < 3) note = '出現動機／私人層表述（揭露加深）';

    if (note) {
      shifts.push({
        time: fmt(s.start),
        quote: compressText(s.text, 24),
        note,
      });
    }
    prevLevel = level;
    prevShort = short;
  }
  return shifts.slice(0, 5);
}

function clockTag(start, end) {
  const a = typeof start === 'number' ? fmt(start) : String(start || '00:00');
  const e = end == null ? null : typeof end === 'number' ? fmt(end) : String(end);
  if (e && e !== a) return `[${a}]~[${e}]`;
  return `[${a}]`;
}

export function formatDevNotesText({ agentName, timeline, atmosphere, toneShifts }) {
  const lines = [];
  if (agentName) lines.push(agentName, '');
  for (const row of timeline || []) {
    const tag = clockTag(row.start, row.end !== row.start ? row.end : null);
    lines.push(`${row.role}${tag}${row.summary}`);
  }
  if (atmosphere?.length) {
    lines.push('', '【業務氛圍】');
    for (const a of atmosphere) {
      const range = a.end && a.end !== a.start ? `[${a.start}]~[${a.end}]` : `[${a.start}]`;
      lines.push(`業務${range}「${a.quote}」→ ${a.atmosphere}`);
    }
  }
  if (toneShifts?.length) {
    lines.push('', '【客戶語調變化】');
    for (const t of toneShifts) {
      lines.push(`客戶[${t.time}]「${t.quote}」→ ${t.note}`);
    }
  }
  return lines.join('\n').trim();
}

/** 本機規則版（不上傳）。 */
export function buildDevNotesLocal(segs, { agentName = '', result = null } = {}) {
  const moments = result?.keyMoments || detectKeyMoments(segs);
  const runs = pickTimelineRuns(segs);
  const timeline = runs.map((r) => ({
    role: roleLabel(r.spk),
    start: r.start,
    end: r.end,
    summary: r.summary,
  }));
  return {
    agentName: agentName.trim(),
    timeline,
    atmosphere: atmosphereFromMoments(moments),
    toneShifts: detectToneShifts(segs),
  };
}

export const DEV_NOTES_PROMPT = `你是電訪「開發複盤」教練。請把逐字稿整理成同事能一眼看懂的手打風格「開發重點」。

輸出只能是 JSON（不要 markdown）：
{
  "agent_name": "業務姓名，未知則空字串",
  "timeline": [
    {"role":"業務或客戶","start_mmss":"00:31","end_mmss":null或"01:31","summary":"一句話，例如：問工作性質"}
  ],
  "atmosphere": [
    {"start_mmss":"01:19","end_mmss":"01:31","quote_brief":"業務原話精簡","atmosphere":"這段營造了什麼氛圍（如專業、降低防備、建立信任、示範價值）"}
  ],
  "tone_shifts": [
    {"time_mmss":"02:30","quote":"客戶原話精簡","note":"語調／態度從什麼變成什麼"}
  ]
}

要求：
- timeline 只保留關鍵節拍（約 8～20 行），不要每句都列；客戶短答可只寫關鍵詞（如「裝修」「2~3小時」「可以呀」）
- 業務連續說明超過 4 秒用 start_mmss~end_mmss
- atmosphere 列 2～5 段「業務」最有氛圍設計的發話，說明營造了什麼
- tone_shifts 列 2～4 處客戶語調明顯變化
- 用繁體中文、口語但精準

逐字稿（S=業務, C=客戶）：\n`;

export function parseDevNotesAI(raw) {
  const cleaned = String(raw || '').replace(/^```json\s*|```\s*$/g, '').trim();
  const j = JSON.parse(cleaned);
  if (!j || typeof j !== 'object') throw new Error('AI 回傳格式不正確');
  if (!Array.isArray(j.timeline)) throw new Error('缺少 timeline');
  return j;
}

export function devNotesFromAI(json) {
  const timeline = (json.timeline || []).map((row) => ({
    role: row.role || '業務',
    start: parseMmss(row.start_mmss),
    end: row.end_mmss ? parseMmss(row.end_mmss) : parseMmss(row.start_mmss),
    summary: String(row.summary || '').trim(),
  }));
  const atmosphere = (json.atmosphere || []).map((a) => ({
    start: a.start_mmss,
    end: a.end_mmss || a.start_mmss,
    quote: a.quote_brief || '',
    atmosphere: a.atmosphere || '',
  }));
  const toneShifts = (json.tone_shifts || []).map((t) => ({
    time: t.time_mmss,
    quote: t.quote || '',
    note: t.note || '',
  }));
  return {
    agentName: String(json.agent_name || '').trim(),
    timeline,
    atmosphere,
    toneShifts,
  };
}

function parseMmss(mmss) {
  const m = String(mmss || '0:0').match(/(\d+):(\d+)/);
  if (!m) return 0;
  return (+m[1]) * 60 + (+m[2]);
}

export async function buildDevNotesAI(segs, fmtFn, { callGemini, apiKey, model, signal }) {
  const transcript = buildTranscript(segs, fmtFn);
  const chunks = chunkTranscript(transcript, 14000);
  let merged = null;
  let totalTokens = 0;
  for (let i = 0; i < chunks.length; i++) {
    const prefix = chunks.length > 1 ? `【第 ${i + 1}/${chunks.length} 段】\n` : '';
    const { parsed, usedTokens } = await callGemini({
      apiKey,
      model,
      text: DEV_NOTES_PROMPT + prefix + chunks[i],
      signal,
      parse: parseDevNotesAI,
    });
    totalTokens += usedTokens;
    if (!merged) merged = parsed;
    else {
      merged.timeline = [...(merged.timeline || []), ...(parsed.timeline || [])];
      merged.atmosphere = [...(merged.atmosphere || []), ...(parsed.atmosphere || [])];
      merged.tone_shifts = [...(merged.tone_shifts || []), ...(parsed.tone_shifts || [])];
    }
  }
  return { notes: devNotesFromAI(merged), usedTokens: totalTokens };
}
