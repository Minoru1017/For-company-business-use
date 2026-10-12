/**
 * DEMO 後複盤「分享圖卡」：把一筆複盤畫成一張獨立的直式卡片（PNG），
 * 方便直接丟給主管看，不用對方開 Call Coach。畫面預覽與下載的是同一張圖。
 */
import { REVIEW_TEXT_FIELDS, OUTCOMES, formatAnalysisSummary, outcomeLabel, reviewToText, tierLabel, todayKey } from './demo-review.js';
import { escapeHTML } from './utils.js';

/* 與 tone.css 同一組色票（canvas 讀不到 CSS 變數，這裡寫死） */
const C = {
  bg: '#ebe8e1',
  panel: '#fcfbf8',
  panel2: '#f3f0e9',
  border: '#e3ded3',
  ink: '#17150f',
  text2: '#55524a',
  muted: '#85817a',
  deep: '#1b1a16',
  deep2: '#2a2823',
  onDeep: '#f3f0e9',
  onDeepMuted: '#a8a498',
  brand: '#efc12f',
  brandSoft: '#f7edcc',
  ok: '#2f7d5b',
  warn: '#9a6b12',
  bad: '#bb3a24',
};
const TONE_COLOR = { ok: C.ok, warn: C.warn, bad: C.bad, muted: C.muted };

const FONT = '"Plus Jakarta Sans","Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
const CARD_W = 560;
const PAD = 30;
const SCALE = 2;

/** 圖卡上要帶的文字欄位（備註不放：主管看重點就好） */
const CARD_SECTIONS = REVIEW_TEXT_FIELDS.filter((f) => f.key !== 'note').map((f) => ({ key: f.key, label: f.label }));

function fmtStamp(ts) {
  const d = new Date(ts || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 把複盤整理成圖卡要畫的結構（純函式，方便測試）。
 * @returns {{ customer:string, demoAt:string, outcome:{label:string,tone:string,set:boolean},
 *   kpis:{label:string,value:string,empty:boolean}[], nextStep:string, followUpDate:string,
 *   sections:{label:string,text:string}[], analysis:string, stamp:string }}
 */
export function reviewCardModel(r, now = Date.now()) {
  const o = OUTCOMES.find((x) => x.key === r.outcome);
  const tier = r.tier ? tierLabel(r.tier) : '';
  return {
    customer: String(r.customer || '').trim() || '未命名客戶',
    demoAt: String(r.demoAt || '').trim(),
    outcome: { label: outcomeLabel(r.outcome), tone: o?.tone || 'muted', set: !!o },
    kpis: [
      { label: '這位客戶實際是', value: tier || '還沒判斷', empty: !tier },
      { label: '方案適配', value: r.fit || '—', empty: !r.fit },
      { label: '跟進日期', value: r.followUpDate || '未排', empty: !r.followUpDate },
    ],
    nextStep: String(r.nextStep || '').trim(),
    followUpDate: r.followUpDate || '',
    sections: CARD_SECTIONS.map((s) => ({ label: s.label, text: String(r[s.key] || '').trim() })).filter((s) => s.text),
    analysis: r.analysis ? formatAnalysisSummary(r.analysis.summary) : '',
    stamp: fmtStamp(now),
  };
}

export function reviewCardFileName(r, today = todayKey()) {
  const name = String(r.customer || '未命名客戶').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30);
  return `DEMO複盤_${name}_${today}.png`;
}

/* ---- 文字排版：中英混排逐字折行 ---- */

function wrapLine(ctx, text, maxW) {
  const out = [];
  // 英數連在一起當一個字；中文一字一單位
  const tokens = text.match(/[A-Za-z0-9@._%+\-/]+|\s+|./gu) || [];
  let line = '';
  tokens.forEach((t) => {
    const probe = line + t;
    if (line && ctx.measureText(probe).width > maxW) {
      out.push(line.trimEnd());
      line = t.trimStart();
    } else {
      line = probe;
    }
  });
  if (line.trim()) out.push(line.trimEnd());
  return out;
}

function wrap(ctx, text, maxW, maxLines = Infinity) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .flatMap((ln) => (ln.trim() ? wrapLine(ctx, ln, maxW) : ['']));
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    cut[maxLines - 1] = `${cut[maxLines - 1].slice(0, -1)}…`;
    return cut;
  }
  return lines;
}

function rrect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/* 右上角積木缺角：PNG 底是單色，直接用底色把角蓋掉就是缺口 */
function notchTopRight(ctx, x, y, w, nw, nh, r) {
  ctx.fillStyle = C.bg;
  rrect(ctx, x + w - nw, y - r, nw + r, nh + r, r);
  ctx.fill();
}

function font(ctx, px, weight = 500) {
  ctx.font = `${weight} ${px}px ${FONT}`;
}

/**
 * 兩段式：第一遍只量高度（draw=false），第二遍真的畫。
 * 回傳整張卡高度（CSS px）。
 */
