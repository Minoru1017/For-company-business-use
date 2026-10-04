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

/**
 * 把當天有標記的錄音展開成樹：root → 錄音 → 話點 → {表層, 真意 → 證據}
 * @param {Array} calls 含 devMarkers 的錄音
 * @param {{dayLabel?:string, collapsed?:Set<string>}} opts collapsed：收合的 callId
 */
export function buildMindmap(calls, { dayLabel = '當天', collapsed = new Set(), single = false } = {}) {
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
      });
      add({
        ...base,
        id: `sf:${c.id}:${m.id}`,
        type: 'surface',
        depth: 3,
        parent: mk.id,
        label: a.surface.trim() || '客戶字面上說了什麼？',
        sub: '表層資訊',
        empty: !a.surface.trim(),
      });
      const intent = add({
        ...base,
        id: `in:${c.id}:${m.id}`,
        type: 'intent',
        depth: 3,
        parent: mk.id,
        label: a.intent.trim() || '他真正想傳達的是？',
        sub: '內心真意',
        empty: !a.intent.trim(),
        strength,
      });
      if (!a.evidence.length) {
        add({
          ...base,
          id: `nv:${c.id}:${m.id}`,
          type: 'noevidence',
          depth: 4,
          parent: intent.id,
          label: '還沒有證據——回放這段找原句',
          sub: '證據',
          empty: true,
        });
        return;
      }
      a.evidence.forEach((e) => {
        const who = e.spk === 'C' ? ' · 客戶' : e.spk === 'S' ? ' · 我' : '';
        add({
          ...base,
          id: `ev:${c.id}:${m.id}:${e.id}`,
          type: 'evidence',
          depth: 4,
          parent: intent.id,
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
  let row = 0;
  const place = (id, depth) => {
    const kids = children.get(id) || [];
    let y;
    if (!kids.length) {
      y = padY + row * rowH;
      row += 1;
    } else {
      const ys = kids.map((k) => place(k, depth + 1));
      y = (ys[0] + ys[ys.length - 1]) / 2;
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

const LEGEND_HTML = `<span class="mm-legend"><i class="mm-dot s-solid"></i>證據充分 <i class="mm-dot s-weak"></i>證據單薄 <i class="mm-dot s-none"></i>只有「我覺得」 <i class="mm-dot s-empty"></i>尚未推論</span>`;

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

  container.innerHTML = `
    <div class="mm" tabindex="-1">
      <div class="mm-titlebar">
        <div class="mm-tabs" role="tablist" aria-label="心智圖分頁"></div>
        <span class="mm-toolbar-actions">
          <button type="button" class="btn slog-mini mm-next" data-mm="next-todo" title="跳到下一個還沒有充分證據的話點（N）">下一個待補 <b class="mm-next-count"></b></button>
          <button type="button" class="btn slog-mini" data-mm="expand" data-overview-only>全部展開</button>
          <button type="button" class="btn slog-mini" data-mm="collapse" data-overview-only>全部收合</button>
          <button type="button" class="btn slog-mini" data-mm="relayout" title="清掉這個分頁拖曳過的位置，重新自動排版">重新排版</button>
          <button type="button" class="btn slog-mini mm-max-btn" data-mm="max" aria-pressed="false" title="最大化視窗（F）">最大化</button>
        </span>
      </div>
      <div class="mm-body">
        <nav class="mm-explorer" aria-label="話點清單">
          <div class="mm-explorer-head"><span>話點</span><label class="mm-todo-toggle"><input type="checkbox" data-mm-filter> 只看待補</label></div>
          <ul class="mm-outline"></ul>
        </nav>
        <div class="mm-stage"><div class="mm-canvas"><svg class="mm-edges" aria-hidden="true"></svg></div></div>
        <aside class="mm-panel" aria-live="polite"></aside>
      </div>
      <div class="mm-statusbar">
        <span class="mm-status-stats"></span>
        ${LEGEND_HTML}
        <span class="mm-keys"><kbd>[</kbd><kbd>]</kbd> 切分頁 · <kbd>J</kbd><kbd>K</kbd> 上下話點 · <kbd>N</kbd> 下一個待補 · <kbd>F</kbd> 最大化 · <kbd>Esc</kbd> 離開輸入／還原</span>
      </div>
    </div>`;
  const root = container.querySelector('.mm');
  const tabsEl = container.querySelector('.mm-tabs');
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
  const viewCalls = () => (isOverview() ? calls() : calls().filter((c) => c.id === activeTab));
  const posKey = (id) => (isOverview() ? id : `${TAB_POS_PREFIX}${id}`);
  const currentMarker = () => {
    const n = selectedNode();
    return n?.markerId ? { callId: n.callId, markerId: n.markerId } : null;
  };

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
    el.className = cls.join(' ');
    el.dataset.id = n.id;
    el.style.left = `${positions[n.id].x}px`;
    el.style.top = `${positions[n.id].y}px`;
    const badge = n.strength ? `<b class="mm-badge">${escapeHTML(n.strength.label)}</b>` : '';
    const jump = (n.type === 'marker' || n.type === 'evidence') && n.sec != null ? `<button type="button" class="mm-jump" data-jump="${n.sec}" title="回放這段">▶ ${formatDuration(n.sec)}</button>` : '';
    el.innerHTML = `<span class="mm-node-sub">${escapeHTML(n.sub || '')}${badge}</span><span class="mm-node-label">${escapeHTML(truncate(n.label, 90))}</span>${jump}`;
    el.title = n.type === 'call' ? (isOverview() ? '點擊收合／展開這通；雙擊開啟這通的分頁' : '') : n.type === 'root' ? '' : '點擊編輯，拖曳移動';
    return el;
  }

  function drawEdges() {
    const byId = new Map();
    canvas.querySelectorAll('.mm-node').forEach((el) => byId.set(el.dataset.id, el));
    const typeOf = new Map(graph.nodes.map((n) => [n.id, n]));
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
        const child = typeOf.get(e.to);
        const cls = `mm-edge${child?.strength ? ` s-${child.strength.level}` : ''}${child?.type === 'noevidence' ? ' dashed' : ''}`;
        return `<path class="${cls}" d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}"/>`;
      })
      .join('');
  }

  function growCanvas() {
    let w = parseInt(canvas.style.width, 10) || 0;
    let h = parseInt(canvas.style.height, 10) || 0;
    canvas.querySelectorAll('.mm-node').forEach((el) => {
      w = Math.max(w, el.offsetLeft + el.offsetWidth + 24);
      h = Math.max(h, el.offsetTop + el.offsetHeight + 24);
    });
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }

  function renderTabs(tabs) {
    tabsEl.innerHTML = tabs
      .map((t) => {
        const on = t.id === activeTab;
        const prog = t.stats.total ? `<span class="mm-tab-prog s-${t.stats.worst}" title="證據充分 ${t.stats.solid} / 話點 ${t.stats.total}">${t.stats.solid}/${t.stats.total}</span>` : '';
        return `<button type="button" role="tab" class="mm-tab${on ? ' active' : ''}${t.id === 'all' ? ' overview' : ''}" aria-selected="${on}" tabindex="${on ? 0 : -1}" data-tab="${escapeHTML(t.id)}" title="${escapeHTML(t.title)}"><span class="mm-tab-label">${escapeHTML(t.label)}</span>${prog}</button>`;
      })
      .join('');
    container.querySelectorAll('[data-overview-only]').forEach((b) => {
      b.hidden = !isOverview();
    });
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
        return `${head}<li><button type="button" class="mm-outline-item s-${o.level}${sel}" data-mk="${escapeHTML(o.callId)}|${escapeHTML(o.markerId)}">
          <i class="mm-dot s-${o.level}"></i><span class="mm-outline-time">${formatDuration(o.sec)}</span>
          <span class="mm-outline-text${o.text ? '' : ' empty'}">${escapeHTML(truncate(o.text || '（還沒寫筆記）', 40))}</span>
          <span class="mm-outline-ev" title="證據數">${o.evidenceCount}</span></button></li>`;
      })
      .join('');
  }

  function renderStatus() {
    const s = markerStats(viewCalls());
    statsEl.textContent = `話點 ${s.total} · 充分 ${s.solid} · 單薄 ${s.weak} · 只有我覺得 ${s.none} · 尚未推論 ${s.empty}`;
    nextBtn.querySelector('.mm-next-count').textContent = s.todo ? String(s.todo) : '';
    nextBtn.disabled = !s.todo;
  }

  function renderNodes() {
    const day = getDay?.() || {};
    graph = buildMindmap(viewCalls(), { dayLabel: day.label || '當天', collapsed, single: !isOverview() });
    const layout = autoLayout(graph, savedPositions());
    positions = layout.positions;
    canvas.style.width = `${layout.width}px`;
    canvas.style.height = `${layout.height}px`;
    canvas.querySelectorAll('.mm-node, .mm-empty').forEach((el) => el.remove());
    if (selectedId && !graph.nodes.some((n) => n.id === selectedId)) selectedId = null;
    graph.nodes.forEach((n) => canvas.appendChild(nodeEl(n)));
    if (!graph.nodes.some((n) => n.type === 'call')) {
      const empty = document.createElement('p');
      empty.className = 'mm-empty hint';
      empty.textContent = '還沒有話點。播放上面的錄音、在關鍵句按 M 標記，這裡就會長出可拖曳的心智圖。';
      canvas.appendChild(empty);
    }
    growCanvas();
    drawEdges();
  }

  function updateSelection() {
    canvas.querySelectorAll('.mm-node').forEach((el) => el.classList.toggle('sel', el.dataset.id === selectedId));
    renderOutline();
  }

  function strengthHtml(st) {
    return `<div class="mm-strength s-${st.level}"><b>${escapeHTML(st.label)}</b><span>${escapeHTML(st.hint)}</span><small>原句 ${st.quotes} · 行為 ${st.behaviors}</small></div>`;
  }

  function renderPanel() {
    const node = selectedNode();
    const call = node?.callId ? findCall(node.callId) : null;
    const m = node?.markerId ? findMarker(node.callId, node.markerId) : null;
    if (!node || !call || !m) {
      suggestions = [];
      panel.innerHTML = `
        <p class="hint mm-panel-intro">從左邊清單或圖上點一個話點開始；<kbd>J</kbd>/<kbd>K</kbd> 上下切換，<kbd>N</kbd> 直接跳到下一個還缺證據的話點。</p>
        <p class="hint mm-panel-intro"><b>原則：</b>「內心真意」是推論。沒有客戶原句（逐字稿）或行為（停頓、回答變短、語氣轉變）當證據，就只是「我覺得」，不能寫進複盤。</p>`;
      return;
    }
    const a = normalizeMarkerAnalysis(m);
    const st = evidenceStrength(m);
    const transcript = Array.isArray(call.transcript) ? call.transcript : [];
    const sec = Number(m.sec) || 0;
    suggestions = suggestEvidence(transcript, sec);
    const evItems = a.evidence
      .map(
        (e) => `<li class="mm-ev ${e.kind}">
          <span class="mm-ev-kind">${EVIDENCE_KINDS[e.kind]}${e.spk ? `·${SPK_LABEL[e.spk]}` : ''}</span>
          ${e.sec != null ? `<button type="button" class="ctp-jump" data-jump="${e.sec}">${formatDuration(e.sec)}</button>` : ''}
          <span class="mm-ev-text">${escapeHTML(e.text)}</span>
          <button type="button" class="btn slog-mini mm-ev-del" data-del-ev="${escapeHTML(e.id)}" title="移除這個證據">刪</button>
        </li>`
      )
      .join('');
    const used = new Set(a.evidence.map((e) => `${e.sec}|${e.text}`));
    const suggHtml = suggestions.length
      ? `<ul class="mm-sugg-list">${suggestions
          .map(
            (s, i) => `<li><button type="button" class="mm-sugg ${s.spk === 'C' ? 'cust' : ''}${used.has(`${s.sec}|${s.text}`) ? ' used' : ''}" data-sugg="${i}" title="加入為原句證據">
              <span class="mm-sugg-time">${formatDuration(s.sec)}</span><span class="mm-sugg-spk">${s.spk ? SPK_LABEL[s.spk] : '？'}</span><span class="mm-sugg-text">${escapeHTML(s.text)}</span></button></li>`
          )
          .join('')}</ul>`
      : `<p class="hint">${transcript.length ? `這段前後 ${SUGGEST_WINDOW_SEC} 秒內沒有逐字稿句子，回放後手動抄下原句。` : '這通還沒轉錄——先在上方「批次分析所選」轉成逐字稿，或回放後手動抄下客戶原句。'}</p>`;
    panel.innerHTML = `
      <div class="mm-panel-head">
        <span class="mm-panel-call" title="${escapeHTML(call.name || '')}">${escapeHTML(call.name || '錄音')}</span>
        <button type="button" class="ctp-jump" data-jump="${sec}">▶ ${formatDuration(sec)} 回放這段</button>
      </div>
      <label class="mm-field">這句發生什麼 <small>M 標記的筆記，和播放器下方同步</small>
        <textarea class="field" data-field="text" rows="2" placeholder="這一句發生什麼？你的語氣／客戶可能在想…">${escapeHTML(String(m.text || ''))}</textarea></label>
      <label class="mm-field">表層資訊 <small>客戶字面上說了什麼、用了哪些詞——照抄，不解讀</small>
        <textarea class="field" data-field="surface" rows="2" placeholder="例：「我再考慮看看」「現在很忙，之後再說」">${escapeHTML(a.surface)}</textarea></label>
      <label class="mm-field">內心真意 <small>你認為他真正想傳達的——這是推論，要靠下面的證據撐</small>
        <textarea class="field" data-field="intent" rows="2" placeholder="例：不是沒時間，是還不信任我、怕被推銷">${escapeHTML(a.intent)}</textarea></label>
      <div class="mm-strength-slot">${strengthHtml(st)}</div>
      <div class="mm-evidence">
        <div class="mm-evidence-head">證據 <span class="slog-count">${a.evidence.length}</span></div>
        <ul class="mm-ev-list">${evItems || '<li class="hint mm-ev-none">還沒有證據。從下面逐字稿點一句原句，或寫下你聽到的行為（停頓、回答變短、語氣變化）。</li>'}</ul>
        <div class="mm-evidence-head">這段前後的逐字稿 <small>點一句加入證據</small></div>
        ${suggHtml}
        <form class="mm-add">
          <select class="field" data-add="kind" aria-label="證據類型"><option value="quote">原句</option><option value="behavior">行為</option></select>
          <input type="text" class="field" data-add="text" placeholder="客戶原句，或你聽到的行為（例：停頓 3 秒才回答）" aria-label="證據內容">
          <input type="text" class="field mm-add-sec" data-add="sec" inputmode="numeric" value="${formatDuration(sec)}" title="證據出現的時間（m:ss，可改）" aria-label="時間">
          <button type="submit" class="btn slog-mini">加入證據</button>
        </form>
      </div>`;
  }

  function render() {
    const tabs = resolveTab();
    renderTabs(tabs);
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
    const left = el.offsetLeft - stage.clientWidth / 3;
    const top = el.offsetTop - stage.clientHeight / 2 + el.offsetHeight / 2;
    stage.scrollTo?.({ left: Math.max(0, left), top: Math.max(0, top), behavior: 'smooth' });
  }

  function selectMarker(target, { focusField = false } = {}) {
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
    if (focusField) panel.querySelector('textarea[data-field="intent"]')?.focus?.({ preventScroll: true });
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
    root.classList.toggle('max', on);
    document.body.classList.toggle('mm-max-open', on);
    maxBtn.setAttribute('aria-pressed', String(on));
    maxBtn.textContent = on ? '還原' : '最大化';
    maxBtn.title = on ? '還原視窗（F／Esc）' : '最大化視窗（F）';
    drawEdges();
    root.focus({ preventScroll: true });
  }

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
    selectedId = id;
    updateSelection();
    renderPanel();
    const focusSel = { marker: 'textarea[data-field="text"]', surface: 'textarea[data-field="surface"]', intent: 'textarea[data-field="intent"]' }[node.type] || '[data-add="text"]';
    panel.querySelector(focusSel)?.focus?.({ preventScroll: true });
  }

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
    const jump = e.target.closest('[data-jump]');
    if (!jump) return;
    const el = jump.closest('.mm-node');
    const node = graph.nodes.find((n) => n.id === el?.dataset.id);
    if (node?.callId) onJump?.(node.callId, Number(jump.dataset.jump) || 0);
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
  tabsEl.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) setTab(tab.dataset.tab);
  });

  tabsEl.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    cycleTab(e.key === 'ArrowRight' ? 1 : -1);
    tabsEl.querySelector('.mm-tab.active')?.focus();
  });

  container.querySelector('.mm-toolbar-actions').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mm]');
    if (!btn) return;
    const act = btn.dataset.mm;
    if (act === 'max') {
      setMaximized(!maximized);
      return;
    }
    if (act === 'next-todo') {
      selectMarker(nextTodoMarker(markerOutline(viewCalls()), currentMarker()), { focusField: true });
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
    }
    render();
    if (act === 'relayout') stage.scrollTo?.({ left: 0, top: 0 });
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
    else if (k === 'n') selectMarker(nextTodoMarker(outline(), currentMarker()), { focusField: true });
    else if (k === 'f') setMaximized(!maximized);
    else if (k === 'Escape' && maximized) setMaximized(false);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });

  /* ---- 右側面板 ---- */
  function scheduleFieldSave(node, field, value) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      commitMarker(node.callId, node.markerId, { [field]: value });
      const m = findMarker(node.callId, node.markerId);
      const slot = panel.querySelector('.mm-strength-slot');
      if (slot && m) slot.innerHTML = strengthHtml(evidenceStrength(m));
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

  function addEvidence(node, ev) {
    const m = findMarker(node.callId, node.markerId);
    if (!m) return;
    const evidence = normalizeEvidence([...(m.evidence || []), ev]);
    commitMarker(node.callId, node.markerId, { evidence });
    render();
  }

  panel.addEventListener('click', (e) => {
    const node = selectedNode();
    if (!node) return;
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
      document.body.classList.remove('mm-max-open');
      container.innerHTML = '';
    },
  };
}
