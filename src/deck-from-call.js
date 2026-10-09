/**
 * 電訪分析 → DEMO 簡報：從已標記的逐字稿挑客戶原話，帶入簡報的客戶資料欄位。
 * 只用客戶（C）說的話；每句只放進一個欄位，原話全部保留在「開發紀錄」讓 AI／業務再挑。
 */
import { emptyInput } from './demo-deck.js';
import { RULES } from './rules.js';
import { fmt } from './utils.js';

const MIN_CHARS = 6;
const RAW_MAX_LINES = 40;
const RAW_MAX_CHARS = 3000;

const FIELD_LIMITS = { concerns: 4, goals: 3, story: 3, background: 2, availability: 2 };

const CONCERN_RE = /擔心|害怕|怕(會|自己|學|跟)|會不會|怎麼辦|學不會|跟不上|太難|不確定|考慮|猶豫|多少錢|費用|價格|貴|要多久|來得及|[?？]|嗎[。！!～~]?$/;
const AVAIL_RE = /晚上|週末|周末|假日|每天|每週|每周|小時|下班|空檔|筆電|電腦|手機|平板|Mac|Windows|iPad/i;
const GOAL_RE = /希望|想(要|學|做|變成|成為|試試)|目標|理想|未來|以後|將來|夢想|有一天/;
const STORY_RE = /因為|之前|以前|一直|開始|契機|後來|那時候|所以|才會|想了|好幾年|[一二三四五六七八九十\d]+年/;
const BACKGROUND_RE = /工作|上班|職業|公司|老闆|主管|學生|退休|自由業|接案|兼職|科系|本科|行業|開店|創業|外送|業務|設計|工程師/;

const LAYER_FIELD = { 1: 'background', 2: 'story', 3: 'story', 4: 'story', 5: 'goals' };

function lineChars(s) {
  return Number(s.chars) || String(s.text || '').replace(/\s/g, '').length;
}

function salesLayer(text) {
  const hit = [...RULES.layers].reverse().find((L) => L.re.test(text));
  return hit ? hit.n : 0;
}

function customerLayer(text) {
  const hit = [...RULES.layers].reverse().find((L) => (L.customerRe || L.re).test(text));
  return hit ? hit.n : 0;
}

/**
 * 依關鍵字與「業務剛問了哪一層」決定一句客戶原話放哪個欄位。
 * 業務還沒開始挖掘前（開場寒暄），只收擔心／時間／背景，避免客套話被當成故事。
 */
function classifyLine(text, askedLayer, digging) {
  if (CONCERN_RE.test(text)) return 'concerns';
  const layer = askedLayer ? RULES.layers.find((L) => L.n === askedLayer) : null;
  if (layer && (layer.customerRe || layer.re).test(text)) return LAYER_FIELD[askedLayer];
  if (AVAIL_RE.test(text) && !GOAL_RE.test(text)) return 'availability';
  if (askedLayer) return LAYER_FIELD[askedLayer];
  if (!digging) return BACKGROUND_RE.test(text) ? 'background' : '';
  if (GOAL_RE.test(text)) return 'goals';
  if (BACKGROUND_RE.test(text)) return 'background';
  if (STORY_RE.test(text)) return 'story';
  const n = customerLayer(text);
  return n ? LAYER_FIELD[n] : '';
}

const quote = (s) => `「${String(s.text).trim()}」`;

/**
 * @param {{start:number,spk:string,text:string,chars?:number}[]} segs 已標記說話者的逐字稿
 * @param {object|null} result runAnalysis 結果（用目的分級補「學員特質」）
 * @param {{source?:string}} opts
 */
export function deckInputFromCall(segs, result = null, { source = '' } = {}) {
  const input = emptyInput();
  const buckets = { concerns: [], goals: [], story: [], background: [], availability: [] };
  const rawLines = [];
  let askedLayer = 0;
  let sinceAsk = 0;
  let digging = false;
  const seen = new Set();

  (segs || []).forEach((s) => {
    const text = String(s?.text || '').trim();
    if (!text) return;
    if (s.spk === 'S') {
      const n = salesLayer(text);
      if (n) {
        askedLayer = n;
        sinceAsk = 0;
        digging = true;
      }
      return;
    }
    if (s.spk !== 'C' || lineChars(s) < MIN_CHARS || seen.has(text)) return;
    seen.add(text);
    sinceAsk += 1;
    const layerCtx = sinceAsk <= 2 ? askedLayer : 0;
    if (rawLines.length < RAW_MAX_LINES) rawLines.push(`[${fmt(Number(s.start) || 0)}] ${text}`);
    const field = classifyLine(text, layerCtx, digging);
    if (field && buckets[field].length < FIELD_LIMITS[field]) buckets[field].push(quote(s));
  });

  Object.entries(buckets).forEach(([k, list]) => {
    input[k] = list.join('\n');
  });

  const pp = result?.purposeProfile;
  if (pp?.classified && pp.dominant) {
    const second = pp.secondary ? `；次要：${pp.secondary.label}` : '';
    input.traits = `目的分級：${pp.dominant.label}（${pp.dominant.purpose}）${second}`;
  }

  if (rawLines.length) {
    let raw = `【電訪逐字稿 · 客戶原話${source ? ` · ${source}` : ''}】\n${rawLines.join('\n')}`;
    if (raw.length > RAW_MAX_CHARS) raw = `${raw.slice(0, RAW_MAX_CHARS)}…`;
    input.raw = raw;
  }
  return input;
}

/** 有幾個欄位帶到內容（給提示訊息用） */
export function filledDeckFields(input) {
  return ['goals', 'story', 'concerns', 'background', 'availability', 'traits'].filter((k) => String(input?.[k] || '').trim());
}