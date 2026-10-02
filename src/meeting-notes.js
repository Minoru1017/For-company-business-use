/**
 * 主管早會語音紀錄：逐字稿儲存、規則式重點萃取、AI 重點 prompt／解析。
 * 純函式為主，方便測試；瀏覽器語音辨識與 UI 在 meeting-notes-ui.js。
 */
const KEY = 'callCoachMeetings';
export const MEETING_LIMIT = 30;
const MAX_TRANSCRIPT_CHARS = 30000;

export const POINT_CATEGORIES = {
  value: { label: '價值觀', hint: '為什麼要這樣做' },
  process: { label: '流程', hint: '每天／每通要怎麼做' },
  kpi: { label: '指標', hint: '數字目標、比例、通數' },
  script: { label: '話術', hint: '電話裡要講的句子' },
  remind: { label: '提醒', hint: '要避免、要注意的事' },
};

const DIRECTIVE_RE = /(要|不要|必須|一定|記得|重點|目標|從今天|從明天|每天|每通|每個人|請|先|別|務必|規定|開始|改成|改為|至少|最少|不能|不可以|應該)/;
const KPI_RE = /(\d+|[一二兩三四五六七八九十百]+)\s*(通|%|％|分|件|個|次|天|組|位|人|萬|成)/;
const SCRIPT_RE = /(「|」|跟客戶說|問客戶|開場|話術|這樣講|這樣問|怎麼講|怎麼問|問他|說法)/;
const VALUE_RE = /(業績|心態|態度|為什麼|本質|價值|相信|習慣|做出來|聽出來|自己|練)/;
const REMIND_RE = /(不要|別|不能|不可以|小心|注意|避免|禁止|千萬)/;
const FILLER_RE = /^(那|然後|就是|嗯|對|好|所以|其實|反正|齁|喔|欸|啊|這個|那個|OK|好啦)+/;