function paint(ctx, m, { draw }) {
  const W = CARD_W;
  const inner = W - PAD * 2;
  let y = 0;

  // ---- 深色頁首（右上有缺角，缺角裡放結果膠囊） ----
  font(ctx, 24, 800);
  const nameLines = wrap(ctx, m.customer, inner - 150, 2);
  const headH = 112 + (nameLines.length - 1) * 30;
  if (draw) {
    ctx.fillStyle = C.deep;
    rrect(ctx, 0, 0, W, headH, 22);
    ctx.fill();
    if (m.outcome.set) {
      // 結果膠囊：dock 在缺角
      font(ctx, 13, 700);
      const pw = ctx.measureText(m.outcome.label).width + 30;
      notchTopRight(ctx, 0, 0, W, pw + 14, 40, 14);
      ctx.fillStyle = TONE_COLOR[m.outcome.tone] || C.muted;
      rrect(ctx, W - pw - 6, 6, pw, 28, 14);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText(m.outcome.label, W - pw - 6 + 15, 20);
      ctx.textBaseline = 'alphabetic';
    }
    font(ctx, 11, 700);
    ctx.fillStyle = C.brand;
    ctx.fillText('DEMO 後複盤  ·  REVIEW CARD', PAD, 38);
    font(ctx, 24, 800);
    ctx.fillStyle = C.onDeep;
    nameLines.forEach((ln, i) => ctx.fillText(ln, PAD, 74 + i * 30));
    font(ctx, 12, 500);
    ctx.fillStyle = C.onDeepMuted;
    const meta = [m.demoAt ? `DEMO ${m.demoAt}` : '', `建檔 ${m.stamp}`].filter(Boolean).join('   ·   ');
    ctx.fillText(meta, PAD, headH - 14);
  }
  y = headH + 18;

  // ---- 三格指標 ----
  const gap = 8;
  const kw = (inner - gap * 2) / 3;
  const kh = 64;
  m.kpis.forEach((k, i) => {
    const x = PAD + i * (kw + gap);
    if (draw) {
      ctx.fillStyle = C.panel;
      rrect(ctx, x, y, kw, kh, 12);
      ctx.fill();
      ctx.strokeStyle = C.border;
      ctx.lineWidth = 1;
      ctx.stroke();
      font(ctx, 10.5, 600);
      ctx.fillStyle = C.muted;
      ctx.fillText(k.label, x + 12, y + 22);
      font(ctx, k.value.length > 6 ? 14 : 17, 800);
      ctx.fillStyle = k.empty ? C.muted : C.ink;
      ctx.fillText(k.value, x + 12, y + 47);
    }
  });
  y += kh + 12;

  // ---- 下一步（品牌黃色塊，永遠顯示，沒填就提醒） ----
  font(ctx, 14.5, 700);
  const nsLines = wrap(ctx, m.nextStep || '還沒約定下一步', inner - 44, 4);
  const nsH = 42 + nsLines.length * 22;
  if (draw) {
    ctx.fillStyle = C.brandSoft;
    rrect(ctx, PAD, y, inner, nsH, 14);
    ctx.fill();
    ctx.fillStyle = C.brand;
    rrect(ctx, PAD, y + 12, 4, nsH - 24, 2);
    ctx.fill();
    font(ctx, 10.5, 700);
    ctx.fillStyle = C.warn;
    ctx.fillText(`下一步${m.followUpDate ? `  ·  ${m.followUpDate} 跟進` : ''}`, PAD + 18, y + 22);
    font(ctx, 14.5, 700);
    ctx.fillStyle = m.nextStep ? C.ink : C.muted;
    nsLines.forEach((ln, i) => ctx.fillText(ln, PAD + 18, y + 44 + i * 22));
  }
  y += nsH + 12;

  // ---- 文字段落：單張白卡，分隔線 ----
  if (m.sections.length) {
    const startY = y;
    const rows = m.sections.map((s) => {
      font(ctx, 13.5, 500);
      return { ...s, lines: wrap(ctx, s.text, inner - 36, 8) };
    });
    const rowH = (rw) => 30 + rw.lines.length * 21 + 14;
    const boxH = rows.reduce((h, rw) => h + rowH(rw), 0) + 6;
    if (draw) {
      ctx.fillStyle = C.panel;
      rrect(ctx, PAD, startY, inner, boxH, 14);
      ctx.fill();
      ctx.strokeStyle = C.border;
      ctx.stroke();
      let yy = startY + 6;
      rows.forEach((rw, i) => {
        if (i) {
          ctx.fillStyle = C.border;
          ctx.fillRect(PAD + 18, yy, inner - 36, 1);
        }
        font(ctx, 10.5, 700);
        ctx.fillStyle = C.muted;
        ctx.fillText(rw.label, PAD + 18, yy + 22);
        font(ctx, 13.5, 500);
        ctx.fillStyle = C.ink;
        rw.lines.forEach((ln, j) => ctx.fillText(ln, PAD + 18, yy + 44 + j * 21));
        yy += rowH(rw);
      });
    }
    y += boxH + 12;
  }

  // ---- 錄影分析摘要 ----
  if (m.analysis) {
    font(ctx, 11.5, 600);
    const aLines = wrap(ctx, m.analysis, inner - 36, 3);
    const aH = 22 + aLines.length * 17;
    if (draw) {
      ctx.fillStyle = C.panel2;
      rrect(ctx, PAD, y, inner, aH, 10);
      ctx.fill();
      ctx.fillStyle = C.text2;
      aLines.forEach((ln, i) => ctx.fillText(`${i ? '' : '錄影分析  ·  '}${ln}`, PAD + 18, y + 20 + i * 17));
    }
    y += aH + 12;
  }

  // ---- 頁尾 ----
  if (draw) {
    font(ctx, 10.5, 700);
    ctx.fillStyle = C.muted;
    ctx.fillText('CALL COACH', PAD, y + 14);
    font(ctx, 10.5, 500);
    const tail = '業務自填複盤・僅供內部討論';
    ctx.fillText(tail, W - PAD - ctx.measureText(tail).width, y + 14);
  }
  y += 30;
  return y;
}

