/**
 * DEMO 簡報 → .pptx（PptxGenJS，寬螢幕 13.33×7.5 in）。
 * 版型對齊 HTML 預覽：classic＝深藍章節頁＋淺底卡片頁；nomad＝數位游牧（動態模糊底＋玻璃卡、護照紙＋印章卡片）。
 * 編輯器的文字格式、圖塊色、背景色、圖片都會帶過去；講者備註＝notes＋這頁回應客戶的哪一點。
 */
import { slideNumbers } from './demo-deck.js';

const PALETTES = {
  classic: {
    bg: 'F3F6FA',
    darkBg: '18224F',
    ink: '1B2550',
    accent: 'E39A45',
    sub: '6B7385',
    line: 'DDE2EA',
    cardFill: 'FFFFFF',
    bar: 'E39A45',
    navy: '18224F',
    onNavyAccent: 'E39A45',
    navyLabel: 'C9D0E4',
    last: 'E39A45',
    warm: 'F8E3CF',
    cool: 'E6EAF2',
    muted: 'ECEEF1',
    mutedText: '9AA0AC',
    darkText: 'FFFFFF',
    darkSub: 'C9D0E4',
    darkAccent: 'E39A45',
    darkBox: '232E63',
    darkPage: '5D6690',
    font: 'Microsoft JhengHei',
    titleFont: '',
    dotFont: '',
  },
  nomad: {
    bg: 'EEEBE3',
    darkBg: '24231F',
    ink: '1D2433',
    accent: 'B83A2E',
    sub: '6B6457',
    line: 'C9C3B5',
    cardFill: 'EEEBE3',
    bar: '',
    navy: '22356F',
    onNavyAccent: 'F3D58A',
    navyLabel: 'C9D0E4',
    last: 'B83A2E',
    warm: 'EEEBE3',
    cool: 'EEEBE3',
    muted: 'E4E0D6',
    mutedText: '9A9486',
    darkText: 'FFFFFF',
    darkSub: 'F1EFE8',
    darkAccent: 'E8B04B',
    darkBox: 'FFFFFF',
    darkPage: 'BDB8AC',
    font: 'Microsoft JhengHei',
    titleFont: 'Bahnschrift SemiBold Condensed',
    dotFont: 'Consolas',
    inks: ['22356F', 'B83A2E', '2F6FD6', '222222'],
  },
};

const W = 13.333;
const H = 7.5;
const M = 0.75;
const CW = W - M * 2;
const CN_NUM = ['一', '二', '三', '四', '五', '六'];
const pad = (n) => String(n).padStart(2, '0');
const hex = (c) => String(c || '').replace('#', '').toUpperCase();

/** 目前正在輸出的投影片：格式覆寫＋色票（txt／rect 依 key 套用） */
let F = { text: {}, blocks: {}, font: PALETTES.classic.font };
let P = PALETTES.classic;
let NOMAD = false;

function styled(o, key) {
  const st = key ? F.text[key] : null;
  const out = { fontFace: F.font, ...o };
  if (st?.color) out.color = hex(st.color);
  if (st?.size) out.fontSize = st.size;
  if (st?.font) out.fontFace = st.font;
  return out;
}

function txt(s, text, o, key) {
  if (!text) return;
  s.addText(String(text), styled({ color: P.ink, valign: 'top', margin: 0, fit: 'shrink', ...o }, key));
}

function fillOf(o, key) {
  const custom = key ? F.blocks[key]?.fill : '';
  return custom ? { color: hex(custom) } : o.fill;
}

function rect(pptx, s, o, key) {
  const fill = fillOf(o, key);
  s.addShape(pptx.ShapeType.rect, { line: { color: fill?.color || P.cardFill, width: 0 }, ...o, fill });
}

function round(pptx, s, o, key) {
  const fill = fillOf(o, key);
  s.addShape(pptx.ShapeType.roundRect, { rectRadius: 0.12, line: { color: fill?.color || P.cardFill, width: 0 }, ...o, fill });
}

