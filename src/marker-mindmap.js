/**
 * 話點心智圖：把播放器 M 鍵留下的標記，拆成「表層資訊 → 內心真意 → 證據」的可拖拉節點圖。
 *
 * 設計原則：「真意」是推論，必須有原句（逐字稿）或行為（停頓、回答變短）當證據；
 * 沒有證據的推論會被標成「只有我覺得」，提醒業務回放找證據，而不是把感覺寫進複盤。
 */
import { formatDuration } from './symptom-engine.js';
import { escapeHTML } from './utils.js';

export const EVIDENCE_KINDS = { quote: '原句', behavior: '行為' };

export const STRENGTH = {
  empty: { label: '尚未推論', hint: '先寫下你認為客戶真正想傳達的是什麼。' },
  none: { label: '只有「我覺得」', hint: '沒有任何原句或行為撐這個推論——回放這段，從逐字稿挑一句，或寫下你聽到的行為。' },
  weak: { label: '證據單薄', hint: '至少要一句客戶原句，再加一個行為或第二句原句，推論才站得住。' },
  solid: { label: '證據充分', hint: '有原句也有佐證，這個推論可以寫進複盤與回撥話術。' },
};

const SUGGEST_WINDOW_SEC = 25;

function rid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function toSec(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, n) : null;
}

export function normalizeEvidence(list) {
  return (Array.isArray(list) ? list : [])
    .map((e) => ({
      id: e?.id || rid('ev'),
      kind: e?.kind === 'behavior' ? 'behavior' : 'quote',
      text: String(e?.text || '').trim(),
      sec: toSec(e?.sec),
      spk: e?.spk === 'C' || e?.spk === 'S' ? e.spk : null,
      source: e?.source === 'transcript' ? 'transcript' : 'manual',
    }))
    .filter((e) => e.text);
}

/** 標記上的分析欄位（舊資料沒有這些欄位時補空值） */
export function normalizeMarkerAnalysis(m = {}) {
  return {
    surface: String(m.surface || ''),
    intent: String(m.intent || ''),
    evidence: normalizeEvidence(m.evidence),
  };
}

/** 推論的證據強度：empty（還沒寫真意）/ none（只有我覺得）/ weak / solid */
export function evidenceStrength(marker = {}) {
  const { intent, evidence } = normalizeMarkerAnalysis(marker);
  const quotes = evidence.filter((e) => e.kind === 'quote').length;
  const behaviors = evidence.length - quotes;
  if (!intent.trim()) return { level: 'empty', ...STRENGTH.empty, quotes, behaviors };
  let level = 'none';
  if (quotes >= 1 && evidence.length >= 2) level = 'solid';
  else if (evidence.length >= 1) level = 'weak';
  return { level, ...STRENGTH[level], quotes, behaviors };
}

/** 標記時間點前後的逐字稿句子（依時間排序），讓業務直接點選成證據 */
export function suggestEvidence(transcript, sec, { windowSec = SUGGEST_WINDOW_SEC, limit = 6 } = {}) {
  const t = Number(sec) || 0;
  return (Array.isArray(transcript) ? transcript : [])
    .filter((s) => s && typeof s.text === 'string' && s.text.trim())
    .map((s) => {
      const start = Number(s.start) || 0;
      const end = Math.max(start, Number(s.end) || start);
      const dist = t < start ? start - t : t > end ? t - end : 0;
      return { sec: start, end, text: s.text.trim(), spk: s.spk === 'C' || s.spk === 'S' ? s.spk : null, dist };
    })
    .filter((s) => s.dist <= windowSec)
    .sort((a, b) => a.dist - b.dist || a.sec - b.sec)
    .slice(0, limit)
    .sort((a, b) => a.sec - b.sec);
}

/** 「1:23」「83」「1m23s」→ 秒；無法解析回 null */
export function parseTimeInput(str) {
  const s = String(str ?? '').trim();
  if (!s) return null;
  const colon = s.match(/^(\d+):(\d{1,2})(?:\.(\d+))?$/);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]) + (colon[3] ? Number(`0.${colon[3]}`) : 0);
  const ms = s.match(/^(?:(\d+)m)?\s*(?:(\d+)s)?$/i);
  if (ms && (ms[1] || ms[2])) return Number(ms[1] || 0) * 60 + Number(ms[2] || 0);
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** 話點還沒填的步驟，依填寫順序（text → surface → intent → evidence） */
export function missingSteps(marker = {}) {
  const a = normalizeMarkerAnalysis(marker);
  const out = [];
  if (!String(marker.text || '').trim()) out.push('text');
  if (!a.surface.trim()) out.push('surface');
  if (!a.intent.trim()) out.push('intent');
  if (!a.evidence.length) out.push('evidence');
  return out;
}

/** 編輯面板預設展開的步驟：第一個還沒填的，全填了就停在證據 */
export function firstOpenStep(marker = {}) {
  return missingSteps(marker)[0] || 'evidence';
}

export const markerKey = (callId, markerId) => `${callId}:${markerId}`;

/**
 * 把當天有標記的錄音展開成樹：root → 錄音 → 話點 → {表層, 真意 → 證據}
 * 只展開 focus 指定的話點（'*' 全部展開、null 全部收起），其他話點只留一個節點；
 * 沒填的欄位不畫佔位節點，改記在話點的 missing 上，讓畫面用「＋」小按鈕補。
 * @param {Array} calls 含 devMarkers 的錄音
 * @param {{dayLabel?:string, collapsed?:Set<string>, single?:boolean, focus?:string|null}} opts collapsed：收合的 callId；focus：markerKey
 */