/**
 * 畫成 canvas（2x）。會等網頁字型載好再畫，避免中文掉成系統字。
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function drawReviewCard(review, now = Date.now()) {
  try {
    await Promise.race([document.fonts?.ready, new Promise((res) => setTimeout(res, 1200))]);
  } catch {
    /* 字型載不到就用系統字 */
  }
  const m = reviewCardModel(review, now);
  const probe = document.createElement('canvas').getContext('2d');
  const H = Math.ceil(paint(probe, m, { draw: false }));
  const cv = document.createElement('canvas');
  cv.width = CARD_W * SCALE;
  cv.height = H * SCALE;
  const ctx = cv.getContext('2d');
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, CARD_W, H);
  paint(ctx, m, { draw: true });
  return cv;
}

function toBlob(cv) {
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
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

/**
 * 開啟分享圖卡視窗：左邊是圖卡預覽（就是要下載的那張），右邊是動作。
 * @param {object} review
 * @param {{ showToast?:(m:string)=>void }} [opts]
 */
export async function openReviewCard(review, { showToast } = {}) {
  const toast = (m) => showToast?.(m);
  document.querySelector('.drc-modal')?.remove();
  const fileName = reviewCardFileName(review);
  const text = reviewToText(review);
  const canShareFiles = typeof navigator.canShare === 'function' && typeof File === 'function';
  const canCopyImage = typeof window.ClipboardItem === 'function' && !!navigator.clipboard?.write;

  const modal = document.createElement('div');
  modal.className = 'drc-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'DEMO 複盤分享圖卡');
  modal.innerHTML = `
    <div class="drc-dialog">
      <div class="drc-preview"><div class="drc-loading">產生圖卡中…</div></div>
      <aside class="drc-side">
        <div class="drc-side-head">
          <span class="drc-kicker">分享圖卡</span>
          <h3>${escapeHTML(review.customer || '未命名客戶')}</h3>
          <p class="hint">一張圖就是這場 DEMO 的重點：結果、下一步、客戶反應與疑慮。傳給主管不用再貼長文。</p>
        </div>
        <div class="drc-actions">
          <button type="button" class="btn primary" data-act="download">下載 PNG</button>
          ${canShareFiles ? '<button type="button" class="btn" data-act="share">分享圖卡…</button>' : ''}
          ${canCopyImage ? '<button type="button" class="btn" data-act="copy-img">複製圖片</button>' : ''}
          <button type="button" class="btn" data-act="copy-text">複製純文字</button>
        </div>
        <p class="hint drc-note">圖卡不含「其他備註」與錄影檔；只有這台電腦存有完整資料。</p>
        <button type="button" class="btn drc-close" data-act="close">關閉</button>
      </aside>
    </div>`;
  document.body.appendChild(modal);

  let blob = null;
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
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'close') return close();
    if (act === 'copy-text') {
      try {
        await navigator.clipboard.writeText(text);
        toast('已複製純文字');
      } catch {
        toast('無法複製');
      }
      return;
    }
    if (!blob) return toast('圖卡還在產生中');
    if (act === 'download') {
      download(blob, fileName);
      toast('已下載圖卡');
    } else if (act === 'share') {
      const file = new File([blob], fileName, { type: 'image/png' });
      if (!navigator.canShare({ files: [file] })) return toast('這個瀏覽器不支援分享圖片，請改用下載');
      try {
        await navigator.share({ files: [file], title: `DEMO 複盤：${review.customer || ''}` });
      } catch (err) {
        if (err?.name !== 'AbortError') toast('分享失敗，請改用下載');
      }
    } else if (act === 'copy-img') {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast('已複製圖片，可直接貼到聊天視窗');
      } catch {
        toast('無法複製圖片，請改用下載');
      }
    }
  });

  try {
    const cv = await drawReviewCard(review);
    blob = await toBlob(cv);
    const img = new Image();
    img.alt = 'DEMO 複盤圖卡';
    img.className = 'drc-img';
    img.src = URL.createObjectURL(blob);
    const box = modal.querySelector('.drc-preview');
    box.innerHTML = '';
    box.appendChild(img);
  } catch (err) {
    modal.querySelector('.drc-preview').innerHTML = `<div class="drc-loading">圖卡產生失敗：${escapeHTML(err?.message || String(err))}</div>`;
  }
  return close;
}