/** 淺底卡片：classic＝白卡＋橘色上緣；nomad＝護照印章（雙框、輪替墨色、微傾斜） */
function card(pptx, s, o, key, k = 0) {
  if (!NOMAD) {
    rect(pptx, s, { ...o, fill: { color: o.muted ? P.muted : P.cardFill }, line: { color: P.line, width: 1 } }, key);
    if (o.bar !== false) rect(pptx, s, { x: o.x, y: o.y, w: o.w, h: 0.08, fill: { color: o.muted ? 'C9CDD5' : P.bar } });
    return P.accent;
  }
  const ink = o.muted ? P.mutedText : P.inks[k % P.inks.length];
  const rotate = [-1.2, 1, -0.6, 1.4][k % 4];
  const fill = fillOf({ fill: { color: o.muted ? P.muted : P.cardFill } }, key);
  const base = { x: o.x, y: o.y, w: o.w, h: o.h, rectRadius: 0.14, rotate };
  s.addShape(pptx.ShapeType.roundRect, { ...base, fill, line: { color: ink, width: 2.25, dashType: o.muted ? 'dash' : 'solid' } });
  s.addShape(pptx.ShapeType.roundRect, {
    x: o.x + 0.07,
    y: o.y + 0.07,
    w: o.w - 0.14,
    h: o.h - 0.14,
    rectRadius: 0.1,
    rotate,
    fill: { color: fill.color, transparency: 100 },
    line: { color: ink, width: 0.75 },
  });
  return ink;
}

