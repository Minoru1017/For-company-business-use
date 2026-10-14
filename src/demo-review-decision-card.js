/**
 * P1 決策卡：同一份現場證據，分成「主管內部版」與「客戶共識版」。
 * 兩版欄位白名單不同，避免把 A/B/C、成交風險等內部判斷傳給客戶。
 */
import { brandInfo, brandOf } from './brands.js';
import { guideToText, normalizeDemoGuide } from './demo-review-guide.js';
import { escapeHTML } from './utils.js';

const C = {
  bg: '#ebe8e1',
  panel: '#fcfbf8',
  border: '#e3ded3',
  ink: '#17150f',
  muted: '#85817a',
  deep: '#1b1a16',
  onDeep: '#f3f0e9',
  brand: '#efc12f',
  ok: '#2f7d5b',
  warn: '#9a6b12',
};
const FONT = '"Plus Jakarta Sans","Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
const W = 560;
const PAD = 30;
const SCALE = 2;

const EXTERNAL_FIELDS = [
  ['current', '目前現況'],
  ['goal', '希望達成'],
  ['validatedScene', '這次已驗證'],
  ['pilot', '建議先做'],
  ['roles', '雙方準備'],
  ['acceptance', '驗收方式'],
  ['risks', '前置條件'],
  ['nextDecision', '下一個決策點'],
];

export function decisionCardModel(review, type = 'internal') {
  const guide = normalizeDemoGuide(review?.demoGuide);
  const d = guide?.decision;
  if (!d) return null;
  const customer = String(review?.customer || '未命名客戶').trim();
  if (type === 'external') {
    return {
      type: 'external',
      kicker: 'DEMO DECISION BRIEF',
      title: `${customer}・決策共識`,
      subtitle: '只包含雙方已確認內容與待確認條件',
      rows: EXTERNAL_FIELDS.map(([key, label]) => ({ label, text: d.external[key] })).filter((x) => x.text),
      footer: `${brandInfo(brandOf(review)).name}・供雙方確認，不代表正式合約或成效承諾`,
    };
  }
  const rows = [];
  if (d.internal.verdict) rows.push({ label: '適配判斷', text: d.internal.verdict, tone: 'strong' });
  d.internal.validated.forEach((text) => rows.push({ label: '已證實', text, tone: 'ok' }));
  d.internal.revised.forEach((text) => rows.push({ label: '已修正／推翻', text, tone: 'warn' }));
  d.internal.risks.forEach((text) => rows.push({ label: '風險', text }));
  if (d.resistance.customerWords || d.resistance.hypothesis) {
    rows.push({ label: '真正阻力', text: d.resistance.customerWords || d.resistance.hypothesis, tone: 'warn' });
  }
  if (d.resistance.verifyQuestion) rows.push({ label: '下一次先問', text: d.resistance.verifyQuestion });
  if (d.internal.strategy) rows.push({ label: '建議策略', text: d.internal.strategy, tone: 'strong' });
  if (d.internal.investment) rows.push({ label: '跟進投入', text: d.internal.investment });
  return {
    type: 'internal',
    kicker: 'DEMO MANAGER BRIEF',
    title: `${customer}・主管決策卡`,
    subtitle: '內部使用・包含適配、風險與跟進判斷',
    rows,
    footer: `${brandInfo(brandOf(review)).name}・內部機密，請勿直接轉傳客戶`,
  };
}

