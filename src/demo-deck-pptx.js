/**
 * DEMO 簡報 → .pptx（PptxGenJS，寬螢幕 13.33×7.5 in）。
 * 版型對齊 HTML 預覽：classic＝深藍章節頁＋淺底卡片頁；nomad＝數位游牧（動態模糊底＋玻璃卡、護照紙＋印章卡片）；
 * gallery＝藝廊品牌（駝色封面＋棋盤格、章節巨型編號、實色卡片＋偏移陰影、品牌手冊頁尾）。
 * 編輯器的文字格式、圖塊色、背景色、圖片都會帶過去；講者備註＝notes＋這頁回應客戶的哪一點。
 */
import { sectionNumbers, slideNumbers } from './demo-deck.js';
import { MARBLE_RATIO, marbleJpeg, ringEllipses } from './demo-deck-texture.js';

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
    stepLine: '22356F',
  },
  gallery: {
    bg: 'F4EFE6',
    darkBg: 'D8B48C',
    ink: '161616',
    accent: '2F55D4',
    sub: '6B3A1E',
    line: 'D5CCBE',
    cardFill: 'FBF8F2',
    bar: '',
    navy: '6B3A1E',
    onNavyAccent: 'F4EFE6',
    navyLabel: 'E6CBA8',
    last: '6B3A1E',
    warm: 'D8B48C',
    cool: '161616',
    muted: 'F4EFE6',
    mutedText: 'A39A8C',
    darkText: '161616',
    darkSub: '6B3A1E',
    darkAccent: '161616',
    darkBox: '161616',
    darkPage: '161616',
    font: 'Microsoft JhengHei',
    titleFont: '',
    dotFont: '',
    numFont: 'Arial Black',
    tan2: 'E6CBA8',
    shadow: 'CDC3B4',
    cardFills: ['FBF8F2', 'D8B48C', '6B3A1E'],
    stepLine: '161616',
  },
};

/** 紫色潮流：深紫／薰衣草兩種底色輪替；line＝框線與強調色、card＝實色塊、cardInk＝實色塊上的字 */
function violetTone(lav) {
  const t = lav
    ? { bg: 'B48CF0', fg: '160D22', mut: '3B2560', line: '160D22', soft: '8F69C9', card: '1E1230', cardInk: 'F3ECFF' }
    : { bg: '1E1230', fg: 'F3ECFF', mut: 'C9A9F7', line: 'B48CF0', soft: '4A3570', card: 'C9A8F7', cardInk: '160D22' };
  return {
    bg: t.bg,
    darkBg: '1E1230',
    ink: t.fg,
    accent: t.line,
    sub: t.mut,
    line: t.soft,
    cardFill: t.card,
    cardInk: t.cardInk,
    bar: '',
    navy: t.line,
    onNavyAccent: t.bg,
    navyLabel: t.bg,
    last: t.line,
    warm: t.card,
    cool: t.bg,
    muted: t.bg,
    mutedText: t.mut,
    darkText: t.fg,
    darkSub: t.mut,
    darkAccent: t.line,
    darkBox: t.card,
    darkPage: t.line,
    font: 'Microsoft JhengHei',
    titleFont: '',
    dotFont: '',
    numFont: 'Arial Black',
    stepLine: t.line,
    lav,
  };
}
PALETTES.violet = violetTone(false);