/** 深色圖塊（橫幅、確認句）：nomad 變成紅色雙框印章 */
function banner(pptx, s, o, key, text) {
  if (!NOMAD) {
    rect(pptx, s, { ...o, fill: { color: P.navy } }, key);
    txt(s, text, { x: o.x + 0.4, y: o.y, w: o.w - 0.8, h: o.h, fontSize: 18, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle' }, key);
    return;
  }
  const fill = fillOf({ fill: { color: P.bg } }, key);
  s.addShape(pptx.ShapeType.roundRect, { ...o, rectRadius: 0.12, rotate: -0.8, fill, line: { color: P.accent, width: 2.5 } });
  s.addShape(pptx.ShapeType.roundRect, {
    x: o.x + 0.08,
    y: o.y + 0.08,
    w: o.w - 0.16,
    h: o.h - 0.16,
    rectRadius: 0.08,
    rotate: -0.8,
    fill: { color: fill.color, transparency: 100 },
    line: { color: P.accent, width: 0.75 },
  });
  txt(s, text, { x: o.x + 0.4, y: o.y, w: o.w - 0.8, h: o.h, fontSize: 18, bold: true, color: P.accent, align: 'center', valign: 'middle', rotate: -0.8 }, key);
}

function page(s, i, total, dark) {
  if (NOMAD && !dark) {
    txt(s, `N° ${pad(i + 1)} / ${pad(total)}`, { x: M, y: 6.85, w: 4, h: 0.4, fontFace: P.dotFont, fontSize: 16, color: P.ink, charSpacing: 3 });
    return;
  }
  txt(s, `${pad(i + 1)} / ${pad(total)}`, { x: W - 1.6, y: 7.05, w: 1.2, h: 0.25, fontSize: 9, color: dark ? P.darkPage : P.mutedText, align: 'right' });
}

function head(pptx, s, slide, num) {
  const kOpts = NOMAD ? { fontFace: P.dotFont, fontSize: 13, color: P.ink, charSpacing: 4 } : { fontSize: 12, color: P.accent, charSpacing: 2 };
  const right = NOMAD ? 2.4 : 0;
  if (num) {
    s.addText(
      [
        { text: `${pad(num)}   ｜   `, options: { color: P.accent } },
        { text: slide.kicker || '', options: styled({ color: kOpts.color }, 'kicker') },
      ],
      { x: M, y: 0.5, w: CW - right, h: 0.3, fontFace: kOpts.fontFace || F.font, fontSize: kOpts.fontSize, bold: true, charSpacing: kOpts.charSpacing, margin: 0, valign: 'top' }
    );
  } else {
    txt(s, slide.kicker, { x: M, y: 0.5, w: CW - right, h: 0.3, bold: true, ...kOpts }, 'kicker');
  }
  txt(s, slide.title, { x: M, y: 0.85, w: CW - right, h: 0.85, fontSize: NOMAD ? 32 : 30, bold: true, color: P.ink, valign: 'middle', ...(P.titleFont ? { fontFace: P.titleFont } : {}) }, 'title');
  txt(s, slide.subtitle, { x: M, y: 1.75, w: CW - right, h: 0.4, fontSize: 14, italic: !NOMAD, color: P.sub }, 'subtitle');
  s.addShape(pptx.ShapeType.line, { x: M, y: 2.3, w: CW, h: 0, line: { color: P.line, width: 1, dashType: NOMAD ? 'dash' : 'solid' } });
}

function chips(pptx, s, list, y, fill, prefix, inkIdx = 2) {
  const w = Math.min(2.4, (CW - 0.2 * (list.length - 1)) / Math.max(1, list.length));
  list.forEach((c, i) => {
    const x = M + i * (w + 0.2);
    if (NOMAD) {
      const ink = P.inks[inkIdx];
      const f = fillOf({ fill: { color: P.bg } }, `${prefix}.${i}`);
      s.addShape(pptx.ShapeType.roundRect, { x, y, w, h: 0.5, rectRadius: 0.06, fill: f, line: { color: ink, width: 1.25, dashType: 'dash' } });
      txt(s, c, { x, y, w, h: 0.5, fontSize: 13, align: 'center', valign: 'middle', color: ink }, `${prefix}.${i}`);
      return;
    }
    round(pptx, s, { x, y, w, h: 0.5, fill: { color: fill } }, `${prefix}.${i}`);
    txt(s, c, { x, y, w, h: 0.5, fontSize: 13, align: 'center', valign: 'middle', color: P.ink }, `${prefix}.${i}`);
  });
}

function pair(pptx, s, y, left, right) {
  const h = 1.35;
  const ink = card(pptx, s, { x: M, y, w: 5.4, h, bar: false }, left.key, 0);
  txt(s, left.label, { x: M + 0.3, y: y + 0.2, w: 4.8, h: 0.3, fontSize: 12, color: P.sub });
  txt(s, left.text, { x: M + 0.3, y: y + 0.55, w: 4.8, h: 0.65, fontSize: 18, bold: true, color: NOMAD ? ink : P.ink }, left.key);
  const rx = M + 5.8;
  const box = { x: rx, y, w: CW - 5.8, h, fill: { color: P.navy } };
  if (NOMAD) round(pptx, s, { ...box, rectRadius: 0.14 }, right.key);
  else rect(pptx, s, box, right.key);
  txt(s, right.label, { x: rx + 0.3, y: y + 0.2, w: CW - 6.4, h: 0.3, fontSize: 12, color: P.navyLabel });
  txt(s, right.text, { x: rx + 0.3, y: y + 0.55, w: CW - 6.4, h: 0.65, fontSize: 18, bold: true, color: P.onNavyAccent }, right.key);
}

/* ---- classic 深色頁 ---- */
function darkSlide(pptx, s, slide) {
  const isCover = slide.type === 'cover';
  txt(s, slide.kicker, { x: M, y: 2.35, w: CW, h: 0.35, fontSize: 14, bold: true, color: P.darkAccent, align: 'center', charSpacing: 6 }, 'kicker');
  txt(s, slide.title, { x: M, y: 2.8, w: CW, h: 1.05, fontSize: isCover ? 40 : 36, bold: true, color: P.darkText, align: 'center', valign: 'middle' }, 'title');
  rect(pptx, s, { x: W / 2 - 1, y: 4.05, w: 2, h: 0.04, fill: { color: P.darkAccent } });
  txt(s, slide.subtitle, { x: M, y: 4.3, w: CW, h: 0.45, fontSize: 16, italic: true, color: P.darkSub, align: 'center' }, 'subtitle');
  if (isCover) txt(s, slide.meta, { x: M, y: 5.0, w: CW, h: 0.4, fontSize: 13, color: P.darkSub, align: 'center' }, 'meta');
}

function closingSlide(pptx, s, slide) {
  txt(s, slide.kicker, { x: M, y: 0.9, w: CW, h: 0.35, fontSize: 14, bold: true, color: P.darkAccent, align: 'center', charSpacing: 6 }, 'kicker');
  txt(s, slide.title, { x: M, y: 1.3, w: CW, h: 0.9, fontSize: 34, bold: true, color: P.darkText, align: 'center', valign: 'middle' }, 'title');
  txt(s, slide.subtitle, { x: M, y: 2.25, w: CW, h: 0.4, fontSize: 15, italic: true, color: P.darkSub, align: 'center' }, 'subtitle');
  if (slide.confirm) {
    rect(pptx, s, { x: M + 1, y: 2.95, w: CW - 2, h: 0.95, fill: { color: P.darkBox }, line: { color: P.darkAccent, width: 1 } }, 'confirm');
    txt(s, slide.confirm, { x: M + 1.3, y: 2.95, w: CW - 2.6, h: 0.95, fontSize: 18, bold: true, color: P.darkAccent, align: 'center', valign: 'middle' }, 'confirm');
  }
  slide.steps.forEach((step, k) => {
    const y = 4.25 + k * 0.68;
    round(pptx, s, { x: M + 2, y, w: CW - 4, h: 0.55, fill: { color: P.darkBox } }, `steps.${k}`);
    txt(s, `${k + 1}`, { x: M + 2.15, y, w: 0.4, h: 0.55, fontSize: 16, bold: true, color: P.darkAccent, valign: 'middle' });
    txt(s, step, { x: M + 2.65, y, w: CW - 5, h: 0.55, fontSize: 16, color: P.darkText, valign: 'middle' }, `steps.${k}`);
  });
}

/* ---- nomad 深色頁：動態模糊底＋右側玻璃卡＋膠囊標籤 ---- */
function nomadBackdrop(pptx, s, hasPhoto) {
  if (hasPhoto) {
    rect(pptx, s, { x: 0, y: 0, w: W, h: H, fill: { color: '000000', transparency: 62 }, line: { color: P.darkAccent, transparency: 100 } });
    return;
  }
  [
    [2.2, 0.06, 35],
    [2.45, 0.22, 78],
    [3.3, 0.04, 55],
    [4.6, 0.1, 40],
    [4.85, 0.3, 82],
    [5.5, 0.05, 60],
  ].forEach(([y, h, t]) => rect(pptx, s, { x: 0, y, w: W, h, fill: { color: P.darkAccent, transparency: t }, line: { color: P.darkAccent, transparency: 100 } }));
}

function glassCard(pptx, s, x, y, w, h) {
  s.addShape(pptx.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.3, fill: { color: 'FFFFFF', transparency: 88 }, line: { color: 'FFFFFF', width: 1.5 } });
  ['規劃', '作品', '自由'].forEach((label, i) =>
    txt(s, label, { x: x + 0.45 + i * ((w - 0.9) / 3), y: y + 0.3, w: (w - 0.9) / 3, h: 0.3, fontSize: 11, color: P.darkText, align: i === 0 ? 'left' : i === 1 ? 'center' : 'right' })
  );
}

function nomadDark(pptx, s, slide, tag, hasPhoto) {
  nomadBackdrop(pptx, s, hasPhoto);
  const closing = slide.type === 'closing';
  const x = closing ? 4.2 : 5.75;
  const w = W - x - 0.9;
  const y = closing ? 0.55 : 1.55;
  const h = closing ? 5.9 : 4.0;
  glassCard(pptx, s, x, y, w, h);
  const ix = x + 0.45;
  const iw = w - 0.9;
  let cy = y + 0.85;
  txt(s, slide.kicker, { x: ix, y: cy, w: iw, h: 0.3, fontSize: 12, bold: true, color: P.darkAccent, charSpacing: 4 }, 'kicker');
  cy += 0.35;
  const titleH = closing ? 0.85 : 1.1;
  txt(s, slide.title, { x: ix, y: cy, w: iw, h: titleH, fontSize: slide.type === 'cover' ? 40 : 34, bold: true, color: P.darkText, valign: 'middle', fontFace: P.titleFont }, 'title');
  cy += titleH + 0.1;
  const scriptSub = slide.type === 'cover';
  txt(s, slide.subtitle, { x: ix, y: cy, w: iw, h: 0.55, fontSize: scriptSub ? 22 : 15, color: P.darkSub, ...(scriptSub ? { fontFace: 'Segoe Script' } : {}) }, 'subtitle');
  cy += 0.6;
  txt(s, '•••', { x: ix, y: cy, w: 1, h: 0.3, fontSize: 14, color: P.darkText });
  cy += 0.4;
  if (slide.type === 'cover') txt(s, slide.meta, { x: ix, y: y + h - 0.65, w: iw, h: 0.35, fontSize: 12, bold: true, italic: true, color: P.darkText }, 'meta');
  if (closing) {
    if (slide.confirm) {
      s.addShape(pptx.ShapeType.roundRect, { x: ix, y: cy, w: iw, h: 0.95, rectRadius: 0.15, fill: fillOf({ fill: { color: 'FFFFFF', transparency: 90 } }, 'confirm'), line: { color: 'FFFFFF', width: 1 } });
      txt(s, slide.confirm, { x: ix + 0.25, y: cy, w: iw - 0.5, h: 0.95, fontSize: 16, bold: true, color: P.darkText, valign: 'middle' }, 'confirm');
      cy += 1.15;
    }
    slide.steps.forEach((step, k) => {
      s.addShape(pptx.ShapeType.roundRect, { x: ix, y: cy, w: iw, h: 0.55, rectRadius: 0.12, fill: fillOf({ fill: { color: 'FFFFFF', transparency: 92 } }, `steps.${k}`), line: { color: 'FFFFFF', width: 0.75 } });
      txt(s, `${k + 1}`, { x: ix + 0.2, y: cy, w: 0.4, h: 0.55, fontSize: 15, bold: true, color: P.darkAccent, valign: 'middle' });
      txt(s, step, { x: ix + 0.65, y: cy, w: iw - 0.85, h: 0.55, fontSize: 15, color: P.darkText, valign: 'middle' }, `steps.${k}`);
      cy += 0.68;
    });
  }
  const pillW = Math.min(4.2, 0.6 + tag.length * 0.13);
  s.addShape(pptx.ShapeType.roundRect, { x: W - 0.9 - pillW, y: closing ? 6.6 : 5.9, w: pillW, h: 0.42, rectRadius: 0.2, fill: { color: '000000', transparency: 75 }, line: { color: 'FFFFFF', width: 1 } });
  txt(s, tag, { x: W - 0.9 - pillW, y: closing ? 6.6 : 5.9, w: pillW, h: 0.42, fontSize: 11, italic: true, color: P.darkText, align: 'center', valign: 'middle' });
}

/* ---- nomad 淺色頁：護照紙＋圓形入境章 ---- */
function nomadPaper(pptx, s) {
  s.addShape(pptx.ShapeType.roundRect, { x: 0.25, y: 0.22, w: W - 0.5, h: H - 0.44, rectRadius: 0.08, fill: { color: P.bg, transparency: 100 }, line: { color: P.ink, width: 0.75, dashType: 'sysDot', transparency: 55 } });
  const sx = W - 2.55;
  const sy = 0.3;
  const d = 1.75;
  s.addShape(pptx.ShapeType.ellipse, { x: sx, y: sy, w: d, h: d, fill: { color: P.bg, transparency: 100 }, line: { color: P.inks[2], width: 2.25, transparency: 25 } });
  s.addShape(pptx.ShapeType.ellipse, { x: sx + 0.1, y: sy + 0.1, w: d - 0.2, h: d - 0.2, fill: { color: P.bg, transparency: 100 }, line: { color: P.inks[2], width: 0.75, transparency: 25 } });
  txt(s, 'ADMITTED', { x: sx, y: sy + 0.38, w: d, h: 0.25, fontSize: 8, color: P.inks[2], align: 'center', charSpacing: 3, rotate: -14 });
  txt(s, 'DEMO', { x: sx, y: sy + 0.6, w: d, h: 0.5, fontSize: 24, bold: true, color: P.inks[2], align: 'center', valign: 'middle', fontFace: P.titleFont, rotate: -14 });
  txt(s, 'NOMAD NOTES', { x: sx + 0.1, y: sy + 1.1, w: d - 0.2, h: 0.25, fontSize: 7, color: P.inks[2], align: 'center', rotate: -14 });
}

function lightSlide(pptx, s, slide, num) {
  head(pptx, s, slide, num);
  const top = 2.6;
  if (slide.type === 'cards') {
    const n = Math.max(1, slide.cards.length);
    const gap = 0.35;
    const w = (CW - gap * (n - 1)) / n;
    const h = slide.banner ? 2.1 : 2.8;
    slide.cards.forEach((c, k) => {
      const x = M + k * (w + gap);
      const ink = card(pptx, s, { x, y: top, w, h }, `cards.${k}`, k);
      txt(s, c.label || `第${CN_NUM[k] || k + 1}`, { x: x + 0.3, y: top + 0.3, w: w - 0.6, h: 0.3, fontSize: 12, color: ink, bold: true }, `cards.${k}.label`);
      txt(s, c.title, { x: x + 0.3, y: top + 0.7, w: w - 0.6, h: 0.6, fontSize: 19, bold: true, color: NOMAD ? ink : P.ink }, `cards.${k}.title`);
      txt(s, c.text, { x: x + 0.3, y: top + 1.35, w: w - 0.6, h: h - 1.5, fontSize: 13, color: P.sub }, `cards.${k}.text`);
    });
    if (slide.banner) banner(pptx, s, { x: M, y: 5.05, w: CW, h: 0.95 }, 'banner', slide.banner);
  } else if (slide.type === 'grid') {
    const gap = 0.4;
    const w = (CW - gap) / 2;
    const h = 1.95;
    slide.items.forEach((c, k) => {
      const x = M + (k % 2) * (w + gap);
      const y = top + Math.floor(k / 2) * (h + 0.3);
      const ink = card(pptx, s, { x, y, w, h, muted: c.muted }, `items.${k}`, k);
      txt(s, c.label || `方向${CN_NUM[k] || k + 1}`, { x: x + 0.3, y: y + 0.25, w: w - 0.6, h: 0.28, fontSize: 11, bold: true, color: c.muted ? P.mutedText : ink }, `items.${k}.label`);
      txt(s, c.title, { x: x + 0.3, y: y + 0.55, w: w - 0.6, h: 0.5, fontSize: 20, bold: true, color: c.muted ? P.sub : NOMAD ? ink : P.ink }, `items.${k}.title`);
      txt(s, c.tags, { x: x + 0.3, y: y + 1.1, w: w - 0.6, h: 0.32, fontSize: 12, color: P.sub }, `items.${k}.tags`);
      txt(s, c.flow, { x: x + 0.3, y: y + 1.45, w: w - 0.6, h: 0.35, fontSize: 12, italic: true, color: c.muted ? P.mutedText : P.ink }, `items.${k}.flow`);
    });
  } else if (slide.type === 'flow') {
    let y = top;
    if (slide.chips.length) {
      txt(s, slide.chipsLabel, { x: M, y, w: CW, h: 0.3, fontSize: 12, bold: true, color: P.sub });
      chips(pptx, s, slide.chips, y + 0.35, P.warm, 'chips', 1);
      y += 1.05;
    }
    if (slide.steps.length) {
      txt(s, slide.stepsLabel, { x: M, y, w: CW, h: 0.3, fontSize: 12, bold: true, color: P.sub });
      const n = slide.steps.length;
      const aw = 0.45;
      const w = (CW - aw * (n - 1)) / n;
      slide.steps.forEach((st, k) => {
        const x = M + k * (w + aw);
        const last = k === n - 1;
        const box = { x, y: y + 0.35, w, h: 0.95 };
        if (NOMAD && !last) {
          const f = fillOf({ fill: { color: P.bg } }, `steps.${k}`);
          s.addShape(pptx.ShapeType.roundRect, { ...box, rectRadius: 0.08, fill: f, line: { color: P.navy, width: 2 } });
        } else {
          rect(pptx, s, { ...box, fill: { color: last ? P.last : P.navy } }, `steps.${k}`);
        }
        txt(s, st, { x: x + 0.1, y: y + 0.35, w: w - 0.2, h: 0.95, fontSize: 16, bold: true, color: NOMAD && !last ? P.navy : 'FFFFFF', align: 'center', valign: 'middle' }, `steps.${k}`);
        if (!last) txt(s, '→', { x: x + w, y: y + 0.35, w: aw, h: 0.95, fontSize: 18, color: P.sub, align: 'center', valign: 'middle' });
      });
      y += 1.5;
    }
    pair(pptx, s, Math.max(y, 5.2), { label: slide.gainLabel, text: slide.gain, key: 'gain' }, { label: slide.mapLabel, text: slide.map, key: 'map' });
  } else if (slide.type === 'plan') {
    txt(s, slide.focusLabel, { x: M, y: top, w: CW, h: 0.3, fontSize: 12, bold: true, color: P.sub });
    chips(pptx, s, slide.focus, top + 0.4, P.cool, 'focus', 2);
    pair(pptx, s, 4.0, { label: slide.goalLabel, text: slide.goal, key: 'goal' }, { label: slide.alsoLabel, text: slide.also, key: 'also' });
  } else if (slide.type === 'quote') {
    const n = Math.max(1, slide.quotes.length);
    const h = slide.confirm ? Math.min(0.9, (2.85 - 0.18 * (n - 1)) / n) : Math.min(1.2, 3.6 / n);
    slide.quotes.forEach((q, k) => {
      const y = top + k * (h + 0.18);
      const ink = card(pptx, s, { x: M, y, w: CW, h, bar: false }, `quotes.${k}`, k);
      if (!NOMAD) rect(pptx, s, { x: M, y, w: 0.08, h, fill: { color: P.accent } });
      txt(s, `「${q.text}」`, { x: M + 0.35, y, w: CW - 2.6, h, fontSize: 17, valign: 'middle', color: NOMAD ? ink : P.ink }, `quotes.${k}.text`);
      txt(s, q.who, { x: W - M - 2.1, y, w: 1.9, h, fontSize: 11, color: P.sub, align: 'right', valign: 'middle', ...(NOMAD ? { fontFace: P.dotFont } : {}) }, `quotes.${k}.who`);
    });
    if (slide.confirm) banner(pptx, s, { x: M, y: 5.75, w: CW, h: 0.95 }, 'confirm', slide.confirm);
  } else if (slide.type === 'qa') {
    const n = slide.items.length;
    const cols = n > 2 ? 2 : 1;
    const gap = 0.35;
    const w = (CW - gap * (cols - 1)) / cols;
    const rows = Math.ceil(n / cols);
    const h = (4.3 - 0.3 * (rows - 1)) / Math.max(1, rows);
    slide.items.forEach((x, k) => {
      const cx = M + (k % cols) * (w + gap);
      const cy = top + Math.floor(k / cols) * (h + 0.3);
      const ink = card(pptx, s, { x: cx, y: cy, w, h, bar: false }, `items.${k}`, k);
      s.addText(
        [
          { text: 'Q  ', options: { color: NOMAD ? ink : P.accent, bold: true } },
          { text: x.q, options: styled({ color: P.ink, bold: true }, `items.${k}.q`) },
        ],
        { x: cx + 0.3, y: cy + 0.2, w: w - 0.6, h: 0.6, fontFace: F.font, fontSize: 16, valign: 'top', margin: 0, fit: 'shrink' }
      );
      txt(s, x.a, { x: cx + 0.3, y: cy + 0.85, w: w - 0.6, h: h - 1.0, fontSize: 13, color: P.sub }, `items.${k}.a`);
    });
  }
}

function addImages(s, slide, images, bg) {
  (slide.images || [])
    .filter((im) => im.bg === bg)
    .forEach((im) => {
      const data = images?.get?.(im.id);
      if (!data) return;
      if (bg) {
        s.addImage({ data, x: 0, y: 0, w: W, h: W * im.ratio, sizing: { type: 'cover', w: W, h: H } });
        return;
      }
      const w = (im.w / 100) * W;
      s.addImage({ data, x: (im.x / 100) * W, y: (im.y / 100) * H, w, h: w * im.ratio });
    });
}

/**
 * 依 deck 建 PptxGenJS 簡報（不寫檔，方便測試）
 * @param {Map<string,string>} [images] imageId → data URL
 */
export function buildDeckPptx(PptxGenJS, deck, { images } = {}) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = deck.title;
  pptx.company = 'Call Coach';
  const nums = slideNumbers(deck.slides);
  const total = deck.slides.length;
  NOMAD = deck.theme?.style === 'nomad';
  P = NOMAD ? PALETTES.nomad : PALETTES.classic;
  const tag = deck.customer ? `${deck.customer} · Nomad Notes` : 'Digital Nomad';
  deck.slides.forEach((slide, i) => {
    F = { text: slide.fmt?.text || {}, blocks: slide.fmt?.blocks || {}, font: deck.theme?.font || P.font };
    const dark = slide.type === 'cover' || slide.type === 'section' || slide.type === 'closing';
    const hasPhoto = (slide.images || []).some((im) => im.bg && images?.get?.(im.id));
    const s = pptx.addSlide();
    s.background = { color: slide.fmt?.bg ? hex(slide.fmt.bg) : dark ? P.darkBg : P.bg };
    addImages(s, slide, images, true);
    if (NOMAD && dark) nomadDark(pptx, s, slide, tag, hasPhoto);
    else if (slide.type === 'cover' || slide.type === 'section') darkSlide(pptx, s, slide);
    else if (slide.type === 'closing') closingSlide(pptx, s, slide);
    else {
      if (NOMAD) nomadPaper(pptx, s);
      lightSlide(pptx, s, slide, nums[i]);
    }
    addImages(s, slide, images, false);
    page(s, i, total, dark);
    const notes = [slide.notes, slide.why && `【這頁回應客戶】${slide.why}`].filter(Boolean).join('\n\n');
    if (notes) s.addNotes(notes);
  });
  F = { text: {}, blocks: {}, font: PALETTES.classic.font };
  P = PALETTES.classic;
  NOMAD = false;
  return pptx;
}

export async function exportDeckPptx(deck, fileName, { images } = {}) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = buildDeckPptx(PptxGenJS, deck, { images });
  await pptx.writeFile({ fileName });
}
