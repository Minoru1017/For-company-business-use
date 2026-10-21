import { RULES } from './rules.js';
import { escapeHTML, fmt } from './utils.js';

export const ONE_CHANGE_FALLBACK = '流程完整，下一通維持同樣結構';

const MAX_MARKS = 5;

/** 報告建議是 HTML 字串（含 <span class="q">），計分卡只要純文字 */
export function stripTags(html) {
  return String(html ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 下一通只改這一件：analyze 依優先序推入建議，取第一條；沒有建議就維持結構 */
export function pickOneChange(result) {
  const first = (result?.sug || []).map(stripTags).find(Boolean);
  const why = (result?.bad || []).map(stripTags).find(Boolean) || '';
  return { change: first || ONE_CHANGE_FALLBACK, why: first ? why : '' };
}

export function ratioTone(ratio) {
  if (ratio >= 0.45) return 'ok';
  if (ratio >= 0.3) return 'warn';
  return 'bad';
}

export function stepTone(done, total) {
  if (total > 0 && done >= total) return 'ok';
  if (done >= Math.ceil(total / 2)) return 'warn';
  return 'bad';
}

export function stepSummary(stepHit = {}) {
  const steps = RULES.steps.map((st) => ({
    key: st.key,
    label: st.name.split(' ')[1] || st.name,
    hit: !!stepHit[st.key],
  }));
  return { steps, done: steps.filter((s) => s.hit).length, total: steps.length };
}

/** 四格分數：時長、客戶說話、步驟做到、業務提問；tone 只用 ok／warn／bad 三種語意色 */
export function scoreStrip(result) {
  const stats = result?.stats || {};
  const { done, total } = stepSummary(result?.stepHit);
  const ratio = Number(stats.custRatio) || 0;
  return [
    { key: 'dur', value: fmt(stats.totalDur || 0), label: '時長', tone: '' },
    { key: 'ratio', value: `${Math.round(ratio * 100)}%`, label: '客戶說話', tone: ratioTone(ratio) },
    { key: 'steps', value: `${done}/${total}`, label: '步驟做到', tone: stepTone(done, total) },
    { key: 'questions', value: String(stats.sQuestions ?? 0), label: '業務提問', tone: '' },
  ];
}

const pct = (v, total) => Math.max(0, Math.min(100, (v / total) * 100));

/** 說話者時間軸：每句換成 left／width 百分比；關鍵話點取前幾個，避免標籤擠在一起 */
export function timelineModel(segs = [], moments = []) {
  const total = Math.max(1, ...segs.map((s) => Number(s.end) || 0));
  const bars = segs.map((s, idx) => {
    const start = Number(s.start) || 0;
    const end = Math.max(start, Number(s.end) || start);
    return { idx, spk: s.spk === 'C' ? 'C' : 'S', left: pct(start, total), width: Math.max(0.4, pct(end - start, total)) };
  });
  const marks = [...moments]
    .sort((a, b) => (b.breakthrough ? 1 : 0) - (a.breakthrough ? 1 : 0) || (b.customerChars || 0) - (a.customerChars || 0))
    .slice(0, MAX_MARKS)
    .sort((a, b) => a.start - b.start)
    .map((m) => ({
      idx: m.startIdx,
      endIdx: m.endIdx,
      left: pct(Number(m.start) || 0, total),
      time: fmt(m.start || 0),
      label: m.label,
      breakthrough: !!m.breakthrough,
    }));
  const ticks = [0, 1 / 3, 2 / 3, 1].map((f) => fmt(Math.round(total * f)));
  return { total, bars, marks, ticks };
}

function lineHtml(seg, now) {
  const who = seg.spk === 'C' ? '客戶' : '業務';
  return `<div class="cs-line ${seg.spk === 'C' ? 'cust' : 'sales'}${now ? ' now' : ''}"><time>${fmt(seg.start)}</time><span class="cs-who">${who}</span><p>${escapeHTML(seg.text)}</p></div>`;
}

/** 點時間軸或話點，下方只顯示那一段前後的原句 */
function showLines(host, segs, from, to = from) {
  const lo = Math.max(0, from - 1);
  const hi = Math.min(segs.length - 1, Math.max(to, from) + 1);
  const rows = [];
  for (let i = lo; i <= hi; i++) rows.push(lineHtml(segs[i], i >= from && i <= to));
  host.innerHTML = rows.join('');
}

export function renderCallScorecard(el, result, segs = []) {
  if (!el) return;
  const one = pickOneChange(result);
  const strip = scoreStrip(result);
  const { steps } = stepSummary(result?.stepHit);
  const tl = timelineModel(segs, result?.keyMoments || []);

  const lane = (spk) =>
    tl.bars
      .filter((b) => b.spk === spk)
      .map((b) => `<i data-idx="${b.idx}" style="left:${b.left.toFixed(2)}%;width:${b.width.toFixed(2)}%"></i>`)
      .join('');

  el.innerHTML = `
    <p class="cs-kicker">下一通只改這一件</p>
    <p class="cs-change">${escapeHTML(one.change)}</p>
    ${one.why ? `<p class="cs-why">${escapeHTML(one.why)}</p>` : ''}
    <div class="cs-scores">${strip
      .map((s) => `<div class="cs-score${s.tone ? ` ${s.tone}` : ''}" data-key="${s.key}"><b>${s.value}</b><span>${s.label}</span></div>`)
      .join('')}</div>
    <ol class="cs-steps">${steps
      .map((s) => `<li class="${s.hit ? 'hit' : 'miss'}" title="${s.hit ? '已偵測' : '未偵測'}"><i aria-hidden="true"></i>${escapeHTML(s.label)}</li>`)
      .join('')}</ol>
    <div class="cs-timeline" aria-label="說話者時間軸">
      <div class="cs-axis">${tl.ticks.map((t) => `<span>${t}</span>`).join('')}</div>
      <div class="cs-lane"><span class="cs-lane-name">業務</span><div class="cs-track sales">${lane('S')}</div></div>
      <div class="cs-lane"><span class="cs-lane-name">客戶</span><div class="cs-track cust">${lane('C')}</div></div>
      <div class="cs-marks">${tl.marks
        .map(
          (m) =>
            `<button type="button" class="cs-mark${m.breakthrough ? ' breakthrough' : ''}" data-idx="${m.idx}" data-end="${m.endIdx}" style="left:${m.left.toFixed(2)}%">${m.time} ${escapeHTML(m.label)}</button>`
        )
        .join('')}</div>
    </div>
    <div class="cs-lines" aria-live="polite"></div>`;

  const lines = el.querySelector('.cs-lines');
  const first = tl.marks[0];
  if (first && segs[first.idx]) showLines(lines, segs, first.idx, first.endIdx ?? first.idx);
  else lines.innerHTML = '<p class="cs-empty">點時間軸上的任一段，看那一句原話。</p>';

  el.onclick = (e) => {
    const target = e.target.closest('[data-idx]');
    if (!target || !el.contains(target)) return;
    const idx = Number(target.dataset.idx);
    if (!segs[idx]) return;
    const end = target.dataset.end != null ? Number(target.dataset.end) : idx;
    el.querySelectorAll('.cs-mark.on, .cs-track i.on').forEach((n) => n.classList.remove('on'));
    target.classList.add('on');
    showLines(lines, segs, idx, Number.isFinite(end) ? end : idx);
  };
}
