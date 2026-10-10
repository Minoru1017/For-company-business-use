/**
 * 症狀紀錄共用的小工具（不碰 DOM 狀態）：日期標籤、百分比、逐字稿轉換、試算表自評欄位、陪練走勢圖。
 */
import { applyBuiltinSpeakerLabels, parse } from './parser.js';
import { autoGuess } from './speaker.js';
import { labeledRatio } from './speaker-labels.js';
import { a1ToCol, markIsOn } from './sheet-sync.js';
import { parseDateKey } from './symptom-engine.js';

export const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export function fmtPct(v) {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
}

export function fmtDateLabel(key) {
  const d = parseDateKey(key);
  if (!d) return key;
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`;
}

export function startKey(settings) {
  return parseDateKey(settings?.startDate) ? settings.startDate : '';
}

/** 用 <audio> 讀出長度（公司電話系統的 wav 檔名通常沒有秒數）。讀不到回 0。 */
export function probeDuration(blob) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return resolve(0);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('audio');
    const done = (v) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
    };
    const timer = setTimeout(() => done(0), 8000);
    a.preload = 'metadata';
    a.onloadedmetadata = () => {
      if (a.duration === Infinity) {
        // 某些串流式 wav 需要 seek 到尾才知道長度
        a.currentTime = 1e9;
        a.ontimeupdate = () => done(a.duration);
        return;
      }
      done(a.duration);
    };
    a.onerror = () => done(0);
    a.src = url;
  });
}

export function srtToSegments(srt) {
  const segs = parse(srt);
  applyBuiltinSpeakerLabels(segs);
  if (labeledRatio(segs) < 0.5) autoGuess(segs);
  return segs;
}

export function plainSegs(segs) {
  return segs.map((s) => ({ start: s.start, end: s.end, text: s.text, spk: s.spk }));
}

/** 每日陪練平均分的小折線（SVG 字串）；少於 2 天回傳空字串 */
export function drillSparkline(daily) {
  if (!daily || daily.length < 2) return '';
  const W = 320;
  const H = 56;
  const step = W / (daily.length - 1);
  const y = (v) => Math.round((H - 6 - (v / 100) * (H - 12)) * 10) / 10;
  const pts = daily.map((p, i) => `${Math.round(i * step * 10) / 10},${y(p.avg)}`).join(' ');
  const dots = daily
    .map((p, i) => `<circle cx="${Math.round(i * step * 10) / 10}" cy="${y(p.avg)}" r="2.5"><title>${p.date.slice(5)} · ${p.count} 次 · 平均 ${p.avg}</title></circle>`)
    .join('');
  return `<svg class="slog-drill-spark" viewBox="-4 0 ${W + 8} ${H}" preserveAspectRatio="none" aria-label="每日陪練平均分"><polyline points="${pts}" fill="none"/>${dots}</svg>`;
}

/** 試算表裡某天被標「有」的病症名稱 */
export function selfMarkNamesFor(model, key) {
  const day = model?.days?.[key];
  if (!model || !day) return [];
  return model.headers.filter((h) => markIsOn(day.marks[h.col])).map((h) => h.name);
}

/** 把寫入的格子套回本地的 rows（就地修改並回傳），不用等 Google 的 CSV 快取更新 */
export function applyCellsToRows(rows, cells) {
  rows = rows && rows.length ? rows : [[]];
  cells.forEach(({ a1, value }) => {
    const m = /^([A-Z]+)(\d+)$/.exec(a1);
    if (!m) return;
    const c = a1ToCol(m[1]);
    const r = Number(m[2]) - 1;
    while (rows.length <= r) rows.push([]);
    const row = rows[r];
    while (row.length <= c) row.push('');
    row[c] = value == null ? '' : String(value);
    while (rows[0].length < row.length) rows[0].push('');
  });
  return rows;
}