function font(ctx, size, weight = 500) {
  ctx.font = `${weight} ${size}px ${FONT}`;
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function wrap(ctx, text, width, max = 8) {
  const tokens = String(text || '').match(/[A-Za-z0-9@._%+\-/]+|\s+|./gu) || [];
  const lines = [];
  let line = '';
  tokens.forEach((token) => {
    if (line && ctx.measureText(line + token).width > width) {
      lines.push(line.trimEnd());
      line = token.trimStart();
    } else line += token;
  });
  if (line.trim()) lines.push(line.trimEnd());
  if (lines.length > max) {
    const cut = lines.slice(0, max);
    cut[max - 1] = `${cut[max - 1].slice(0, -1)}…`;
    return cut;
  }
  return lines;
}

function paint(ctx, model, draw) {
  const inner = W - PAD * 2;
  let y = 0;
  font(ctx, 23, 800);
  const titleLines = wrap(ctx, model.title, inner - 10, 2);
  const headerH = 112 + (titleLines.length - 1) * 28;
  if (draw) {
    ctx.fillStyle = C.deep;
    rrect(ctx, 0, 0, W, headerH, 20);
    ctx.fill();
    ctx.fillStyle = model.type === 'internal' ? C.brand : C.ok;
    font(ctx, 10.5, 800);
    ctx.fillText(model.kicker, PAD, 32);
    ctx.fillStyle = C.onDeep;
    font(ctx, 23, 800);
    titleLines.forEach((line, i) => ctx.fillText(line, PAD, 65 + i * 28));
    ctx.fillStyle = '#aaa69c';
    font(ctx, 11, 500);
    ctx.fillText(model.subtitle, PAD, headerH - 16);
  }
  y = headerH + 14;

  const measured = model.rows.map((row) => {
    font(ctx, 13.5, row.tone === 'strong' ? 700 : 550);
    const lines = wrap(ctx, row.text, inner - 36, 8);
    return { ...row, lines, h: 43 + lines.length * 20 };
  });
  const boxH = measured.reduce((sum, row) => sum + row.h, 0) + 6;
  if (draw) {
    ctx.fillStyle = C.panel;
    rrect(ctx, PAD, y, inner, boxH, 14);
    ctx.fill();
    ctx.strokeStyle = C.border;
    ctx.stroke();
    let yy = y + 6;
    measured.forEach((row, i) => {
      if (i) {
        ctx.fillStyle = C.border;
        ctx.fillRect(PAD + 18, yy, inner - 36, 1);
      }
      font(ctx, 10.5, 750);
      ctx.fillStyle = row.tone === 'ok' ? C.ok : row.tone === 'warn' ? C.warn : C.muted;
      ctx.fillText(row.label, PAD + 18, yy + 21);
      font(ctx, 13.5, row.tone === 'strong' ? 700 : 550);
      ctx.fillStyle = C.ink;
      row.lines.forEach((line, j) => ctx.fillText(line, PAD + 18, yy + 43 + j * 20));
      yy += row.h;
    });
  }
  y += boxH + 14;
  if (draw) {
    ctx.fillStyle = C.muted;
    font(ctx, 10, 600);
    ctx.fillText(model.footer, PAD, y + 13);
  }
  return y + 30;
}

async function draw(model) {
  try {
    await Promise.race([document.fonts?.ready, new Promise((resolve) => setTimeout(resolve, 1000))]);
  } catch {
    /* use fallback font */
  }
  const probe = document.createElement('canvas').getContext('2d');
  const h = Math.ceil(paint(probe, model, false));
  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = h * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, h);
  paint(ctx, model, true);
  return canvas;
}

function blobFrom(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('無法產生 PNG'))), 'image/png'));
}

function safeName(value) {
  return String(value || '未命名客戶').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30);
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function openDemoDecisionCards(review, { showToast } = {}) {
  const toast = (m) => showToast?.(m);
  document.querySelector('.ddc-modal')?.remove();
  let type = 'internal';
  let blob = null;
  const modal = document.createElement('div');
  modal.className = 'ddc-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.innerHTML = `
    <div class="ddc-dialog">
      <div class="ddc-preview"><span>產生決策卡中…</span></div>
      <aside class="ddc-side">
        <span class="drc-kicker">DECISION CARDS</span>
        <h3>${escapeHTML(review.customer || '未命名客戶')}</h3>
        <div class="ddc-switch">
          <button type="button" class="btn on" data-type="internal">主管內部版</button>
          <button type="button" class="btn" data-type="external">客戶共識版</button>
        </div>
        <p class="ddc-explain"></p>
        <button type="button" class="btn primary" data-act="download">下載 PNG</button>
        <button type="button" class="btn" data-act="copy-image">複製圖片</button>
        <button type="button" class="btn" data-act="copy-text">複製文字</button>
        <button type="button" class="btn ddc-close" data-act="close">關閉</button>
      </aside>
    </div>`;
  document.body.appendChild(modal);

  const render = async () => {
    const model = decisionCardModel(review, type);
    if (!model) return;
    const canvas = await draw(model);
    blob = await blobFrom(canvas);
    const img = new Image();
    img.className = 'ddc-image';
    img.alt = type === 'internal' ? '主管內部決策卡' : '客戶決策共識卡';
    img.src = canvas.toDataURL('image/png');
    const box = modal.querySelector('.ddc-preview');
    box.innerHTML = '';
    box.appendChild(img);
    modal.querySelector('.ddc-explain').textContent =
      type === 'internal' ? '包含適配、風險與跟進資源，只供內部使用。' : '已排除客戶分級、成交機率與業務評分，可傳給客戶或決策人確認。';
    modal.querySelectorAll('[data-type]').forEach((b) => b.classList.toggle('on', b.dataset.type === type));
  };
  const close = () => {
    modal.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  modal.addEventListener('click', async (e) => {
    if (e.target === modal) return close();
    const nextType = e.target.closest('[data-type]')?.dataset.type;
    if (nextType) {
      type = nextType;
      await render();
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') return close();
    if (!act || !blob) return;
    const label = type === 'internal' ? '主管決策卡' : '客戶決策共識';
    if (act === 'download') {
      download(blob, `DEMO_${label}_${safeName(review.customer)}.png`);
      toast('已下載決策卡');
    } else if (act === 'copy-text') {
      try {
        await navigator.clipboard.writeText(guideToText(review.demoGuide, type));
        toast('已複製決策卡文字');
      } catch {
        toast('無法複製，請確認瀏覽器權限');
      }
    } else if (act === 'copy-image') {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast('已複製圖片');
      } catch {
        toast('無法複製圖片，請改用下載');
      }
    }
  });
  await render();
  return close;
}