PALETTES.noir = {
  bg: 'FFFFFF',
  darkBg: '0B0B0B',
  ink: '0B0B0B',
  accent: '0B0B0B',
  sub: '555555',
  line: 'DADADA',
  cardFill: 'F1F1F1',
  bar: '',
  navy: '0B0B0B',
  onNavyAccent: 'FFFFFF',
  navyLabel: 'BDBDBD',
  last: '0B0B0B',
  warm: '0B0B0B',
  cool: 'FFFFFF',
  muted: 'FFFFFF',
  mutedText: '8C8C8C',
  darkText: 'FFFFFF',
  darkSub: 'BDBDBD',
  darkAccent: 'FFFFFF',
  darkBox: 'FFFFFF',
  darkPage: '8C8C8C',
  font: 'Microsoft JhengHei',
  titleFont: '',
  dotFont: '',
  numFont: 'Arial',
  stepLine: '0B0B0B',
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
let GALLERY = false;
let VIOLET = false;
let NOIR = false;
/** 卡片上的次要文字色：藝廊品牌的可可棕卡片要用淺色；紫色潮流跟著塊色；黑色俐落黑塊用淺灰 */
const subOf = (ink) => (VIOLET ? ink : NOIR ? (ink === 'FFFFFF' ? P.navyLabel : P.sub) : GALLERY && ink === P.onNavyAccent ? P.navyLabel : P.sub);
/** 卡片標題等主要文字是否跟著卡片墨色走 */
const inked = () => NOMAD || GALLERY || VIOLET || NOIR;

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

/** 淺底卡片：classic＝白卡＋橘色上緣；nomad＝護照印章（雙框、輪替墨色、保持水平） */
function card(pptx, s, o, key, k = 0) {
  if (NOIR) {
    const base = { x: o.x, y: o.y, w: o.w, h: o.h, rectRadius: 0.1 };
    if (o.muted) {
      round(pptx, s, { ...base, fill: { color: P.bg }, line: { color: P.line, width: 1, dashType: 'dash' } }, key);
      return P.mutedText;
    }
    const solid = k % 2 === 0;
    round(pptx, s, { ...base, fill: { color: solid ? P.navy : P.cardFill } }, key);
    return solid ? P.onNavyAccent : P.ink;
  }
  if (VIOLET) {
    if (o.muted) {
      rect(pptx, s, { x: o.x, y: o.y, w: o.w, h: o.h, fill: { color: P.bg }, line: { color: P.line, width: 1, dashType: 'dash' } }, key);
      return P.mutedText;
    }
    if (k % 2 === 0) {
      rect(pptx, s, { x: o.x, y: o.y, w: o.w, h: o.h, fill: { color: P.cardFill } }, key);
      return P.cardInk;
    }
    rect(pptx, s, { x: o.x, y: o.y, w: o.w, h: o.h, fill: { color: P.bg }, line: { color: P.accent, width: 1.25 } }, key);
    return P.ink;
  }
  if (GALLERY) {
    if (o.muted) {
      rect(pptx, s, { x: o.x, y: o.y, w: o.w, h: o.h, fill: { color: P.bg }, line: { color: P.mutedText, width: 1, dashType: 'dash' } }, key);
      return P.mutedText;
    }
    const fill = P.cardFills[k % P.cardFills.length];
    const dark = fill === P.navy;
    rect(pptx, s, { x: o.x + 0.11, y: o.y + 0.11, w: o.w, h: o.h, fill: { color: P.shadow } });
    rect(pptx, s, { x: o.x, y: o.y, w: o.w, h: o.h, fill: { color: fill }, line: { color: dark ? fill : P.ink, width: 1 } }, key);
    return dark ? P.onNavyAccent : P.ink;
  }
  if (!NOMAD) {
    rect(pptx, s, { ...o, fill: { color: o.muted ? P.muted : P.cardFill }, line: { color: P.line, width: 1 } }, key);
    if (o.bar !== false) rect(pptx, s, { x: o.x, y: o.y, w: o.w, h: 0.08, fill: { color: o.muted ? 'C9CDD5' : P.bar } });
    return P.accent;
  }
  const ink = o.muted ? P.mutedText : P.inks[k % P.inks.length];
  const fill = fillOf({ fill: { color: o.muted ? P.muted : P.cardFill } }, key);
  const base = { x: o.x, y: o.y, w: o.w, h: o.h, rectRadius: 0.14 };
  s.addShape(pptx.ShapeType.roundRect, { ...base, fill, line: { color: ink, width: 2.25, dashType: o.muted ? 'dash' : 'solid' } });
  s.addShape(pptx.ShapeType.roundRect, {
    x: o.x + 0.07,
    y: o.y + 0.07,
    w: o.w - 0.14,
    h: o.h - 0.14,
    rectRadius: 0.1,
    fill: { color: fill.color, transparency: 100 },
    line: { color: ink, width: 0.75 },
  });
  return ink;
}

/** 深色圖塊（橫幅、確認句）：nomad 變成紅色雙框印章 */
function banner(pptx, s, o, key, text) {
  if (NOIR) {
    round(pptx, s, { ...o, rectRadius: 0.1, fill: { color: P.navy } }, key);
    s.addShape(pptx.ShapeType.ellipse, { x: o.x + 0.21, y: o.y + o.h / 2 - 0.067, w: 0.133, h: 0.133, fill: { color: P.navy, transparency: 100 }, line: { color: 'FFFFFF', width: 1.25 } });
    txt(s, text, { x: o.x + 0.55, y: o.y, w: o.w - 0.85, h: o.h, fontSize: 17, bold: true, color: 'FFFFFF', valign: 'middle' }, key);
    return;
  }
  if (VIOLET) {
    rect(pptx, s, { ...o, fill: { color: P.accent } }, key);
    sparkle(pptx, s, o.x + 0.2, o.y + o.h / 2 - 0.09, 0.18, P.bg);
    txt(s, text, { x: o.x + 0.55, y: o.y, w: o.w - 0.85, h: o.h, fontSize: 17, bold: true, color: P.bg, valign: 'middle' }, key);
    return;
  }
  if (GALLERY) {
    rect(pptx, s, { x: o.x + 0.11, y: o.y + 0.11, w: o.w, h: o.h, fill: { color: P.warm } });
    rect(pptx, s, { ...o, fill: { color: P.ink } }, key);
    rect(pptx, s, { x: o.x + 0.2, y: o.y + o.h / 2 - 0.06, w: 0.12, h: 0.12, fill: { color: P.accent } });
    txt(s, text, { x: o.x + 0.5, y: o.y, w: o.w - 0.8, h: o.h, fontSize: 18, bold: true, color: P.onNavyAccent, valign: 'middle' }, key);
    return;
  }
  if (!NOMAD) {
    rect(pptx, s, { ...o, fill: { color: P.navy } }, key);
    txt(s, text, { x: o.x + 0.4, y: o.y, w: o.w - 0.8, h: o.h, fontSize: 18, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle' }, key);
    return;
  }
  const fill = fillOf({ fill: { color: P.bg } }, key);
  s.addShape(pptx.ShapeType.roundRect, { ...o, rectRadius: 0.12, fill, line: { color: P.accent, width: 2.5 } });
  s.addShape(pptx.ShapeType.roundRect, {
    x: o.x + 0.08,
    y: o.y + 0.08,
    w: o.w - 0.16,
    h: o.h - 0.16,
    rectRadius: 0.08,
    fill: { color: fill.color, transparency: 100 },
    line: { color: P.accent, width: 0.75 },
  });
  txt(s, text, { x: o.x + 0.4, y: o.y, w: o.w - 0.8, h: o.h, fontSize: 18, bold: true, color: P.accent, align: 'center', valign: 'middle' }, key);
}

function page(s, i, total, dark) {
  if (NOMAD && !dark) {
    txt(s, `N° ${pad(i + 1)} / ${pad(total)}`, { x: M, y: 6.85, w: 4, h: 0.4, fontFace: P.dotFont, fontSize: 16, color: P.ink, charSpacing: 3 });
    return;
  }
  txt(s, `${pad(i + 1)} / ${pad(total)}`, { x: W - 1.6, y: 7.05, w: 1.2, h: 0.25, fontSize: 9, color: dark ? P.darkPage : P.mutedText, align: 'right' });
}

/** 手繪橢圓圈（品牌手冊圈重點字）：只是裝飾框，文字仍水平 */
function oval(pptx, s, x, y, text, fontSize) {
  const w = Math.min(6, 0.5 + [...String(text || '')].length * fontSize * 0.019);
  s.addShape(pptx.ShapeType.ellipse, { x: x - 0.22, y: y - 0.1, w, h: fontSize * 0.0145 + 0.22, rotate: -3, fill: { color: 'FFFFFF', transparency: 100 }, line: { color: P.ink, width: 1 } });
}

function galleryHead(pptx, s, slide, num) {
  rect(pptx, s, { x: M, y: 0.45, w: 0.42, h: 0.06, fill: { color: P.ink } });
  const kx = num ? M + 1.05 : M + 0.22;
  if (num) {
    txt(s, `${pad(num)}°`, { x: M, y: 0.68, w: 0.6, h: 0.3, fontFace: P.numFont, fontSize: 12, color: P.accent });
    txt(s, '｜', { x: M + 0.6, y: 0.68, w: 0.3, h: 0.3, fontSize: 12, color: P.line });
  }
  if (slide.kicker) oval(pptx, s, kx, 0.68, slide.kicker, 12);
  txt(s, slide.kicker, { x: kx, y: 0.68, w: CW - 1.4, h: 0.3, fontSize: 12, bold: true, color: P.ink, charSpacing: 2 }, 'kicker');
  txt(s, slide.title, { x: M, y: 1.0, w: CW, h: 0.88, fontSize: 26, bold: true, color: P.ink, valign: 'top', lineSpacingMultiple: 1.1, fit: 'none' }, 'title');
  txt(s, slide.subtitle, { x: M, y: 1.92, w: CW, h: 0.3, fontSize: 13, color: P.sub, fit: 'none' }, 'subtitle');
  s.addShape(pptx.ShapeType.line, { x: M, y: 2.3, w: CW, h: 0, line: { color: P.line, width: 1 } });
}

function sparkle(pptx, s, x, y, d, color) {
  s.addShape(pptx.ShapeType.star4, { x, y, w: d, h: d, fill: { color }, line: { color, width: 0 }, adj: 0.12 });
}

/** 紫色潮流頁首：位置／字級與藝廊品牌相同，只換成星芒與圈叉圖示 */
function violetHead(pptx, s, slide, num) {
  sparkle(pptx, s, M, 0.45, 0.16, P.accent);
  const kx = num ? M + 0.75 : M;
  if (num) {
    txt(s, pad(num), { x: M, y: 0.68, w: 0.5, h: 0.3, fontFace: P.numFont, fontSize: 12, color: P.accent });
    txt(s, '｜', { x: M + 0.45, y: 0.68, w: 0.3, h: 0.3, fontSize: 12, color: P.line });
  }
  txt(s, slide.kicker, { x: kx, y: 0.68, w: CW - 1.4, h: 0.3, fontSize: 12, bold: true, color: P.accent, charSpacing: 3 }, 'kicker');
  txt(s, String(slide.title || '').toUpperCase(), { x: M, y: 1.0, w: CW - 0.7, h: 0.88, fontSize: 26, bold: true, color: P.ink, valign: 'top', lineSpacingMultiple: 1.1, fit: 'none' }, 'title');
  txt(s, slide.subtitle, { x: M, y: 1.92, w: CW, h: 0.3, fontSize: 13, color: P.sub, fit: 'none' }, 'subtitle');
  s.addShape(pptx.ShapeType.line, { x: M, y: 2.3, w: CW, h: 0, line: { color: P.line, width: 1 } });
  const d = 0.43;
  const x = W - M - d;
  const y = 0.45;
  const o = (d / 2) * (1 - Math.SQRT1_2);
  s.addShape(pptx.ShapeType.ellipse, { x, y, w: d, h: d, fill: { color: P.bg, transparency: 100 }, line: { color: P.accent, width: 1 } });
  s.addShape(pptx.ShapeType.line, { x: x + o, y: y + o, w: d - 2 * o, h: d - 2 * o, line: { color: P.accent, width: 0.75 } });
  s.addShape(pptx.ShapeType.line, { x: x + o, y: y + o, w: d - 2 * o, h: d - 2 * o, flipH: true, line: { color: P.accent, width: 0.75 } });
}

/** 黑色俐落頁首：位置／字級同藝廊品牌；內容頁先鋪黑色頁首帶＋右上小光環 */
function noirHead(pptx, s, slide, num, dark) {
  if (!dark) {
    rect(pptx, s, { x: 0, y: 0, w: W, h: 2.3, fill: { color: P.navy } });
    ring(pptx, s, W - M - 1.05, 1.15, 2.1, 0.3);
  }
  rect(pptx, s, { x: M, y: 0.45, w: 0.42, h: 0.06, fill: { color: 'FFFFFF' } });
  const kx = num ? M + 0.75 : M;
  if (num) {
    txt(s, pad(num), { x: M, y: 0.68, w: 0.5, h: 0.3, fontFace: P.numFont, fontSize: 12, bold: true, color: 'FFFFFF' });
    txt(s, '｜', { x: M + 0.45, y: 0.68, w: 0.3, h: 0.3, fontSize: 12, color: '444444' });
  }
  txt(s, slide.kicker, { x: kx, y: 0.68, w: CW - 3.2, h: 0.3, fontSize: 12, bold: true, color: P.mutedText, charSpacing: 3 }, 'kicker');
  txt(s, slide.title, { x: M, y: 1.0, w: CW - 2.4, h: 0.88, fontSize: 26, bold: true, color: 'FFFFFF', valign: 'top', lineSpacingMultiple: 1.1, fit: 'none' }, 'title');
  txt(s, slide.subtitle, { x: M, y: 1.92, w: CW - 2.4, h: 0.3, fontSize: 13, color: P.navyLabel, fit: 'none' }, 'subtitle');
}

/** 線條光環：與 HTML 同一組旋轉橢圓（ringEllipses） */
function ring(pptx, s, cx, cy, d, width) {
  const ox = cx - d / 2;
  const oy = cy - d / 2;
  ringEllipses().forEach((e) =>
    s.addShape(pptx.ShapeType.ellipse, {
      x: ox + (e.cx - e.rx) * d,
      y: oy + (e.cy - e.ry) * d,
      w: e.rx * 2 * d,
      h: e.ry * 2 * d,
      rotate: Math.round(e.rot * 10) / 10,
      fill: { color: '000000', transparency: 100 },
      line: { color: 'FFFFFF', width, transparency: 40 },
    })
  );
}

function head(pptx, s, slide, num) {
  if (NOIR) return noirHead(pptx, s, slide, num, false);
  if (VIOLET) return violetHead(pptx, s, slide, num);
  if (GALLERY) return galleryHead(pptx, s, slide, num);
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
    if (NOIR) {
      const solid = fill === P.warm;
      const f = fillOf({ fill: { color: solid ? P.navy : P.bg } }, `${prefix}.${i}`);
      s.addShape(pptx.ShapeType.roundRect, { x, y, w, h: 0.5, rectRadius: 0.25, fill: f, line: { color: P.navy, width: 1 } });
      txt(s, c, { x, y, w, h: 0.5, fontSize: 13, align: 'center', valign: 'middle', color: solid ? 'FFFFFF' : P.ink }, `${prefix}.${i}`);
      return;
    }
    if (VIOLET) {
      const solid = fill === P.warm;
      const f = fillOf({ fill: { color: solid ? P.cardFill : P.bg } }, `${prefix}.${i}`);
      s.addShape(pptx.ShapeType.roundRect, { x, y, w, h: 0.5, rectRadius: 0.25, fill: f, line: { color: solid ? f.color : P.accent, width: 1 } });
      txt(s, c, { x, y, w, h: 0.5, fontSize: 13, align: 'center', valign: 'middle', color: solid ? P.cardInk : P.ink }, `${prefix}.${i}`);
      return;
    }
    if (GALLERY) {
      rect(pptx, s, { x, y, w, h: 0.5, fill: { color: fill } }, `${prefix}.${i}`);
      txt(s, c, { x, y, w, h: 0.5, fontSize: 13, align: 'center', valign: 'middle', color: fill === P.ink ? P.onNavyAccent : P.ink }, `${prefix}.${i}`);
      return;
    }
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
  const ink = card(pptx, s, { x: M, y, w: 5.4, h, bar: false }, left.key, VIOLET || NOIR ? 1 : 0);
  txt(s, left.label, { x: M + 0.3, y: y + 0.2, w: 4.8, h: 0.3, fontSize: 12, color: P.sub });
  txt(s, left.text, { x: M + 0.3, y: y + 0.55, w: 4.8, h: 0.65, fontSize: 18, bold: true, color: inked() ? ink : P.ink }, left.key);
  const rx = M + 5.8;
  const box = { x: rx, y, w: CW - 5.8, h, fill: { color: P.navy } };
  if (GALLERY) rect(pptx, s, { x: rx + 0.11, y: y + 0.11, w: box.w, h, fill: { color: P.shadow } });
  if (NOMAD || NOIR) round(pptx, s, { ...box, rectRadius: NOIR ? 0.1 : 0.14 }, right.key);
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

/* ---- 藝廊品牌：駝色封面＋棋盤格／照片框、章節巨型編號、品牌手冊頁尾 ---- */
const GL_PANEL = { x: W - 0.95 - 4.0, y: 2.6, w: 4.0, h: 3.9 };

function galleryFrame(pptx, s, i, brand, meta) {
  txt(s, 'DEMO REPORT', { x: W - 0.4 - 1.5, y: H / 2 - 0.13, w: 3, h: 0.26, fontSize: 8, color: P.ink, align: 'center', charSpacing: 5, rotate: 90, transparency: 40 });
  const fy = 6.92;
  txt(s, brand || 'DEMO', { x: M, y: fy, w: 3, h: 0.33, fontFace: P.numFont, fontSize: 18, color: P.ink, valign: 'bottom' });
  txt(s, '→ Call Coach\nDemo Guidelines', { x: M + 3.4, y: fy, w: 3, h: 0.33, fontSize: 8, color: P.sub, valign: 'bottom' });
  txt(s, `→ ${meta || '有邀約開發'}`, { x: M + 6.8, y: fy, w: 3.4, h: 0.33, fontSize: 8, color: P.sub, valign: 'bottom' });
  txt(s, pad(i + 1), { x: W - M - 1.2, y: fy, w: 1.2, h: 0.33, fontFace: P.numFont, fontSize: 18, color: P.ink, align: 'right', valign: 'bottom' });
}

function galleryMark(pptx, s, lines, x, y, align = 'left') {
  rect(pptx, s, { x: align === 'left' ? x : x + 2.8 - 0.42, y, w: 0.42, h: 0.06, fill: { color: P.ink } });
  txt(s, lines.join('\n'), { x, y: y + 0.12, w: 2.8, h: 0.6, fontFace: P.numFont, fontSize: 13, color: P.ink, align, lineSpacingMultiple: 0.95 });
}

function checkerboard(pptx, s, o) {
  rect(pptx, s, { x: o.x + 0.18, y: o.y + 0.18, w: o.w, h: o.h, fill: { color: '000000', transparency: 82 } });
  rect(pptx, s, { ...o, fill: { color: P.tan2 } });
  const sz = 0.4;
  for (let r = 0; r * sz < o.h - 0.01; r++) {
    for (let c = (r % 2); c * sz < o.w - 0.01; c += 2) {
      rect(pptx, s, { x: o.x + c * sz, y: o.y + r * sz, w: Math.min(sz, o.w - c * sz), h: Math.min(sz, o.h - r * sz), fill: { color: P.navy } });
    }
  }
}

function galleryDark(pptx, s, slide, part, hasPhoto) {
  galleryHead(pptx, s, slide, 0);
  const top = 2.6;
  if (slide.type === 'cover') {
    ['規劃', '作品', '自由'].forEach((label, k) => txt(s, label, { x: W - 0.95 - 3 + k * 1.1, y: 0.68, w: 0.8, h: 0.3, fontSize: 10, bold: true, color: P.ink, align: 'right' }));
    if (hasPhoto) rect(pptx, s, { x: GL_PANEL.x + 0.18, y: GL_PANEL.y + 0.18, w: GL_PANEL.w, h: GL_PANEL.h, fill: { color: '000000', transparency: 78 } });
    else checkerboard(pptx, s, GL_PANEL);
    txt(s, slide.meta, { x: M, y: top, w: 6.6, h: 0.35, fontSize: 12, bold: true, color: P.ink }, 'meta');
    galleryMark(pptx, s, ['DEMO', 'REPORT'], M, 5.6);
    return;
  }
  if (slide.type === 'section') {
    if (!hasPhoto) txt(s, pad(part || 1), { x: W - 1.2 - 5.5, y: 2.9, w: 5.5, h: 3.6, fontFace: P.numFont, fontSize: 210, color: P.ink, align: 'right', valign: 'bottom', fit: 'none' });
    return;
  }
  const tw = 7.9;
  let y = top;
  galleryMark(pptx, s, ['THANKS FOR', 'WATCHING.'], W - 0.95 - 2.8, 5.3, 'right');
  if (slide.confirm) {
    rect(pptx, s, { x: M, y, w: tw, h: 1.0, fill: { color: P.ink } }, 'confirm');
    rect(pptx, s, { x: M, y, w: 0.08, h: 1.0, fill: { color: P.accent } });
    txt(s, slide.confirm, { x: M + 0.3, y, w: tw - 0.55, h: 1.0, fontSize: 13, bold: true, color: P.onNavyAccent, valign: 'middle' }, 'confirm');
    y += 1.2;
  }
  slide.steps.forEach((step, k) => {
    txt(s, `${k + 1}°`, { x: M, y, w: 0.6, h: 0.5, fontFace: P.numFont, fontSize: 13, color: P.sub, valign: 'middle' });
    txt(s, step, { x: M + 0.65, y, w: tw - 0.65, h: 0.5, fontSize: 13, bold: true, color: P.ink, valign: 'middle' }, `steps.${k}`);
    s.addShape(pptx.ShapeType.line, { x: M, y: y + 0.52, w: tw, h: 0, line: { color: P.ink, width: 0.75, transparency: 55 } });
    y += 0.6;
  });
}

/* ---- 紫色潮流：細框＋四角圓弧、星芒、側邊直書標籤、大理石流紋框＋描邊大字 ---- */
const VT_INSET = 0.2;
const VT_PANEL = {
  cover: { x: M, y: 3.07, w: CW, h: 3.5 },
  section: { x: M, y: 2.6, w: CW, h: 3.97 },
  closing: { x: 9.2, y: 2.6, w: W - M - 9.2, h: 3.97 },
};

function violetFrame(pptx, s, i, total, brand) {
  const none = { color: P.bg, transparency: 100 };
  s.addShape(pptx.ShapeType.rect, { x: VT_INSET, y: VT_INSET, w: W - VT_INSET * 2, h: H - VT_INSET * 2, fill: none, line: { color: P.accent, width: 0.75 } });
  const d = 0.93;
  [
    [VT_INSET, VT_INSET],
    [W - VT_INSET, VT_INSET],
    [VT_INSET, H - VT_INSET],
    [W - VT_INSET, H - VT_INSET],
  ].forEach(([cx, cy]) => s.addShape(pptx.ShapeType.ellipse, { x: cx - d / 2, y: cy - d / 2, w: d, h: d, fill: { color: P.bg }, line: { color: P.accent, width: 0.75 } }));
  sparkle(pptx, s, W / 2 - 0.11, 0.09, 0.21, P.accent);
  sparkle(pptx, s, 0.43, H - 0.4 - 0.21, 0.21, P.accent);
  const label = `${brand ? `${brand} · ` : ''}Demo plan`;
  txt(s, label, { x: 0.43 - 1.6, y: H / 2 - 0.11, w: 3.2, h: 0.22, fontSize: 8, color: P.ink, align: 'center', charSpacing: 1, rotate: 270 });
  txt(s, label, { x: W - 0.43 - 1.6, y: H / 2 - 0.11, w: 3.2, h: 0.22, fontSize: 8, color: P.ink, align: 'center', charSpacing: 1, rotate: 90 });
  txt(s, `${pad(i + 1)} / ${pad(total)}`, { x: W - M - 1.4, y: 6.92, w: 1.4, h: 0.3, fontFace: P.numFont, fontSize: 10, color: P.accent, align: 'right', charSpacing: 1 });
}

function marblePanel(pptx, s, box, marble, hasPhoto) {
  if (!hasPhoto) {
    if (marble) {
      s.addImage({ data: marble, x: box.x, y: box.y, w: box.w, h: box.w * MARBLE_RATIO, sizing: { type: 'cover', w: box.w, h: box.h } });
    } else {
      rect(pptx, s, { ...box, fill: { color: '2B1A45' } });
      [0.15, 0.4, 0.65].forEach((f, k) =>
        s.addShape(pptx.ShapeType.ellipse, { x: box.x + box.w * f - 1.2, y: box.y + box.h * (k % 2 ? 0.15 : 0.35), w: 2.4, h: box.h * 0.6, fill: { color: 'B48CF0', transparency: 55 + k * 10 }, line: { color: 'B48CF0', transparency: 100 } })
      );
    }
  }
  s.addShape(pptx.ShapeType.rect, { ...box, fill: { color: P.bg, transparency: 100 }, line: { color: P.accent, width: 1 } });
}

function violetDark(pptx, s, slide, part, hasPhoto, marble) {
  violetHead(pptx, s, slide, 0);
  const box = VT_PANEL[slide.type];
  marblePanel(pptx, s, box, marble, hasPhoto);
  const word = { cover: 'DEMO PLAN', section: pad(part || 1), closing: 'THANK YOU' }[slide.type];
  const size = { cover: 64, section: 150, closing: 30 }[slide.type];
  txt(s, word, {
    ...box,
    fontFace: 'Arial Black',
    fontSize: size,
    color: 'FFFFFF',
    align: 'center',
    valign: 'middle',
    fit: 'none',
    outline: { color: '160D22', size: size > 100 ? 3 : 1.75 },
    shadow: { type: 'outer', color: '160D22', opacity: 1, blur: 0, offset: Math.max(2, size / 20), angle: 90 },
  });
  if (slide.type === 'cover') txt(s, slide.meta, { x: M, y: 2.6, w: CW, h: 0.35, fontSize: 12, bold: true, color: P.ink }, 'meta');
  if (slide.type !== 'closing') return;
  const tw = 7.87;
  let y = 2.6;
  if (slide.confirm) {
    rect(pptx, s, { x: M, y, w: tw, h: 1.0, fill: { color: 'C9A8F7' } }, 'confirm');
    txt(s, slide.confirm, { x: M + 0.27, y, w: tw - 0.54, h: 1.0, fontSize: 13, bold: true, color: '160D22', valign: 'middle' }, 'confirm');
    y += 1.2;
  }
  slide.steps.forEach((step, k) => {
    txt(s, `${k + 1}`, { x: M, y, w: 0.5, h: 0.5, fontFace: P.numFont, fontSize: 13, color: P.accent, valign: 'middle' });
    txt(s, step, { x: M + 0.55, y, w: tw - 0.55, h: 0.5, fontSize: 13, bold: true, color: P.ink, valign: 'middle' }, `steps.${k}`);
    s.addShape(pptx.ShapeType.line, { x: M, y: y + 0.52, w: tw, h: 0, line: { color: P.line, width: 0.75 } });
    y += 0.6;
  });
}

/* ---- 黑色俐落：全黑封面／章節／結尾＋右側大光環、膠囊標籤、頁尾頁碼＋品牌 ---- */
const NR_PHOTO = { x: W - 5.867, y: 0, w: 5.867, h: H };

function noirPill(pptx, s, text, y, key) {
  if (!text) return;
  const w = Math.min(6.6, 0.45 + [...String(text)].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 0.16 : 0.1), 0));
  s.addShape(pptx.ShapeType.roundRect, { x: M, y, w, h: 0.35, rectRadius: 0.175, fill: { color: P.navy, transparency: 100 }, line: { color: 'FFFFFF', width: 1 } });
  txt(s, text, { x: M, y, w, h: 0.35, fontSize: 10.5, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', charSpacing: 1 }, key);
}

function noirFrame(s, i, brand) {
  txt(s, pad(i + 1), { x: M, y: 6.93, w: 1, h: 0.25, fontFace: P.numFont, fontSize: 9, bold: true, color: P.mutedText });
  txt(s, String(brand || 'DEMO').toUpperCase(), { x: W - M - 4, y: 6.93, w: 4, h: 0.25, fontFace: P.numFont, fontSize: 9, bold: true, color: P.mutedText, align: 'right', charSpacing: 2 });
}

function noirDark(pptx, s, slide, part, hasPhoto, meta) {
  if (!hasPhoto) ring(pptx, s, 10.0, 4.45, 4.6, 0.6);
  noirHead(pptx, s, slide, 0, true);
  if (slide.type === 'cover') {
    noirPill(pptx, s, slide.meta, 2.6, 'meta');
    return;
  }
  if (slide.type === 'section') {
    txt(s, pad(part || 1), { x: M, y: 2.5, w: 5, h: 2.2, fontFace: P.numFont, fontSize: 134, bold: true, color: 'FFFFFF', fit: 'none' });
    return;
  }
  const tw = 6.6;
  let y = 2.6;
  if (slide.confirm) {
    round(pptx, s, { x: M, y, w: tw, h: 1.0, rectRadius: 0.1, fill: { color: 'FFFFFF' } }, 'confirm');
    txt(s, slide.confirm, { x: M + 0.27, y, w: tw - 0.54, h: 1.0, fontSize: 13, bold: true, color: P.ink, valign: 'middle' }, 'confirm');
    y += 1.2;
  }
  slide.steps.forEach((step, k) => {
    txt(s, `${k + 1}`, { x: M, y, w: 0.5, h: 0.5, fontFace: P.numFont, fontSize: 13, bold: true, color: P.mutedText, valign: 'middle' });
    txt(s, step, { x: M + 0.55, y, w: tw - 0.55, h: 0.5, fontSize: 13, bold: true, color: 'FFFFFF', valign: 'middle' }, `steps.${k}`);
    s.addShape(pptx.ShapeType.line, { x: M, y: y + 0.52, w: tw, h: 0, line: { color: '333333', width: 0.75 } });
    y += 0.6;
  });
  noirPill(pptx, s, meta, 6.27);
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
      txt(s, c.title, { x: x + 0.3, y: top + 0.7, w: w - 0.6, h: 0.6, fontSize: 19, bold: true, color: inked() ? ink : P.ink }, `cards.${k}.title`);
      txt(s, c.text, { x: x + 0.3, y: top + 1.35, w: w - 0.6, h: h - 1.5, fontSize: 13, color: subOf(ink) }, `cards.${k}.text`);
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
      txt(s, c.title, { x: x + 0.3, y: y + 0.55, w: w - 0.6, h: 0.5, fontSize: 20, bold: true, color: c.muted ? P.sub : inked() ? ink : P.ink }, `items.${k}.title`);
      txt(s, c.tags, { x: x + 0.3, y: y + 1.1, w: w - 0.6, h: 0.32, fontSize: 12, color: subOf(ink) }, `items.${k}.tags`);
      txt(s, c.flow, { x: x + 0.3, y: y + 1.45, w: w - 0.6, h: 0.35, fontSize: 12, italic: true, color: c.muted ? P.mutedText : GALLERY || VIOLET || NOIR ? ink : P.ink }, `items.${k}.flow`);
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
        if (NOIR) {
          round(pptx, s, { ...box, rectRadius: 0.1, fill: { color: last ? P.navy : P.cardFill } }, `steps.${k}`);
        } else if (VIOLET && !last) {
          rect(pptx, s, { ...box, fill: { color: P.bg }, line: { color: P.stepLine, width: 1.25 } }, `steps.${k}`);
        } else if (GALLERY && !last) {
          rect(pptx, s, { ...box, fill: { color: P.cardFill }, line: { color: P.stepLine, width: 1.25 } }, `steps.${k}`);
        } else if (NOMAD && !last) {
          const f = fillOf({ fill: { color: P.bg } }, `steps.${k}`);
          s.addShape(pptx.ShapeType.roundRect, { ...box, rectRadius: 0.08, fill: f, line: { color: P.stepLine, width: 2 } });
        } else {
          rect(pptx, s, { ...box, fill: { color: last ? P.last : P.navy } }, `steps.${k}`);
        }
        const stepInk = VIOLET ? (last ? P.bg : P.ink) : (NOMAD || GALLERY || NOIR) && !last ? P.stepLine : 'FFFFFF';
        txt(s, st, { x: x + 0.1, y: y + 0.35, w: w - 0.2, h: 0.95, fontSize: 16, bold: true, color: stepInk, align: 'center', valign: 'middle' }, `steps.${k}`);
        if (!last) txt(s, '→', { x: x + w, y: y + 0.35, w: aw, h: 0.95, fontSize: 18, color: VIOLET ? P.accent : NOIR ? P.mutedText : P.sub, align: 'center', valign: 'middle' });
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
      if (!NOMAD && !VIOLET && !NOIR) rect(pptx, s, { x: M, y, w: GALLERY ? 0.1 : 0.08, h, fill: { color: GALLERY ? P.ink : P.accent } });
      txt(s, GALLERY ? `“${q.text}”` : `「${q.text}」`, { x: M + 0.35, y, w: CW - 2.6, h, fontSize: 17, valign: 'middle', color: inked() ? ink : P.ink }, `quotes.${k}.text`);
      txt(s, q.who, { x: W - M - 2.1, y, w: 1.9, h, fontSize: 11, color: subOf(ink), align: 'right', valign: 'middle', ...(NOMAD ? { fontFace: P.dotFont } : {}) }, `quotes.${k}.who`);
    });
    if (slide.confirm) banner(pptx, s, { x: M, y: 5.75, w: CW, h: 0.95 }, 'confirm', slide.confirm);
  } else if (slide.type === 'qa') {
    const n = slide.items.length;
    const cols = n > 2 ? 2 : 1;
    const gap = 0.35;
    const w = (CW - gap * (cols - 1)) / cols;
    const rows = Math.ceil(n / cols);
    const h = ((VIOLET || NOIR ? 4.0 : 4.3) - 0.3 * (rows - 1)) / Math.max(1, rows);
    slide.items.forEach((x, k) => {
      const cx = M + (k % cols) * (w + gap);
      const cy = top + Math.floor(k / cols) * (h + 0.3);
      const ink = card(pptx, s, { x: cx, y: cy, w, h, bar: false }, `items.${k}`, k);
      s.addText(
        [
          { text: 'Q  ', options: { color: NOMAD || VIOLET || NOIR ? ink : GALLERY && ink === P.onNavyAccent ? P.navyLabel : P.accent, bold: true } },
          { text: x.q, options: styled({ color: GALLERY || VIOLET || NOIR ? ink : P.ink, bold: true }, `items.${k}.q`) },
        ],
        { x: cx + 0.3, y: cy + 0.2, w: w - 0.6, h: 0.6, fontFace: F.font, fontSize: 16, valign: 'top', margin: 0, fit: 'shrink' }
      );
      txt(s, x.a, { x: cx + 0.3, y: cy + 0.85, w: w - 0.6, h: h - 1.0, fontSize: 13, color: subOf(ink) }, `items.${k}.a`);
    });
  }
}

function addImages(s, slide, images, bg, box) {
  (slide.images || [])
    .filter((im) => im.bg === bg)
    .forEach((im) => {
      const data = images?.get?.(im.id);
      if (!data) return;
      if (bg && box) {
        s.addImage({ data, x: box.x, y: box.y, w: box.w, h: box.w * im.ratio, sizing: { type: 'cover', w: box.w, h: box.h } });
        return;
      }
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
export function buildDeckPptx(PptxGenJS, deck, { images, textures } = {}) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = deck.title;
  pptx.company = 'Call Coach';
  const nums = slideNumbers(deck.slides);
  const total = deck.slides.length;
  NOMAD = deck.theme?.style === 'nomad';
  GALLERY = deck.theme?.style === 'gallery';
  VIOLET = deck.theme?.style === 'violet';
  NOIR = deck.theme?.style === 'noir';
  P = PALETTES[deck.theme?.style] || PALETTES.classic;
  const tag = deck.customer ? `${deck.customer} · Nomad Notes` : 'Digital Nomad';
  const parts = sectionNumbers(deck.slides);
  const meta = deck.slides.find((x) => x.type === 'cover')?.meta || '';
  deck.slides.forEach((slide, i) => {
    const dark = slide.type === 'cover' || slide.type === 'section' || slide.type === 'closing';
    if (VIOLET) P = violetTone(!dark && i % 2 === 1);
    F = { text: slide.fmt?.text || {}, blocks: slide.fmt?.blocks || {}, font: deck.theme?.font || P.font };
    const hasPhoto = (slide.images || []).some((im) => im.bg && images?.get?.(im.id));
    const s = pptx.addSlide();
    s.background = { color: slide.fmt?.bg ? hex(slide.fmt.bg) : dark && !(GALLERY && slide.type === 'section') ? P.darkBg : P.bg };
    if (NOIR && dark) {
      addImages(s, slide, images, true, NR_PHOTO);
      noirDark(pptx, s, slide, parts[i], hasPhoto, meta);
    } else if (NOIR) {
      addImages(s, slide, images, true);
      lightSlide(pptx, s, slide, nums[i]);
    } else if (VIOLET && dark) {
      addImages(s, slide, images, true, VT_PANEL[slide.type]);
      violetDark(pptx, s, slide, parts[i], hasPhoto, textures?.marble);
    } else if (GALLERY && dark) {
      galleryDark(pptx, s, slide, parts[i], hasPhoto);
      addImages(s, slide, images, true, GL_PANEL);
    } else if (VIOLET) {
      addImages(s, slide, images, true);
      lightSlide(pptx, s, slide, nums[i]);
    } else {
      addImages(s, slide, images, true);
      if (NOMAD && dark) nomadDark(pptx, s, slide, tag, hasPhoto);
      else if (slide.type === 'cover' || slide.type === 'section') darkSlide(pptx, s, slide);
      else if (slide.type === 'closing') closingSlide(pptx, s, slide);
      else {
        if (NOMAD) nomadPaper(pptx, s);
        lightSlide(pptx, s, slide, nums[i]);
      }
    }
    addImages(s, slide, images, false);
    if (NOIR) noirFrame(s, i, deck.customer);
    else if (VIOLET) violetFrame(pptx, s, i, total, deck.customer);
    else if (GALLERY) galleryFrame(pptx, s, i, deck.customer, meta);
    else page(s, i, total, dark);
    const notes = [slide.notes, slide.why && `【這頁回應客戶】${slide.why}`].filter(Boolean).join('\n\n');
    if (notes) s.addNotes(notes);
  });
  F = { text: {}, blocks: {}, font: PALETTES.classic.font };
  P = PALETTES.classic;
  NOMAD = false;
  GALLERY = false;
  VIOLET = false;
  NOIR = false;
  return pptx;
}

export async function exportDeckPptx(deck, fileName, { images } = {}) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const textures = deck.theme?.style === 'violet' ? { marble: await marbleJpeg() } : {};
  const pptx = buildDeckPptx(PptxGenJS, deck, { images, textures });
  await pptx.writeFile({ fileName });
}
