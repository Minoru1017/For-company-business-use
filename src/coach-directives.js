/**
 * 專案方向（主管指示）：由早會重點經使用者確認後套用，會出現在首頁／工作區頁首，並帶進 AI prompt。
 * 只存本機瀏覽器。
 */
import { POINT_CATEGORIES } from './meeting-notes.js';
import { escapeHTML } from './utils.js';

const KEY = 'callCoachDirectives';
export const DIRECTIVE_LIMIT = 40;

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
    s.setItem(KEY, JSON.stringify(list.slice(0, DIRECTIVE_LIMIT)));
    return true;
  } catch {
    return false;
  }
}

export function listDirectives({ includeArchived = false } = {}) {
  const all = read().sort((a, b) => (b.appliedAt || 0) - (a.appliedAt || 0));
  return includeArchived ? all : all.filter((d) => !d.archived);
}

/**
 * 從一場會議套用重點（同會議重複套用會覆蓋該會議先前的項目）
 * @param {{ meetingId:string, meetingTitle?:string, date?:string, points:Array<{text:string,category?:string,action?:string}> }} p
 */
export function applyMeetingDirectives({ meetingId, meetingTitle = '', date = '', points }) {
  const now = Date.now();
  const kept = read().filter((d) => d.meetingId !== meetingId);
  const fresh = (points || [])
    .map((p) => String(p.text || '').trim())
    .filter(Boolean)
    .map((_, i) => {
      const p = points[i];
      return {
        id: `d_${now.toString(36)}_${i}`,
        meetingId,
        meetingTitle,
        date,
        text: String(p.text).trim(),
        category: POINT_CATEGORIES[p.category] ? p.category : 'process',
        action: String(p.action || '').trim(),
        appliedAt: now,
        archived: false,
      };
    });
  const list = [...fresh, ...kept];
  write(list);
  return fresh;
}

export function archiveDirective(id, archived = true) {
  const list = read();
  const d = list.find((x) => x.id === id);
  if (!d) return false;
  d.archived = archived;
  return write(list);
}

export function removeDirective(id) {
  return write(read().filter((d) => d.id !== id));
}

export function clearDirectives() {
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** 給 AI prompt 的段落；沒有方向時回空字串 */
export function buildDirectivesPromptAddendum(max = 8) {
  const list = listDirectives().slice(0, max);
  if (!list.length) return '';
  const lines = list.map((d) => {
    const cat = POINT_CATEGORIES[d.category]?.label || '';
    return `- [${cat}]${d.date ? `(${d.date})` : ''} ${d.text}${d.action ? `｜做法：${d.action}` : ''}`;
  });
  return `\n[主管近期方向（早會紀錄，業務已確認）] 分析與建議請對齊以下方向；若逐字稿中的做法與方向衝突，請明確指出：\n${lines.join('\n')}\n\n`;
}

export function appendDirectivesToPrompt(prompt) {
  const add = buildDirectivesPromptAddendum();
  return add ? prompt + add : prompt;
}

export function renderDirectivesHtml({ max = 5, compact = false } = {}) {
  const list = listDirectives().slice(0, max);
  if (!list.length) return '';
  const latest = list[0];
  const items = list
    .map(
      (d) =>
        `<li class="coach-directive"><span class="coach-directive-cat">${escapeHTML(POINT_CATEGORIES[d.category]?.label || '')}</span><span class="coach-directive-text">${escapeHTML(d.text)}</span>${
          !compact && d.action ? `<span class="coach-directive-act">${escapeHTML(d.action)}</span>` : ''
        }</li>`
    )
    .join('');
  return `<div class="coach-directives ${compact ? 'compact' : ''}">
    <p class="coach-directives-head"><span class="coach-directives-kicker">主管方向</span>${latest.date ? `<span class="coach-directives-date">${escapeHTML(latest.date)}</span>` : ''}${latest.meetingTitle ? `<span class="coach-directives-src">${escapeHTML(latest.meetingTitle)}</span>` : ''}</p>
    <ul class="coach-directives-list">${items}</ul>
  </div>`;
}
