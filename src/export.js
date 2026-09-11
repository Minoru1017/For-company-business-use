/**
 * 產出直接進到工作流：把分析結果變成能貼到 LINE／Slack 的摘要、
 * 下一通要問的清單、Markdown 報告、已標記的 SRT，以及下載／檔名工具。
 */
import { stripReportHtml } from './report-format.js';
import { RULES } from './rules.js';
import { fmt } from './utils.js';

const STEP_SHORT = { connect: '連結', discovery: '挖掘', clarify: '釐清', diagnose: '判斷', recommend: '對接', decision: '決策' };

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function dateStamp(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function timeStamp(date = new Date()) {
  return `${dateStamp(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** 檔名基底：來源檔名去副檔名，只留安全字元，再接日期。 */
export function exportBaseName(sourceName, date = new Date()) {
  const stem = String(sourceName || 'call')
    .replace(/\.vibe\.json$/i, '')
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return `${stem || 'call'}-${dateStamp(date)}`;
}

export function srtTimestamp(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  return `${pad2(h)}:${pad2(m)}:${pad2(ss)},${String(Math.min(999, ms)).padStart(3, '0')}`;
}

/** 把目前的說話者標記寫回 SRT（[SPEAKER_00]=業務、[SPEAKER_01]=客戶），可直接重新載入。 */
export function segsToSrt(segs) {
  return (segs || [])
    .map((s, i) => {
      const who = s.spk === 'C' ? 'SPEAKER_01' : 'SPEAKER_00';
      const text = String(s.text || '').replace(/^\[SPEAKER_\d+\]:?\s*/, '');
      return `${i + 1}\n${srtTimestamp(s.start)} --> ${srtTimestamp(Math.max(s.start + 0.3, s.end))}\n[${who}] ${text}\n`;
    })
    .join('\n');
}

/** 抽出建議句中的話術（<span class="q">…</span>），去重、去引號。 */
export function extractScripts(items) {
  const out = [];
  const seen = new Set();
  (items || []).forEach((html) => {
    const re = /<span class="q">([\s\S]*?)<\/span>/g;
    let m;
    while ((m = re.exec(String(html)))) {
      const q = stripReportHtml(m[1]).replace(/^[「『"]+|[」』"]+$/g, '').trim();
      if (q && !seen.has(q)) {
        seen.add(q);
        out.push(q);
      }
    }
  });
  return out;
}

function doneSteps(stepHit) {
  return RULES.steps.filter((st) => stepHit?.[st.key]).map((st) => STEP_SHORT[st.key] || st.name);
}

function topItems(items, n) {
  return (items || []).slice(0, n).map((x) => stripReportHtml(x).replace(/\s+/g, ' ').trim());
}

/** 給 LINE／Slack 的短摘要：一眼看到這通電話的健康度與下一步。 */
export function buildSummaryMessage(result, { source = '', date = new Date(), aiSummary = '' } = {}) {
  const { stats, stepHit, deepest, purposeProfile, bad, sug } = result;
  const done = doneSteps(stepHit);
  const dom = purposeProfile?.dominant;
  const lines = [
    `【電訪複盤】${source ? `${source}　` : ''}${timeStamp(date)}`,
    `通話 ${fmt(stats.totalDur)}｜客戶說話 ${Math.round(stats.custRatio * 100)}%｜業務提問 ${stats.sQuestions} 句`,
    `六步驟 ${done.length}/6${done.length ? `（${done.join('、')}）` : ''}｜五層挖到 L${deepest}｜目的分級：${dom ? dom.label : '未判斷'}`,
  ];
  if (aiSummary) lines.push(`AI 總評：${aiSummary}`);
  const badTop = topItems(bad, 2);
  if (badTop.length) {
    lines.push('', '最該補的：');
    badTop.forEach((b) => lines.push(`・${b}`));
  }
  const scripts = extractScripts(sug).slice(0, 2);
  if (scripts.length) {
    lines.push('', '下一通先問：');
    scripts.forEach((q) => lines.push(`・「${q}」`));
  }
  return lines.join('\n');
}

/** 下一通電話前 30 秒能看的清單：要問的話術＋要補的層。 */
export function buildNextCallChecklist(result, { source = '', date = new Date() } = {}) {
  const { stepHit, layerHits, purposeProfile, sug } = result;
  const lines = [`【下一通要問】${source ? `${source}　` : ''}${dateStamp(date)}`];
  const missedSteps = RULES.steps.filter((st) => !stepHit?.[st.key]).map((st) => STEP_SHORT[st.key] || st.name);
  if (missedSteps.length) lines.push(`補上步驟：${missedSteps.join('、')}`);
  const missedLayers = (layerHits || []).filter((L) => !L.hit).map((L) => L.name);
  if (missedLayers.length) lines.push(`補問層級：${missedLayers.join('、')}`);
  if (purposeProfile?.dominant) lines.push(`對方是「${purposeProfile.dominant.label}」：${purposeProfile.dominant.purpose || ''}`.trim());
  const scripts = extractScripts(sug);
  lines.push('');
  if (scripts.length) scripts.forEach((q) => lines.push(`☐ 「${q}」`));
  else lines.push('☐ （這通沒有待補的話術，保持節奏）');
  return lines.join('\n');
}

/** 把純文字報告（■ 區塊、編號列）轉成 Markdown，方便貼到 Notion／Obsidian／Git。 */
export function reportTextToMarkdown(reportText, { source = '', date = new Date(), summaryMessage = '' } = {}) {
  const out = [`# 電訪分析報告`, ''];
  const meta = [`- 日期：${timeStamp(date)}`];
  if (source) meta.push(`- 來源：${source}`);
  meta.push('- 工具：Call Coach（規則分析全程本機）');
  out.push(...meta, '');
  if (summaryMessage) {
    out.push('> ' + summaryMessage.split('\n').join('\n> '), '');
  }
  const lines = String(reportText || '').split('\n');
  lines.forEach((raw) => {
    const line = raw.replace(/\s+$/, '');
    if (/^[═─]{5,}$/.test(line)) return;
    if (/^\s*電訪分析報告\s*$/.test(line)) return;
    if (/^\s*AI 深度分析\s*$/.test(line)) {
      out.push('', '## AI 深度分析', '');
      return;
    }
    if (line.startsWith('■ ')) {
      out.push('', `### ${line.slice(2)}`, '');
      return;
    }
    const m = line.match(/^\s{2}(\d+)\. (.*)$/);
    if (m) {
      out.push(`${m[1]}. ${m[2]}`);
      return;
    }
    const kv = line.match(/^\s{2}(.+?)：(.*)$/);
    if (kv) {
      out.push(`- **${kv[1]}**：${kv[2]}`);
      return;
    }
    const chk = line.match(/^\s{2}(.+?) \[(●|○)\]$/);
    if (chk) {
      out.push(`- [${chk[2] === '●' ? 'x' : ' '}] ${chk[1]}`);
      return;
    }
    if (line.trim()) out.push(line.trim());
  });
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

export function downloadText(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return filename;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 舊瀏覽器或未授權：退回 textarea + execCommand
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand?.('copy');
      ta.remove();
      return !!ok;
    } catch {
      return false;
    }
  }
}