function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function read() {
  const s = storage();
  if (!s) return [];
  try {
    const arr = JSON.parse(s.getItem(KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function write(list) {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(KEY, JSON.stringify(list.slice(0, MEETING_LIMIT)));
    return true;
  } catch {
    return false;
  }
}

export function newMeetingId() {
  return `mt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function listMeetings() {
  return read().sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

export function getMeeting(id) {
  return read().find((m) => m.id === id) || null;
}

/**
 * @param {{ id?:string, title?:string, startedAt?:number, endedAt?:number, lines?:Array<{t:number,text:string}>, transcript?:string, points?:Array, applied?:boolean, audioSessionId?:string, audioMimeType?:string, audioBytes?:number }} meeting
 */
export function saveMeeting(meeting) {
  const list = read();
  const now = Date.now();
  const entry = {
    id: meeting.id || newMeetingId(),
    title: String(meeting.title || '').trim() || defaultMeetingTitle(meeting.startedAt || now),
    startedAt: meeting.startedAt || now,
    endedAt: meeting.endedAt || null,
    lines: (meeting.lines || []).map((l) => ({ t: Math.max(0, Number(l.t) || 0), text: String(l.text || '') })),
    transcript: String(meeting.transcript || '').slice(0, MAX_TRANSCRIPT_CHARS),
    points: normalizePoints(meeting.points),
    applied: !!meeting.applied,
    source: meeting.source || 'browser-speech',
    audioSessionId: String(meeting.audioSessionId || ''),
    audioMimeType: String(meeting.audioMimeType || ''),
    audioBytes: Math.max(0, Number(meeting.audioBytes) || 0),
    updatedAt: now,
  };
  const idx = list.findIndex((m) => m.id === entry.id);
  if (idx >= 0) list.splice(idx, 1);
  list.unshift(entry);
  write(list);
  return entry;
}

export function deleteMeeting(id) {
  return write(read().filter((m) => m.id !== id));
}

export function defaultMeetingTitle(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} 主管早會`;
}

export function normalizePoints(points) {
  return (points || [])
    .map((p, i) => ({
      id: p.id || `p_${i}_${Math.random().toString(36).slice(2, 6)}`,
      text: String(p.text || '').trim(),
      category: POINT_CATEGORIES[p.category] ? p.category : 'process',
      action: String(p.action || '').trim(),
      selected: p.selected !== false,
      source: p.source || 'rule',
    }))
    .filter((p) => p.text);
}

/** 把逐字稿行合成純文字（給萃取／AI 用） */
export function linesToTranscript(lines) {
  return (lines || [])
    .map((l) => String(l.text || '').trim())
    .filter(Boolean)
    .join('\n');
}

export function splitSentences(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split(/(?<=[。！？!?；;])|\n+/)
    .map((s) => s.trim().replace(FILLER_RE, '').trim())
    .filter((s) => s.length >= 6);
}

export function classifyPoint(sentence) {
  const s = sentence;
  if (KPI_RE.test(s)) return 'kpi';
  if (SCRIPT_RE.test(s)) return 'script';
  if (REMIND_RE.test(s)) return 'remind';
  if (VALUE_RE.test(s) && !DIRECTIVE_RE.test(s)) return 'value';
  if (VALUE_RE.test(s)) return 'value';
  return 'process';
}

function scoreSentence(s) {
  let score = 0;
  if (DIRECTIVE_RE.test(s)) score += 3;
  if (KPI_RE.test(s)) score += 3;
  if (SCRIPT_RE.test(s)) score += 2;
  if (VALUE_RE.test(s)) score += 1;
  if (REMIND_RE.test(s)) score += 1;
  if (s.length >= 12 && s.length <= 60) score += 1;
  if (s.length > 90) score -= 1;
  return score;
}

function similar(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  sa.forEach((c) => sb.has(c) && inter++);
  return inter / Math.max(1, Math.min(sa.size, sb.size));
}

/**
 * 規則式重點萃取：抓有「指示語氣」「數字目標」「話術」的句子，去重後依分數取前 N。
 * @returns {Array<{text:string, category:string, score:number, source:'rule'}>}
 */
export function extractKeyPoints(text, { max = 8 } = {}) {
  const sentences = splitSentences(text);
  const scored = sentences
    .map((s) => ({ text: s, category: classifyPoint(s), score: scoreSentence(s), source: 'rule' }))
    .filter((p) => p.score >= 3);
  scored.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const p of scored) {
    if (picked.some((q) => similar(q.text, p.text) > 0.75)) continue;
    picked.push(p);
    if (picked.length >= max) break;
  }
  // 依原文順序輸出，讀起來像會議脈絡
  const order = new Map(sentences.map((s, i) => [s, i]));
  picked.sort((a, b) => (order.get(a.text) ?? 0) - (order.get(b.text) ?? 0));
  return picked;
}

export function buildMeetingSummaryPrompt(transcript, { date = '' } = {}) {
  return (
    '你是業務團隊的會議記錄助理。以下是主管在早會口頭講話的語音轉文字（可能有辨識錯字、口語贅詞）。' +
    '請萃取「會影響業務接下來怎麼打電話、怎麼複盤」的重點，每點一句、用主管的原意改寫成清楚的指示，不要加入原文沒有的內容。' +
    (date ? `會議日期：${date}。` : '') +
    '分類只能是：value（價值觀／心態）、process（流程／每天怎麼做）、kpi（數字目標）、script（電話裡要講的話）、remind（要避免或注意）。' +
    '請只輸出 JSON：{"theme":"一句話總結今天主管想強調什麼","points":[{"text":"重點（≤40字）","category":"value|process|kpi|script|remind","action":"業務今天可以怎麼做（≤30字，可留空）"}]}。points 3～8 點，依重要性排序。\n\n逐字稿：\n' +
    String(transcript || '').slice(0, 14000)
  );
}

export function parseMeetingSummary(raw) {
  let obj = raw;
  if (typeof raw === 'string') {
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    obj = JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned);
  }
  const points = Array.isArray(obj?.points) ? obj.points : [];
  return {
    theme: String(obj?.theme || '').trim(),
    points: normalizePoints(points.map((p) => ({ ...p, source: 'ai' }))),
  };
}

/** 逐字稿行時間戳 */
export function formatClock(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