export function buildMindmap(calls, { dayLabel = '當天', collapsed = new Set(), single = false, focus = '*' } = {}) {
  const nodes = single ? [] : [{ id: 'root', type: 'root', depth: 0, parent: null, label: dayLabel, sub: '話點心智圖' }];
  const edges = [];
  const d0 = single ? -1 : 0;
  const add = (n) => {
    n.depth += d0;
    nodes.push(n);
    if (n.parent) edges.push({ from: n.parent, to: n.id });
    return n;
  };
  (calls || []).forEach((c) => {
    const markers = (c.devMarkers || []).slice().sort((a, b) => (Number(a.sec) || 0) - (Number(b.sec) || 0));
    if (!markers.length) return;
    const isCollapsed = !single && collapsed.has(c.id);
    const callNode = add({
      id: `call:${c.id}`,
      type: 'call',
      depth: 1,
      parent: single ? null : 'root',
      callId: c.id,
      label: c.name || '錄音',
      sub: `${c.startTime ? `${c.startTime} · ` : ''}${markers.length} 話點${isCollapsed ? ' · 已收合' : ''}`,
      collapsed: isCollapsed,
    });
    if (isCollapsed) return;
    markers.forEach((m) => {
      const a = normalizeMarkerAnalysis(m);
      const strength = evidenceStrength(m);
      const sec = Number(m.sec) || 0;
      const base = { callId: c.id, markerId: m.id };
      const surface = a.surface.trim();
      const intentText = a.intent.trim();
      const expanded = focus === '*' || focus === markerKey(c.id, m.id);
      const missing = missingSteps(m).filter((k) => k !== 'text');
      const mk = add({
        ...base,
        id: `mk:${c.id}:${m.id}`,
        type: 'marker',
        depth: 2,
        parent: callNode.id,
        sec,
        label: String(m.text || '').trim() || '（還沒寫這句發生什麼）',
        sub: `話點 ${formatDuration(sec)}`,
        empty: !String(m.text || '').trim(),
        level: strength.level,
        missing,
        expanded,
        rows: expanded && missing.length ? 2 : 1,
        hiddenCount: expanded ? 0 : (surface ? 1 : 0) + (intentText ? 1 : 0) + a.evidence.length,
      });
      if (!expanded) return;
      if (surface) {
        add({ ...base, id: `sf:${c.id}:${m.id}`, type: 'surface', depth: 3, parent: mk.id, label: surface, sub: '表層資訊' });
      }
      const intent = intentText
        ? add({ ...base, id: `in:${c.id}:${m.id}`, type: 'intent', depth: 3, parent: mk.id, label: intentText, sub: '內心真意', strength })
        : null;
      a.evidence.forEach((e) => {
        const who = e.spk === 'C' ? ' · 客戶' : e.spk === 'S' ? ' · 我' : '';
        add({
          ...base,
          id: `ev:${c.id}:${m.id}:${e.id}`,
          type: 'evidence',
          depth: intent ? 4 : 3,
          parent: intent ? intent.id : mk.id,
          evidenceId: e.id,
          kind: e.kind,
          sec: e.sec ?? sec,
          label: e.text,
          sub: `${EVIDENCE_KINDS[e.kind]}${who}`,
        });
      });
    });
  });
  return { nodes, edges };
}

/**
 * 分頁放不下時要收進「更多」的分頁索引。第 0 個（總覽）和 keep 一定留著，其餘依序塞到放不下為止。
 * @param {number[]} widths 每個分頁的寬度
 * @param {number} avail 可用寬度
 * @param {number} moreW 「更多」按鈕的寬度
 * @param {number} keep 目前分頁的索引
 * @returns {number[]} 要收起的索引（遞增）
 */
export function overflowTabs(widths, avail, moreW, keep = 0) {
  const total = widths.reduce((s, w) => s + w, 0);
  if (total <= avail) return [];
  const must = new Set([0, keep].filter((i) => i >= 0 && i < widths.length));
  let used = moreW + [...must].reduce((s, i) => s + widths[i], 0);
  const hidden = [];
  widths.forEach((w, i) => {
    if (must.has(i)) return;
    if (used + w <= avail && !hidden.length) used += w;
    else hidden.push(i);
  });
  return hidden;
}

/**
 * 由左到右的樹狀排版：x 依深度、y 依葉節點順序，父節點置中；saved 內有座標的節點照舊。
 * @returns {{positions:Record<string,{x:number,y:number}>, width:number, height:number}}
 */
export function autoLayout(graph, saved = {}, { colW = 250, rowH = 78, padX = 24, padY = 24 } = {}) {
  const children = new Map();
  graph.nodes.forEach((n) => {
    if (!n.parent) return;
    if (!children.has(n.parent)) children.set(n.parent, []);
    children.get(n.parent).push(n.id);
  });
  const auto = {};
  const rowsOf = new Map(graph.nodes.map((n) => [n.id, Math.max(1, Number(n.rows) || 1)]));
  let row = 0;
  const place = (id, depth) => {
    const kids = children.get(id) || [];
    const startRow = row;
    let y;
    if (!kids.length) {
      y = padY + row * rowH;
      row += rowsOf.get(id) || 1;
    } else {
      const ys = kids.map((k) => place(k, depth + 1));
      y = (ys[0] + ys[ys.length - 1]) / 2;
      row = Math.max(row, startRow + (rowsOf.get(id) || 1));
    }
    auto[id] = { x: padX + depth * colW, y };
    return y;
  };
  graph.nodes.filter((n) => !n.parent).forEach((n) => place(n.id, 0));
  const positions = {};
  let maxX = 0;
  let maxY = 0;
  graph.nodes.forEach((n) => {
    const s = saved[n.id];
    const p = s && Number.isFinite(Number(s.x)) && Number.isFinite(Number(s.y)) ? { x: Math.max(0, Number(s.x)), y: Math.max(0, Number(s.y)) } : auto[n.id] || { x: padX, y: padY };
    positions[n.id] = { x: Math.round(p.x), y: Math.round(p.y) };
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  });
  return { positions, width: Math.ceil(maxX + colW + padX), height: Math.ceil(maxY + rowH + padY) };
}

/** 只取屬於某通錄音的節點座標（存回 call.mindmapPos 用） */
export function positionsForCall(graph, positions, callId) {
  const out = {};
  graph.nodes.forEach((n) => {
    if (n.callId === callId && positions[n.id]) out[n.id] = { ...positions[n.id] };
  });
  return out;
}

const LEVELS = ['none', 'empty', 'weak', 'solid'];

/** 話點證據強度統計；todo＝還不是「證據充分」的話點數 */
export function markerStats(calls) {
  const s = { total: 0, solid: 0, weak: 0, none: 0, empty: 0 };
  (calls || []).forEach((c) =>
    (c.devMarkers || []).forEach((m) => {
      s.total += 1;
      s[evidenceStrength(m).level] += 1;
    })
  );
  s.todo = s.total - s.solid;
  s.worst = LEVELS.find((l) => s[l] > 0) || 'empty';
  return s;
}

/** 分頁：「總覽」＋每通有話點的錄音各一頁 */
export function mindmapTabs(calls) {
  const marked = (calls || []).filter((c) => (c.devMarkers || []).length);
  return [
    { id: 'all', label: '總覽', title: `當天 ${marked.length} 通有話點的錄音`, stats: markerStats(marked) },
    ...marked.map((c, i) => ({
      id: c.id,
      label: `${i + 1}. ${c.startTime || truncate(String(c.name || '錄音'), 14)}`,
      title: c.name || '錄音',
      stats: markerStats([c]),
    })),
  ];
}

/** 左側話點清單（依錄音順序、再依時間） */
export function markerOutline(calls) {
  const out = [];
  (calls || []).forEach((c) => {
    (c.devMarkers || [])
      .slice()
      .sort((a, b) => (Number(a.sec) || 0) - (Number(b.sec) || 0))
      .forEach((m) => {
        const st = evidenceStrength(m);
        out.push({
          callId: c.id,
          callName: c.name || '錄音',
          startTime: c.startTime || '',
          markerId: m.id,
          sec: Number(m.sec) || 0,
          text: String(m.text || '').trim(),
          level: st.level,
          evidenceCount: normalizeEvidence(m.evidence).length,
        });
      });
  });
  return out;
}

const sameMarker = (a, b) => !!a && !!b && a.callId === b.callId && a.markerId === b.markerId;

/** 上／下一個話點（循環）；dir = 1 或 -1 */
export function stepMarker(outline, current, dir = 1) {
  if (!outline.length) return null;
  const idx = outline.findIndex((o) => sameMarker(o, current));
  if (idx < 0) return dir > 0 ? outline[0] : outline[outline.length - 1];
  return outline[(idx + dir + outline.length) % outline.length];
}

/** 目前話點之後、下一個還不是「證據充分」的話點（循環）；全部充分回 null */
export function nextTodoMarker(outline, current) {
  const idx = outline.findIndex((o) => sameMarker(o, current));
  for (let i = 1; i <= outline.length; i += 1) {
    const o = outline[(idx + i + outline.length) % outline.length];
    if (o.level !== 'solid') return o;
  }
  return null;
}

function readStore(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function writeStore(key, dayKey, value) {
  try {
    const raw = readStore(key);
    if (value == null) delete raw[dayKey];
    else raw[dayKey] = value;
    localStorage.setItem(key, JSON.stringify(raw));
  } catch {
    /* ignore */
  }
}

const ROOT_POS_KEY = 'callCoachMindmapRoot';
const TAB_KEY = 'callCoachMindmapTab';

function loadRootPos(dayKey) {
  const p = readStore(ROOT_POS_KEY)[dayKey];
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
}

/** 單通分頁的座標另外存（t: 前綴），和總覽的排版互不干擾 */
const TAB_POS_PREFIX = 't:';

const truncate = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

const SPK_LABEL = { C: '客', S: '我' };

const VIEW_KEY = 'callCoachMindmapView';

const LEGEND_HTML = `<ul class="mm-legend">
  <li><i class="mm-dot s-solid"></i>證據充分：有客戶原句，再加一個行為或第二句原句</li>
  <li><i class="mm-dot s-weak"></i>證據單薄：只有一個證據，或只有行為</li>
  <li><i class="mm-dot s-none"></i>只有「我覺得」：寫了真意，但沒有任何證據</li>
  <li><i class="mm-dot s-empty"></i>尚未推論：還沒寫真意</li>
</ul>`;

const KEYS_HTML = `<ul class="mm-keys">
  <li><kbd>V</kbd> 切換整理／全貌</li>
  <li><kbd>J</kbd><kbd>K</kbd> 上／下一個話點</li>
  <li><kbd>N</kbd> 下一個待補</li>
  <li><kbd>[</kbd><kbd>]</kbd> 切分頁</li>
  <li><kbd>F</kbd> 最大化／還原</li>
  <li><kbd>?</kbd> 這張清單</li>
  <li><kbd>Esc</kbd> 離開輸入、關閉面板</li>
</ul>`;

const STEPS = [
  { id: 'text', title: '這句發生什麼', field: 'text', placeholder: '這一句發生什麼？你的語氣／客戶可能在想…（和播放器的話點同步）' },
  { id: 'surface', title: '表層資訊', field: 'surface', placeholder: '客戶字面上說了什麼——照抄，不解讀。例：「我再考慮看看」' },
  { id: 'intent', title: '內心真意', field: 'intent', placeholder: '你認為他真正想傳達的（這是推論，要靠證據撐）。例：還不信任我、怕被推銷' },
  { id: 'evidence', title: '證據', field: null, placeholder: '' },
];

const ADD_LABEL = { surface: '＋表層', intent: '＋真意', evidence: '＋證據' };

/**
 * @param {HTMLElement} container
 * @param {{
 *   getDay: () => { key: string, label: string },
 *   getCalls: () => Array,
 *   onMarkerChange?: (callId: string, markers: Array) => void,
 *   onPositionsChange?: (callId: string, positions: Record<string,{x:number,y:number}>) => void,
 *   onJump?: (callId: string, sec: number) => void,
 * }} opts
 */
export function mountMarkerMindmap(container, opts) {
  const { getDay, getCalls, onMarkerChange, onPositionsChange, onJump } = opts;
  const collapsed = new Set();
  let graph = { nodes: [], edges: [] };
  let positions = {};
  let selectedId = null;
  let drag = null;
  let suggestions = [];
  let saveTimer = null;
  let activeTab = null;
  let lastDayKey = null;
  let todoOnly = false;
  let maximized = false;
  let hideWatch = null;
  let view = readView();
  let drawnFocus;
  let openStep = 'text';
  let stepFor = null;
  let suggOpen = false;

  container.innerHTML = `
    <div class="mm view-${view}" tabindex="-1">
      <div class="mm-titlebar">
        <div class="mm-tabs" role="tablist" aria-label="心智圖分頁"></div>
        <details class="mm-tab-more" hidden><summary class="mm-tab"></summary><div class="mm-tab-menu" role="menu"></div></details>
        <span class="mm-toolbar-actions">
          <span class="mm-view" role="group" aria-label="檢視">
            <button type="button" data-mm-view="list" title="一次整理一個話點（V）">整理</button>
            <button type="button" data-mm-view="map" title="看整張心智圖（V）">全貌</button>
          </span>
          <button type="button" class="btn slog-mini mm-next" data-mm="next-todo" title="跳到下一個還沒有充分證據的話點（N）">下一個待補 <b class="mm-next-count"></b></button>
          <button type="button" class="mm-icon-btn mm-max-btn" data-mm="max" aria-pressed="false" title="最大化視窗（F）" aria-label="最大化">⤢</button>
        </span>
      </div>
      <div class="mm-body">
        <nav class="mm-explorer" aria-label="話點清單">
          <div class="mm-explorer-head"><span>話點</span><label class="mm-todo-toggle"><input type="checkbox" data-mm-filter> 只看待補</label></div>
          <ul class="mm-outline"></ul>
        </nav>
        <div class="mm-stage"><div class="mm-canvas"><svg class="mm-edges" aria-hidden="true"></svg></div></div>
        <div class="mm-canvas-tools" role="toolbar" aria-label="圖的操作">
          <button type="button" data-mm="expand" data-overview-only title="展開每一通錄音">全部展開</button>
          <button type="button" data-mm="collapse" data-overview-only title="每一通錄音只留一個節點">全部收合</button>
          <button type="button" data-mm="relayout" title="清掉這個分頁拖曳過的位置，重新自動排版">重新排版</button>
        </div>
        <aside class="mm-panel" aria-live="polite"></aside>
      </div>
      <div class="mm-statusbar">
        <span class="mm-status-stats"></span>
        <span class="mm-status-help">
          <button type="button" class="mm-link" data-pop="legend" aria-expanded="false">圖例</button>
          <button type="button" class="mm-link" data-pop="keys" aria-expanded="false" title="快捷鍵（?）">快捷鍵 <kbd>?</kbd></button>
        </span>
        <div class="mm-pop" data-pop-body="legend" hidden>${LEGEND_HTML}</div>
        <div class="mm-pop" data-pop-body="keys" hidden>${KEYS_HTML}</div>
      </div>
    </div>`;
  const root = container.querySelector('.mm');
  const tabsEl = container.querySelector('.mm-tabs');
  const moreEl = container.querySelector('.mm-tab-more');
  const moreMenu = container.querySelector('.mm-tab-menu');
  const outlineEl = container.querySelector('.mm-outline');
  const statsEl = container.querySelector('.mm-status-stats');
  const nextBtn = container.querySelector('[data-mm="next-todo"]');
  const maxBtn = container.querySelector('[data-mm="max"]');
  const stage = container.querySelector('.mm-stage');
  const canvas = container.querySelector('.mm-canvas');
  const svg = container.querySelector('.mm-edges');
  const panel = container.querySelector('.mm-panel');

  const calls = () => getCalls?.() || [];
  const dayKey = () => getDay?.().key || '';
  const findCall = (id) => calls().find((c) => c.id === id);
  const findMarker = (callId, markerId) => findCall(callId)?.devMarkers?.find((m) => m.id === markerId);
  const selectedNode = () => graph.nodes.find((n) => n.id === selectedId) || null;
  const isOverview = () => activeTab === 'all';
  const isMap = () => view === 'map';
  const viewCalls = () => (isOverview() ? calls() : calls().filter((c) => c.id === activeTab));
  const posKey = (id) => (isOverview() ? id : `${TAB_POS_PREFIX}${id}`);
  const currentMarker = () => {
    const n = selectedNode();
    return n?.markerId ? { callId: n.callId, markerId: n.markerId } : null;
  };
  const focusKey = () => {
    const parts = String(selectedId || '').split(':');
    return parts.length >= 3 ? markerKey(parts[1], parts[2]) : null;
  };

  function readView() {
    try {
      return localStorage.getItem(VIEW_KEY) === 'map' ? 'map' : 'list';
    } catch {
      return 'list';
    }
  }

  function resolveTab() {
    const key = dayKey();
    if (key !== lastDayKey) {
      lastDayKey = key;
      activeTab = readStore(TAB_KEY)[key] || 'all';
      selectedId = null;
      collapsed.clear();
    }
    const tabs = mindmapTabs(calls());
    if (!tabs.some((t) => t.id === activeTab)) activeTab = 'all';
    return tabs;
  }

  function savedPositions() {
    const saved = {};
    viewCalls().forEach((c) => {
      Object.entries(c.mindmapPos || {}).forEach(([k, v]) => {
        const tabKey = k.startsWith(TAB_POS_PREFIX);
        if (isOverview() && !tabKey) saved[k] = v;
        else if (!isOverview() && tabKey) saved[k.slice(TAB_POS_PREFIX.length)] = v;
      });
    });
    if (isOverview()) {
      const r = loadRootPos(dayKey());
      if (r) saved.root = r;
    }
    return saved;
  }

  function nodeEl(n) {
    const el = document.createElement('div');
    const cls = ['mm-node', `mm-${n.type}`];
    if (n.empty) cls.push('empty');
    if (n.strength) cls.push(`s-${n.strength.level}`);
    if (n.id === selectedId) cls.push('sel');
    if (n.collapsed) cls.push('collapsed');
    if (n.type === 'marker' && n.expanded) cls.push('focus');
    el.className = cls.join(' ');
    el.dataset.id = n.id;
    el.style.left = `${positions[n.id].x}px`;
    el.style.top = `${positions[n.id].y}px`;
    const dot = n.type === 'marker' ? `<i class="mm-dot s-${n.level}" title="${escapeHTML(STRENGTH[n.level].label)}"></i>` : '';
    const badge = n.strength ? `<b class="mm-badge">${escapeHTML(n.strength.label)}</b>` : '';
    const more = n.hiddenCount ? `<span class="mm-more" title="點開看表層／真意／證據">+${n.hiddenCount}</span>` : '';
    const jump = (n.type === 'marker' || n.type === 'evidence') && n.sec != null ? `<button type="button" class="mm-jump" data-jump="${n.sec}" title="回放這段">▶ ${formatDuration(n.sec)}</button>` : '';
    const adds =
      n.type === 'marker' && n.expanded && n.missing?.length
        ? `<span class="mm-adds">${n.missing.map((k) => `<button type="button" class="mm-add-chip" data-add-step="${k}">${ADD_LABEL[k]}</button>`).join('')}</span>`
        : '';
    el.innerHTML = `<span class="mm-node-sub"><span>${dot}${escapeHTML(n.sub || '')}</span>${badge}${more}</span><span class="mm-node-label">${escapeHTML(truncate(n.label, 90))}</span>${jump}${adds}`;
    el.title = n.type === 'call' ? (isOverview() ? '點擊收合／展開這通；雙擊開啟這通的分頁' : '') : n.type === 'root' ? '' : '點擊編輯，拖曳移動';
    return el;
  }

  function drawEdges() {
    if (!isMap()) return;
    const byId = new Map();
    canvas.querySelectorAll('.mm-node').forEach((el) => byId.set(el.dataset.id, el));
    svg.setAttribute('width', canvas.style.width);
    svg.setAttribute('height', canvas.style.height);
    svg.innerHTML = graph.edges
      .map((e) => {
        const a = byId.get(e.from);
        const b = byId.get(e.to);
        if (!a || !b) return '';
        const x1 = a.offsetLeft + a.offsetWidth;
        const y1 = a.offsetTop + a.offsetHeight / 2;
        const x2 = b.offsetLeft;
        const y2 = b.offsetTop + b.offsetHeight / 2;
        const mx = (x1 + x2) / 2;
        return `<path class="mm-edge" d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}"/>`;
      })
      .join('');
  }

  // 全貌檢視的抽屜蓋在畫布右邊；多留這段寬度，最右邊的節點才捲得到抽屜左側
  const drawerSpace = () => (isMap() && !maximized && selectedNode() ? 360 : 0);

  function growCanvas() {
    let w = parseInt(canvas.style.width, 10) || 0;
    let h = parseInt(canvas.style.height, 10) || 0;
    canvas.querySelectorAll('.mm-node').forEach((el) => {
      w = Math.max(w, el.offsetLeft + el.offsetWidth + 24 + drawerSpace());
      h = Math.max(h, el.offsetTop + el.offsetHeight + 24);
    });
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }

  function tabHtml(t, { menu = false } = {}) {
    const on = t.id === activeTab;
    const pct = t.stats.total ? Math.round((t.stats.solid / t.stats.total) * 100) : 0;
    const meter = t.stats.total ? `<span class="mm-tab-meter" aria-hidden="true"><i style="width:${pct}%"></i></span>` : '';
    const title = `${t.title}${t.stats.total ? `｜證據充分 ${t.stats.solid} / 話點 ${t.stats.total}` : ''}`;
    const role = menu ? 'menuitem' : 'tab';
    return `<button type="button" role="${role}" class="mm-tab${on ? ' active' : ''}${t.id === 'all' ? ' overview' : ''}" aria-selected="${on}" tabindex="${on || menu ? 0 : -1}" data-tab="${escapeHTML(t.id)}" title="${escapeHTML(title)}"><span class="mm-tab-label">${escapeHTML(t.label)}</span><span class="mm-tab-n">${t.stats.solid}/${t.stats.total}</span>${meter}</button>`;
  }

  let lastTabs = [];
  function renderTabs(tabs) {
    lastTabs = tabs;
    tabsEl.innerHTML = tabs.map((t) => tabHtml(t)).join('');
    root.querySelectorAll('[data-overview-only]').forEach((b) => {
      b.hidden = !isOverview();
    });
    fitTabs();
  }

  function fitTabs() {
    const btns = [...tabsEl.querySelectorAll('.mm-tab')];
    btns.forEach((b) => (b.hidden = false));
    moreEl.hidden = true;
    moreEl.open = false;
    if (!btns.length || !tabsEl.clientWidth) return;
    const widths = btns.map((b) => b.offsetWidth + 2);
    const keep = lastTabs.findIndex((t) => t.id === activeTab);
    const hidden = overflowTabs(widths, tabsEl.clientWidth, 84, keep);
    if (!hidden.length) return;
    hidden.forEach((i) => (btns[i].hidden = true));
    moreEl.hidden = false;
    moreEl.querySelector('summary').textContent = `更多 ${hidden.length} ▾`;
    moreMenu.innerHTML = hidden.map((i) => tabHtml(lastTabs[i], { menu: true })).join('');
  }

  function renderOutline() {
    const all = markerOutline(viewCalls());
    const items = todoOnly ? all.filter((o) => o.level !== 'solid') : all;
    const cur = currentMarker();
    if (!items.length) {
      outlineEl.innerHTML = `<li class="hint mm-outline-empty">${all.length ? '這個分頁的話點證據都充分了。' : '還沒有話點。播放錄音時按 M 標記。'}</li>`;
      return;
    }
    let lastCall = null;
    outlineEl.innerHTML = items
      .map((o) => {
        const head =
          isOverview() && o.callId !== lastCall
            ? `<li class="mm-outline-call" title="${escapeHTML(o.callName)}">${escapeHTML(o.startTime ? `${o.startTime} · ` : '')}${escapeHTML(truncate(o.callName, 22))}</li>`
            : '';
        lastCall = o.callId;
        const sel = sameMarker(o, cur) ? ' sel' : '';
        return `${head}<li><button type="button" class="mm-outline-item s-${o.level}${sel}" data-mk="${escapeHTML(o.callId)}|${escapeHTML(o.markerId)}" title="${escapeHTML(STRENGTH[o.level].label)}">
          <i class="mm-dot s-${o.level}"></i><span class="mm-outline-time">${formatDuration(o.sec)}</span>
          <span class="mm-outline-text${o.text ? '' : ' empty'}">${escapeHTML(truncate(o.text || '（還沒寫筆記）', 40))}</span>
          <span class="mm-outline-ev" title="證據數">${o.evidenceCount}</span></button></li>`;
      })
      .join('');
  }

  function renderStatus() {
    const s = markerStats(viewCalls());
    statsEl.textContent = s.total ? `話點 ${s.total} · 證據充分 ${s.solid} · 待補 ${s.todo}` : '還沒有話點';
    nextBtn.querySelector('.mm-next-count').textContent = s.todo ? String(s.todo) : '';
    nextBtn.disabled = !s.todo;
  }

  function buildGraph() {
    const day = getDay?.() || {};
    graph = buildMindmap(viewCalls(), { dayLabel: day.label || '當天', collapsed, single: !isOverview(), focus: focusKey() });
    if (selectedId && !graph.nodes.some((n) => n.id === selectedId)) {
      const parts = selectedId.split(':');
      const mk = parts.length >= 3 ? `mk:${parts[1]}:${parts[2]}` : null;
      selectedId = mk && graph.nodes.some((n) => n.id === mk) ? mk : null;
      if (!selectedId) graph = buildMindmap(viewCalls(), { dayLabel: day.label || '當天', collapsed, single: !isOverview(), focus: null });
    }
  }

  function renderNodes() {
    buildGraph();
    drawnFocus = focusKey();
    canvas.querySelectorAll('.mm-node, .mm-empty').forEach((el) => el.remove());
    if (!isMap()) {
      svg.innerHTML = '';
      return;
    }
    const layout = autoLayout(graph, savedPositions());
    positions = layout.positions;
    canvas.style.width = `${layout.width + drawerSpace()}px`;
    canvas.style.height = `${layout.height}px`;
    graph.nodes.forEach((n) => canvas.appendChild(nodeEl(n)));
    if (!graph.nodes.some((n) => n.type === 'call')) {
      const empty = document.createElement('p');
      empty.className = 'mm-empty hint';
      empty.textContent = '還沒有話點。播放上面的錄音、在關鍵句按 M 標記，這裡就會長出心智圖。';
      canvas.appendChild(empty);
    }
    growCanvas();
    drawEdges();
  }

  function updateSelection() {
    if (focusKey() !== drawnFocus) renderNodes();
    else canvas.querySelectorAll('.mm-node').forEach((el) => el.classList.toggle('sel', el.dataset.id === selectedId));
    root.classList.toggle('has-sel', !!selectedNode());
    renderOutline();
  }

  function strengthHtml(st) {
    return `<div class="mm-strength s-${st.level}" title="${escapeHTML(st.hint)}"><i class="mm-dot s-${st.level}"></i><b>${escapeHTML(st.label)}</b><small>原句 ${st.quotes} · 行為 ${st.behaviors}</small></div>`;
  }

  function stepSummary(step, m) {
    const a = normalizeMarkerAnalysis(m);
    if (step.id === 'evidence') {
      const q = a.evidence.filter((e) => e.kind === 'quote').length;
      return a.evidence.length ? `原句 ${q} · 行為 ${a.evidence.length - q}` : '';
    }
    const v = step.id === 'text' ? String(m.text || '') : a[step.id];
    return v.trim();
  }

  function stepHeadHtml(step, i, m) {
    const sum = stepSummary(step, m);
    return `<button type="button" class="mm-step-head" data-open-step="${step.id}" aria-expanded="${openStep === step.id}">
      <span class="mm-step-n">${sum ? '✓' : i + 1}</span><span class="mm-step-title">${step.title}</span>
      <span class="mm-step-sum${sum ? '' : ' empty'}">${escapeHTML(sum ? truncate(sum, 60) : '還沒填')}</span></button>`;
  }

  function evidenceBodyHtml(call, m, a, st) {
    const transcript = Array.isArray(call.transcript) ? call.transcript : [];
    const sec = Number(m.sec) || 0;
    suggestions = suggestEvidence(transcript, sec);
    const evItems = a.evidence
      .map(
        (e) => `<li class="mm-ev ${e.kind}">
          <span class="mm-ev-kind">${EVIDENCE_KINDS[e.kind]}${e.spk ? `·${SPK_LABEL[e.spk]}` : ''}</span>
          ${e.sec != null ? `<button type="button" class="ctp-jump" data-jump="${e.sec}">${formatDuration(e.sec)}</button>` : ''}
          <span class="mm-ev-text">${escapeHTML(e.text)}</span>
          <button type="button" class="mm-ev-del" data-del-ev="${escapeHTML(e.id)}" title="移除這個證據" aria-label="移除這個證據">×</button>
        </li>`
      )
      .join('');
    const used = new Set(a.evidence.map((e) => `${e.sec}|${e.text}`));
    const suggList = suggestions.length
      ? `<ul class="mm-sugg-list">${suggestions
          .map(
            (s, i) => `<li><button type="button" class="mm-sugg ${s.spk === 'C' ? 'cust' : ''}${used.has(`${s.sec}|${s.text}`) ? ' used' : ''}" data-sugg="${i}" title="加入為原句證據">
              <span class="mm-sugg-time">${formatDuration(s.sec)}</span><span class="mm-sugg-spk">${s.spk ? SPK_LABEL[s.spk] : '？'}</span><span class="mm-sugg-text">${escapeHTML(s.text)}</span></button></li>`
          )
          .join('')}</ul>`
      : `<p class="hint">${transcript.length ? `這段前後 ${SUGGEST_WINDOW_SEC} 秒內沒有逐字稿句子，回放後手動抄下原句。` : '這通還沒轉錄——先在上方「批次分析所選」轉成逐字稿，或回放後手動抄下客戶原句。'}</p>`;
    return `
      <ul class="mm-ev-list">${evItems || `<li class="hint mm-ev-none">${escapeHTML(st.level === 'empty' ? STRENGTH.none.hint : st.hint)}</li>`}</ul>
      <details class="mm-sugg-box"${suggOpen ? ' open' : ''}><summary>從逐字稿挑原句${suggestions.length ? ` <span class="slog-count">${suggestions.length}</span>` : ''}</summary>${suggList}</details>
      <form class="mm-add">
        <select class="field" data-add="kind" aria-label="證據類型"><option value="quote">原句</option><option value="behavior">行為</option></select>
        <input type="text" class="field mm-add-sec" data-add="sec" inputmode="numeric" value="${formatDuration(sec)}" title="證據出現的時間（m:ss，可改）" aria-label="時間">
        <input type="text" class="field" data-add="text" placeholder="客戶原句，或你聽到的行為（例：停頓 3 秒才回答）" aria-label="證據內容">
        <button type="submit" class="btn slog-mini">加入</button>
      </form>`;
  }

  function renderPanel() {
    const node = selectedNode();
    const call = node?.callId ? findCall(node.callId) : null;
    const m = node?.markerId ? findMarker(node.callId, node.markerId) : null;
    root.classList.toggle('has-sel', !!(node && call && m));
    if (!node || !call || !m) {
      suggestions = [];
      stepFor = null;
      panel.innerHTML = `<p class="hint mm-panel-intro">${isMap() ? '點圖上任一個話點，這裡會打開它的整理步驟。' : '從左邊點一個話點開始整理。'}</p>`;
      return;
    }
    const key = markerKey(call.id, m.id);
    if (stepFor !== key) {
      stepFor = key;
      openStep = firstOpenStep(m);
      suggOpen = !normalizeEvidence(m.evidence).length;
    }
    const a = normalizeMarkerAnalysis(m);
    const st = evidenceStrength(m);
    const sec = Number(m.sec) || 0;
    const steps = STEPS.map((step, i) => {
      const body =
        step.id === 'evidence'
          ? evidenceBodyHtml(call, m, a, st)
          : `<textarea class="field" data-field="${step.field}" rows="3" placeholder="${escapeHTML(step.placeholder)}" aria-label="${step.title}">${escapeHTML(step.id === 'text' ? String(m.text || '') : a[step.id])}</textarea>`;
      return `<li class="mm-step${openStep === step.id ? ' open' : ''}" data-step="${step.id}">${stepHeadHtml(step, i, m)}<div class="mm-step-body">${body}</div></li>`;
    }).join('');
    panel.innerHTML = `
      <div class="mm-panel-head">
        <span class="mm-panel-call" title="${escapeHTML(call.name || '')}">${escapeHTML(call.startTime ? `${call.startTime} · ` : '')}${escapeHTML(truncate(call.name || '錄音', 28))}</span>
        <button type="button" class="ctp-jump" data-jump="${sec}">▶ ${formatDuration(sec)} 回放</button>
        <button type="button" class="mm-icon-btn mm-panel-close" data-mm-close title="關閉（Esc）" aria-label="關閉">×</button>
      </div>
      <div class="mm-strength-slot">${strengthHtml(st)}</div>
      <ol class="mm-steps">${steps}</ol>`;
  }

  function refreshStepHeads() {
    const node = selectedNode();
    const m = node?.markerId ? findMarker(node.callId, node.markerId) : null;
    if (!m) return;
    STEPS.forEach((step, i) => {
      const li = panel.querySelector(`.mm-step[data-step="${step.id}"]`);
      const head = li?.querySelector('.mm-step-head');
      if (head) head.outerHTML = stepHeadHtml(step, i, m);
    });
    const slot = panel.querySelector('.mm-strength-slot');
    if (slot) slot.innerHTML = strengthHtml(evidenceStrength(m));
  }

  function setStep(id, { focus = true } = {}) {
    openStep = id;
    panel.querySelectorAll('.mm-step').forEach((li) => {
      const on = li.dataset.step === id;
      li.classList.toggle('open', on);
      li.querySelector('.mm-step-head')?.setAttribute('aria-expanded', String(on));
    });
    if (!focus) return;
    const li = panel.querySelector(`.mm-step[data-step="${id}"]`);
    const target = li?.querySelector(id === 'evidence' ? '[data-add="text"]' : 'textarea');
    target?.focus?.({ preventScroll: true });
    li?.scrollIntoView?.({ block: 'nearest' });
  }

  function autoSelect() {
    if (isMap() || selectedNode()) return;
    const outline = markerOutline(viewCalls());
    const first = nextTodoMarker(outline, null) || outline[0];
    if (!first) return;
    selectedId = `mk:${first.callId}:${first.markerId}`;
    buildGraph();
  }

  function render() {
    const tabs = resolveTab();
    renderTabs(tabs);
    buildGraph();
    autoSelect();
    renderNodes();
    renderOutline();
    renderStatus();
    renderPanel();
  }

  function refreshCounts() {
    renderTabs(mindmapTabs(calls()));
    renderOutline();
    renderStatus();
  }

  function setView(next) {
    if (next === view) return;
    view = next;
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* ignore */
    }
    root.classList.toggle('view-map', isMap());
    root.classList.toggle('view-list', !isMap());
    root.querySelectorAll('[data-mm-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mmView === view)));
    render();
    if (isMap() && selectedId) scrollToNode(selectedId);
  }

  function setTab(id, { keepScroll = false } = {}) {
    if (id === activeTab) return;
    activeTab = id;
    writeStore(TAB_KEY, dayKey(), id === 'all' ? null : id);
    render();
    if (!keepScroll) stage.scrollTo?.({ left: 0, top: 0 });
    tabsEl.querySelector('.mm-tab.active')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  function cycleTab(dir) {
    const tabs = mindmapTabs(calls());
    const idx = Math.max(0, tabs.findIndex((t) => t.id === activeTab));
    setTab(tabs[(idx + dir + tabs.length) % tabs.length].id);
  }

  function scrollToNode(id) {
    const el = canvas.querySelector(`.mm-node[data-id="${CSS?.escape ? CSS.escape(id) : id}"]`);
    if (!el) return;
    const covered = isMap() && !maximized && root.classList.contains('has-sel') ? panel.offsetWidth : 0;
    const visibleW = Math.max(el.offsetWidth, stage.clientWidth - covered);
    const left = el.offsetLeft - Math.max(16, (visibleW - el.offsetWidth) / 2);
    const top = el.offsetTop - stage.clientHeight / 2 + el.offsetHeight / 2;
    stage.scrollTo?.({ left: Math.max(0, left), top: Math.max(0, top), behavior: 'smooth' });
  }

  function selectMarker(target, { step = null } = {}) {
    if (!target) return;
    if (!isOverview() && target.callId !== activeTab) {
      activeTab = target.callId;
      writeStore(TAB_KEY, dayKey(), target.callId);
    }
    if (isOverview() && collapsed.has(target.callId)) collapsed.delete(target.callId);
    selectedId = `mk:${target.callId}:${target.markerId}`;
    render();
    scrollToNode(selectedId);
    outlineEl.querySelector('.mm-outline-item.sel')?.scrollIntoView?.({ block: 'nearest' });
    if (step) setStep(step);
  }

  function clearSelection() {
    selectedId = null;
    renderNodes();
    renderOutline();
    renderPanel();
  }

  function commitMarker(callId, markerId, patch) {
    const call = findCall(callId);
    if (!call) return;
    call.devMarkers = (call.devMarkers || []).map((m) => (m.id === markerId ? { ...m, ...patch } : m));
    onMarkerChange?.(callId, call.devMarkers);
  }

  function persistPosition(id) {
    const node = graph.nodes.find((n) => n.id === id);
    if (!node) return;
    if (node.type === 'root') {
      writeStore(ROOT_POS_KEY, dayKey(), positions.root);
      return;
    }
    const call = findCall(node.callId);
    if (!call) return;
    const next = { ...(call.mindmapPos || {}) };
    Object.entries(positionsForCall(graph, positions, node.callId)).forEach(([k, v]) => {
      next[posKey(k)] = v;
    });
    call.mindmapPos = next;
    onPositionsChange?.(node.callId, next);
  }

  function setMaximized(on) {
    maximized = on;
    // 卡片有 backdrop-filter，會讓 position:fixed 只相對卡片定位；最大化時把視窗移到 body 底下
    if (on) {
      document.body.appendChild(root);
      hideWatch = new MutationObserver(() => {
        if (!container.isConnected || container.offsetParent === null) setMaximized(false);
      });
      hideWatch.observe(document.body, { attributes: true, attributeFilter: ['hidden'], subtree: true });
    } else {
      hideWatch?.disconnect();
      hideWatch = null;
      container.appendChild(root);
    }
    root.classList.toggle('max', on);
    document.body.classList.toggle('mm-max-open', on);
    maxBtn.setAttribute('aria-pressed', String(on));
    maxBtn.textContent = on ? '⤡' : '⤢';
    maxBtn.setAttribute('aria-label', on ? '還原' : '最大化');
    maxBtn.title = on ? '還原視窗（F／Esc）' : '最大化視窗（F）';
    fitTabs();
    renderNodes();
    root.focus({ preventScroll: true });
  }

  const STEP_OF_NODE = { surface: 'surface', intent: 'intent', evidence: 'evidence' };

  function onNodeClick(id) {
    const node = graph.nodes.find((n) => n.id === id);
    if (!node) return;
    if (node.type === 'root') return;
    if (node.type === 'call') {
      if (!isOverview()) return;
      if (collapsed.has(node.callId)) collapsed.delete(node.callId);
      else collapsed.add(node.callId);
      render();
      return;
    }
    const wasFocus = focusKey();
    selectedId = id;
    updateSelection();
    renderPanel();
    if (node.type !== 'marker') setStep(STEP_OF_NODE[node.type] || 'evidence');
    if (wasFocus !== focusKey()) scrollToNode(selectedId);
  }

  function showPop(name) {
    root.querySelectorAll('[data-pop-body]').forEach((p) => {
      p.hidden = p.dataset.popBody !== name || !p.hidden;
    });
    root.querySelectorAll('[data-pop]').forEach((b) => {
      b.setAttribute('aria-expanded', String(!root.querySelector(`[data-pop-body="${b.dataset.pop}"]`).hidden));
    });
  }
  const anyPopOpen = () => [...root.querySelectorAll('[data-pop-body]')].some((p) => !p.hidden);

  /* ---- 拖曳 ---- */
  canvas.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.mm-node');
    if (!el || e.button !== 0 || e.target.closest('button')) return;
    const p = positions[el.dataset.id];
    if (!p) return;
    drag = { id: el.dataset.id, el, startX: e.clientX, startY: e.clientY, ox: p.x, oy: p.y, moved: false };
    el.setPointerCapture?.(e.pointerId);
    e.preventDefault();
    root.focus({ preventScroll: true });
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.el.classList.add('dragging');
    }
    const next = { x: Math.max(0, Math.round(drag.ox + dx)), y: Math.max(0, Math.round(drag.oy + dy)) };
    positions[drag.id] = next;
    drag.el.style.left = `${next.x}px`;
    drag.el.style.top = `${next.y}px`;
    drawEdges();
  });
  const endDrag = (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.el.classList.remove('dragging');
    d.el.releasePointerCapture?.(e.pointerId);
    if (d.moved) {
      growCanvas();
      drawEdges();
      persistPosition(d.id);
    } else if (e.type === 'pointerup') {
      onNodeClick(d.id);
    }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('click', (e) => {
    const el = e.target.closest('.mm-node');
    const node = graph.nodes.find((n) => n.id === el?.dataset.id);
    if (!node) return;
    const chip = e.target.closest('[data-add-step]');
    if (chip) {
      selectedId = node.id;
      updateSelection();
      renderPanel();
      setStep(chip.dataset.addStep);
      return;
    }
    const jump = e.target.closest('[data-jump]');
    if (jump && node.callId) onJump?.(node.callId, Number(jump.dataset.jump) || 0);
  });

  canvas.addEventListener('dblclick', (e) => {
    const el = e.target.closest('.mm-call');
    const node = graph.nodes.find((n) => n.id === el?.dataset.id);
    if (node && isOverview()) {
      collapsed.delete(node.callId);
      setTab(node.callId);
    }
  });

  /* ---- 分頁、工具列、清單 ---- */
  const onTabClick = (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) setTab(tab.dataset.tab);
  };
  tabsEl.addEventListener('click', onTabClick);
  moreMenu.addEventListener('click', onTabClick);
  const onDocPointerDown = (e) => {
    if (moreEl.open && !moreEl.contains(e.target)) moreEl.open = false;
    if (anyPopOpen() && !e.target.closest('.mm-pop, [data-pop]')) showPop(null);
  };
  document.addEventListener('pointerdown', onDocPointerDown);

  tabsEl.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    cycleTab(e.key === 'ArrowRight' ? 1 : -1);
    tabsEl.querySelector('.mm-tab.active')?.focus();
  });

  const resizeWatch = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fitTabs()) : null;
  resizeWatch?.observe(tabsEl.parentElement);

  root.querySelector('.mm-view').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mm-view]');
    if (b) setView(b.dataset.mmView);
  });

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mm]');
    if (!btn || !root.contains(btn)) return;
    const act = btn.dataset.mm;
    if (act === 'max') {
      setMaximized(!maximized);
      return;
    }
    if (act === 'next-todo') {
      const next = nextTodoMarker(markerOutline(viewCalls()), currentMarker());
      selectMarker(next, { step: next ? firstOpenStep(findMarker(next.callId, next.markerId)) : null });
      return;
    }
    if (act === 'expand') collapsed.clear();
    else if (act === 'collapse') calls().forEach((c) => (c.devMarkers || []).length && collapsed.add(c.id));
    else if (act === 'relayout') {
      if (isOverview()) writeStore(ROOT_POS_KEY, dayKey(), null);
      viewCalls().forEach((c) => {
        const keys = Object.keys(c.mindmapPos || {});
        const keep = keys.filter((k) => k.startsWith(TAB_POS_PREFIX) === isOverview());
        if (keep.length === keys.length) return;
        c.mindmapPos = Object.fromEntries(keep.map((k) => [k, c.mindmapPos[k]]));
        onPositionsChange?.(c.id, c.mindmapPos);
      });
    } else return;
    render();
    if (act === 'relayout') stage.scrollTo?.({ left: 0, top: 0 });
  });

  root.querySelector('.mm-status-help').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pop]');
    if (b) showPop(b.dataset.pop);
  });

  outlineEl.addEventListener('click', (e) => {
    const item = e.target.closest('[data-mk]');
    if (!item) return;
    const [callId, markerId] = item.dataset.mk.split('|');
    selectMarker({ callId, markerId });
  });

  container.querySelector('[data-mm-filter]').addEventListener('change', (e) => {
    todoOnly = e.target.checked;
    renderOutline();
  });

  /* ---- 快捷鍵（焦點在視窗內才生效，不和播放器的 M／方向鍵搶） ---- */
  root.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, [contenteditable="true"]')) {
      if (e.key === 'Escape') {
        e.target.blur();
        root.focus({ preventScroll: true });
        e.stopPropagation();
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const outline = () => markerOutline(viewCalls());
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === '[') cycleTab(-1);
    else if (k === ']') cycleTab(1);
    else if (k === 'j') selectMarker(stepMarker(outline(), currentMarker(), 1));
    else if (k === 'k') selectMarker(stepMarker(outline(), currentMarker(), -1));
    else if (k === 'n') {
      const next = nextTodoMarker(outline(), currentMarker());
      selectMarker(next, { step: next ? firstOpenStep(findMarker(next.callId, next.markerId)) : null });
    } else if (k === 'v') setView(isMap() ? 'list' : 'map');
    else if (k === '?') showPop('keys');
    else if (k === 'f') setMaximized(!maximized);
    else if (k === 'Escape') {
      if (anyPopOpen()) showPop(null);
      else if (moreEl.open) moreEl.open = false;
      else if (isMap() && selectedId) clearSelection();
      else if (maximized) setMaximized(false);
      else return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
  });

  /* ---- 右側面板 ---- */
  function scheduleFieldSave(node, field, value) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      commitMarker(node.callId, node.markerId, { [field]: value });
      refreshStepHeads();
      renderNodes();
      refreshCounts();
    }, 300);
  }

  panel.addEventListener('input', (e) => {
    const ta = e.target.closest('textarea[data-field]');
    const node = selectedNode();
    if (!ta || !node) return;
    scheduleFieldSave(node, ta.dataset.field, ta.value);
  });

  panel.addEventListener(
    'toggle',
    (e) => {
      if (e.target.classList?.contains('mm-sugg-box')) suggOpen = e.target.open;
    },
    true
  );

  function addEvidence(node, ev) {
    const m = findMarker(node.callId, node.markerId);
    if (!m) return;
    const evidence = normalizeEvidence([...(m.evidence || []), ev]);
    commitMarker(node.callId, node.markerId, { evidence });
    openStep = 'evidence';
    render();
  }

  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-mm-close]')) {
      clearSelection();
      root.focus({ preventScroll: true });
      return;
    }
    const node = selectedNode();
    if (!node) return;
    const head = e.target.closest('[data-open-step]');
    if (head) {
      setStep(head.dataset.openStep);
      return;
    }
    const jump = e.target.closest('[data-jump]');
    if (jump) {
      onJump?.(node.callId, Number(jump.dataset.jump) || 0);
      return;
    }
    const sugg = e.target.closest('[data-sugg]');
    if (sugg) {
      const s = suggestions[Number(sugg.dataset.sugg)];
      if (s) addEvidence(node, { kind: 'quote', text: s.text, sec: s.sec, spk: s.spk, source: 'transcript' });
      return;
    }
    const del = e.target.closest('[data-del-ev]');
    if (del) {
      const m = findMarker(node.callId, node.markerId);
      if (!m) return;
      commitMarker(node.callId, node.markerId, { evidence: normalizeEvidence(m.evidence).filter((x) => x.id !== del.dataset.delEv) });
      openStep = 'evidence';
      render();
    }
  });

  panel.addEventListener('submit', (e) => {
    const form = e.target.closest('.mm-add');
    if (!form) return;
    e.preventDefault();
    const node = selectedNode();
    if (!node) return;
    const text = form.querySelector('[data-add="text"]').value.trim();
    if (!text) return;
    const kind = form.querySelector('[data-add="kind"]').value;
    const sec = parseTimeInput(form.querySelector('[data-add="sec"]').value);
    addEvidence(node, { kind, text, sec, source: 'manual' });
    panel.querySelector('[data-add="text"]')?.focus?.();
  });

  root.querySelectorAll('[data-mm-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mmView === view)));
  render();

  return {
    refresh: render,
    /** 播放器新增標記時，切到那通的分頁並選中新話點 */
    showMarker(callId, markerId) {
      if (!findMarker(callId, markerId)) return;
      if (!isOverview()) {
        activeTab = callId;
        writeStore(TAB_KEY, dayKey(), callId);
      }
      if (collapsed.has(callId)) collapsed.delete(callId);
      selectedId = `mk:${callId}:${markerId}`;
      render();
      scrollToNode(selectedId);
    },
    select(callId, markerId) {
      selectMarker({ callId, markerId });
    },
    destroy() {
      clearTimeout(saveTimer);
      hideWatch?.disconnect();
      resizeWatch?.disconnect();
      document.removeEventListener('pointerdown', onDocPointerDown);
      document.body.classList.remove('mm-max-open');
      root.remove();
      container.innerHTML = '';
    },
  };
}
