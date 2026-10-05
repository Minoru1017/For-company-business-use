/**
 * DEMO 簡報 → .pptx（PptxGenJS，寬螢幕 13.33×7.5 in）。
 * 版型對齊 HTML 預覽：深藍章節頁、淺底卡片頁；編輯器的文字格式、圖塊色、背景色、圖片都會帶過去。
 * 講者備註＝notes＋這頁回應客戶的哪一點。
 */
import { slideNumbers } from './demo-deck.js';

const C = {
  navy: '18224F',
  navyText: '1B2550',
  orange: 'E39A45',
  bg: 'F3F6FA',
  white: 'FFFFFF',
  grey: '6B7385',
  line: 'DDE2EA',
  warm: 'F8E3CF',
  cool: 'E6EAF2',
  muted: 'ECEEF1',
  mutedText: '9AA0AC',
  subOnDark: 'C9D0E4',
  darkBox: '232E63',
};
const DEFAULT_FONT = 'Microsoft JhengHei';
const W = 13.333;
const H = 7.5;
const M = 0.75;
const CW = W - M * 2;
const CN_NUM = ['一', '二', '三', '四', '五', '六'];
const pad = (n) => String(n).padStart(2, '0');
const hex = (c) => String(c || '').replace('#', '').toUpperCase();

/** 目前正在輸出的投影片格式（txt／rect 依 key 套用） */
let F = { text: {}, blocks: {}, font: DEFAULT_FONT };

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
  s.addText(String(text), styled({ color: C.navyText, valign: 'top', margin: 0, fit: 'shrink', ...o }, key));
}

function fillOf(o, key) {
  const custom = key ? F.blocks[key]?.fill : '';
  return custom ? { color: hex(custom) } : o.fill;
}

function rect(pptx, s, o, key) {
  const fill = fillOf(o, key);
  s.addShape(pptx.ShapeType.rect, { line: { color: fill?.color || C.white, width: 0 }, ...o, fill });
}

function round(pptx, s, o, key) {
  const fill = fillOf(o, key);
  s.addShape(pptx.ShapeType.roundRect, { rectRadius: 0.12, line: { color: fill?.color || C.white, width: 0 }, ...o, fill });
}

function page(s, i, total, dark) {
  txt(s, `${pad(i + 1)} / ${pad(total)}`, { x: W - 1.6, y: 7.05, w: 1.2, h: 0.25, fontSize: 9, color: dark ? '5D6690' : C.mutedText, align: 'right' });
}

function head(pptx, s, slide, num) {
  if (num) {
    s.addText(
      [
        { text: `${pad(num)}   ｜   `, options: { color: C.orange } },
        { text: slide.kicker || '', options: styled({ color: C.orange }, 'kicker') },
      ],
      { x: M, y: 0.5, w: CW, h: 0.3, fontFace: F.font, fontSize: 12, bold: true, charSpacing: 2, margin: 0, valign: 'top' }
    );
  } else {
    txt(s, slide.kicker, { x: M, y: 0.5, w: CW, h: 0.3, fontSize: 12, bold: true, color: C.orange, charSpacing: 2 }, 'kicker');
  }
  txt(s, slide.title, { x: M, y: 0.85, w: CW, h: 0.85, fontSize: 30, bold: true, color: C.navyText, valign: 'middle' }, 'title');
  txt(s, slide.subtitle, { x: M, y: 1.75, w: CW, h: 0.4, fontSize: 14, italic: true, color: C.grey }, 'subtitle');
  s.addShape(pptx.ShapeType.line, { x: M, y: 2.3, w: CW, h: 0, line: { color: C.line, width: 1 } });
}

function chips(pptx, s, list, y, fill, prefix) {
  const w = Math.min(2.4, (CW - 0.2 * (list.length - 1)) / Math.max(1, list.length));
  list.forEach((c, i) => {
    const x = M + i * (w + 0.2);
    round(pptx, s, { x, y, w, h: 0.5, fill: { color: fill } }, `${prefix}.${i}`);
    txt(s, c, { x, y, w, h: 0.5, fontSize: 13, align: 'center', valign: 'middle', color: C.navyText }, `${prefix}.${i}`);
  });
}

function pair(pptx, s, y, left, right) {
  const h = 1.35;
  rect(pptx, s, { x: M, y, w: 5.4, h, fill: { color: C.white }, line: { color: C.line, width: 1 } }, left.key);
  txt(s, left.label, { x: M + 0.3, y: y + 0.2, w: 4.8, h: 0.3, fontSize: 12, color: C.grey });
  txt(s, left.text, { x: M + 0.3, y: y + 0.55, w: 4.8, h: 0.65, fontSize: 18, bold: true }, left.key);
  const rx = M + 5.8;
  rect(pptx, s, { x: rx, y, w: CW - 5.8, h, fill: { color: C.navy } }, right.key);
  txt(s, right.label, { x: rx + 0.3, y: y + 0.2, w: CW - 6.4, h: 0.3, fontSize: 12, color: C.subOnDark });
  txt(s, right.text, { x: rx + 0.3, y: y + 0.55, w: CW - 6.4, h: 0.65, fontSize: 18, bold: true, color: C.orange }, right.key);
}

function darkSlide(pptx, s, slide) {
  const isCover = slide.type === 'cover';
  txt(s, slide.kicker, { x: M, y: 2.35, w: CW, h: 0.35, fontSize: 14, bold: true, color: C.orange, align: 'center', charSpacing: 6 }, 'kicker');
  txt(s, slide.title, { x: M, y: 2.8, w: CW, h: 1.05, fontSize: isCover ? 40 : 36, bold: true, color: C.white, align: 'center', valign: 'middle' }, 'title');
  rect(pptx, s, { x: W / 2 - 1, y: 4.05, w: 2, h: 0.04, fill: { color: C.orange } });
  txt(s, slide.subtitle, { x: M, y: 4.3, w: CW, h: 0.45, fontSize: 16, italic: true, color: C.subOnDark, align: 'center' }, 'subtitle');
  if (isCover) txt(s, slide.meta, { x: M, y: 5.0, w: CW, h: 0.4, fontSize: 13, color: C.subOnDark, align: 'center' }, 'meta');
}

function closingSlide(pptx, s, slide) {
  txt(s, slide.kicker, { x: M, y: 0.9, w: CW, h: 0.35, fontSize: 14, bold: true, color: C.orange, align: 'center', charSpacing: 6 }, 'kicker');
  txt(s, slide.title, { x: M, y: 1.3, w: CW, h: 0.9, fontSize: 34, bold: true, color: C.white, align: 'center', valign: 'middle' }, 'title');
  txt(s, slide.subtitle, { x: M, y: 2.25, w: CW, h: 0.4, fontSize: 15, italic: true, color: C.subOnDark, align: 'center' }, 'subtitle');
  if (slide.confirm) {
    rect(pptx, s, { x: M + 1, y: 2.95, w: CW - 2, h: 0.95, fill: { color: C.darkBox }, line: { color: C.orange, width: 1 } }, 'confirm');
    txt(s, slide.confirm, { x: M + 1.3, y: 2.95, w: CW - 2.6, h: 0.95, fontSize: 18, bold: true, color: C.orange, align: 'center', valign: 'middle' }, 'confirm');
  }
  slide.steps.forEach((step, k) => {
    const y = 4.25 + k * 0.68;
    round(pptx, s, { x: M + 2, y, w: CW - 4, h: 0.55, fill: { color: C.darkBox } }, `steps.${k}`);
    txt(s, `${k + 1}`, { x: M + 2.15, y, w: 0.4, h: 0.55, fontSize: 16, bold: true, color: C.orange, valign: 'middle' });
    txt(s, step, { x: M + 2.65, y, w: CW - 5, h: 0.55, fontSize: 16, color: C.white, valign: 'middle' }, `steps.${k}`);
  });
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
      rect(pptx, s, { x, y: top, w, h, fill: { color: C.white }, line: { color: C.line, width: 1 } }, `cards.${k}`);
      rect(pptx, s, { x, y: top, w, h: 0.08, fill: { color: C.orange } });
      txt(s, c.label || `第${CN_NUM[k] || k + 1}`, { x: x + 0.3, y: top + 0.3, w: w - 0.6, h: 0.3, fontSize: 12, color: C.orange, bold: true }, `cards.${k}.label`);
      txt(s, c.title, { x: x + 0.3, y: top + 0.7, w: w - 0.6, h: 0.6, fontSize: 19, bold: true }, `cards.${k}.title`);
      txt(s, c.text, { x: x + 0.3, y: top + 1.35, w: w - 0.6, h: h - 1.5, fontSize: 13, color: C.grey }, `cards.${k}.text`);
    });
    if (slide.banner) {
      rect(pptx, s, { x: M, y: 5.05, w: CW, h: 0.95, fill: { color: C.navy } }, 'banner');
      txt(s, slide.banner, { x: M + 0.4, y: 5.05, w: CW - 0.8, h: 0.95, fontSize: 18, bold: true, color: C.white, align: 'center', valign: 'middle' }, 'banner');
    }
  } else if (slide.type === 'grid') {
    const gap = 0.4;
    const w = (CW - gap) / 2;
    const h = 1.95;
    slide.items.forEach((c, k) => {
      const x = M + (k % 2) * (w + gap);
      const y = top + Math.floor(k / 2) * (h + 0.3);
      rect(pptx, s, { x, y, w, h, fill: { color: c.muted ? C.muted : C.white }, line: { color: C.line, width: 1 } }, `items.${k}`);
      rect(pptx, s, { x, y, w, h: 0.08, fill: { color: c.muted ? 'C9CDD5' : C.orange } });
      txt(s, c.label || `方向${CN_NUM[k] || k + 1}`, { x: x + 0.3, y: y + 0.25, w: w - 0.6, h: 0.28, fontSize: 11, bold: true, color: c.muted ? C.mutedText : C.orange }, `items.${k}.label`);
      txt(s, c.title, { x: x + 0.3, y: y + 0.55, w: w - 0.6, h: 0.5, fontSize: 20, bold: true, color: c.muted ? C.grey : C.navyText }, `items.${k}.title`);
      txt(s, c.tags, { x: x + 0.3, y: y + 1.1, w: w - 0.6, h: 0.32, fontSize: 12, color: C.grey }, `items.${k}.tags`);
      txt(s, c.flow, { x: x + 0.3, y: y + 1.45, w: w - 0.6, h: 0.35, fontSize: 12, italic: true, color: c.muted ? C.mutedText : C.navyText }, `items.${k}.flow`);
    });
  } else if (slide.type === 'flow') {
    let y = top;
    if (slide.chips.length) {
      txt(s, slide.chipsLabel, { x: M, y, w: CW, h: 0.3, fontSize: 12, bold: true, color: C.grey });
      chips(pptx, s, slide.chips, y + 0.35, C.warm, 'chips');
      y += 1.05;
    }
    if (slide.steps.length) {
      txt(s, slide.stepsLabel, { x: M, y, w: CW, h: 0.3, fontSize: 12, bold: true, color: C.grey });
      const n = slide.steps.length;
      const aw = 0.45;
      const w = (CW - aw * (n - 1)) / n;
      slide.steps.forEach((st, k) => {
        const x = M + k * (w + aw);
        const last = k === n - 1;
        rect(pptx, s, { x, y: y + 0.35, w, h: 0.95, fill: { color: last ? C.orange : C.navy } }, `steps.${k}`);
        txt(s, st, { x: x + 0.1, y: y + 0.35, w: w - 0.2, h: 0.95, fontSize: 16, bold: true, color: C.white, align: 'center', valign: 'middle' }, `steps.${k}`);
        if (!last) txt(s, '→', { x: x + w, y: y + 0.35, w: aw, h: 0.95, fontSize: 18, color: C.grey, align: 'center', valign: 'middle' });
      });
      y += 1.5;
    }
    pair(pptx, s, Math.max(y, 5.2), { label: slide.gainLabel, text: slide.gain, key: 'gain' }, { label: slide.mapLabel, text: slide.map, key: 'map' });
  } else if (slide.type === 'plan') {
    txt(s, slide.focusLabel, { x: M, y: top, w: CW, h: 0.3, fontSize: 12, bold: true, color: C.grey });
    chips(pptx, s, slide.focus, top + 0.4, C.cool, 'focus');
    pair(pptx, s, 4.0, { label: slide.goalLabel, text: slide.goal, key: 'goal' }, { label: slide.alsoLabel, text: slide.also, key: 'also' });
  } else if (slide.type === 'quote') {
    const n = Math.max(1, slide.quotes.length);
    const h = slide.confirm ? Math.min(0.9, (2.85 - 0.18 * (n - 1)) / n) : Math.min(1.2, 3.6 / n);
    slide.quotes.forEach((q, k) => {
      const y = top + k * (h + 0.18);
      rect(pptx, s, { x: M, y, w: CW, h, fill: { color: C.white }, line: { color: C.line, width: 1 } }, `quotes.${k}`);
      rect(pptx, s, { x: M, y, w: 0.08, h, fill: { color: C.orange } });
      txt(s, `「${q.text}」`, { x: M + 0.35, y, w: CW - 2.6, h, fontSize: 17, valign: 'middle' }, `quotes.${k}.text`);
      txt(s, q.who, { x: W - M - 2.1, y, w: 1.9, h, fontSize: 11, color: C.grey, align: 'right', valign: 'middle' }, `quotes.${k}.who`);
    });
    if (slide.confirm) {
      rect(pptx, s, { x: M, y: 5.75, w: CW, h: 0.95, fill: { color: C.navy } }, 'confirm');
      txt(s, slide.confirm, { x: M + 0.4, y: 5.75, w: CW - 0.8, h: 0.95, fontSize: 18, bold: true, color: C.white, align: 'center', valign: 'middle' }, 'confirm');
    }
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
      rect(pptx, s, { x: cx, y: cy, w, h, fill: { color: C.white }, line: { color: C.line, width: 1 } }, `items.${k}`);
      s.addText(
        [
          { text: 'Q  ', options: { color: C.orange, bold: true } },
          { text: x.q, options: styled({ color: C.navyText, bold: true }, `items.${k}.q`) },
        ],
        { x: cx + 0.3, y: cy + 0.2, w: w - 0.6, h: 0.6, fontFace: F.font, fontSize: 16, valign: 'top', margin: 0, fit: 'shrink' }
      );
      txt(s, x.a, { x: cx + 0.3, y: cy + 0.85, w: w - 0.6, h: h - 1.0, fontSize: 13, color: C.grey }, `items.${k}.a`);
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
        const ih = W * im.ratio;
        s.addImage({ data, x: 0, y: 0, w: W, h: ih, sizing: { type: 'cover', w: W, h: H } });
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
  const deckFont = deck.theme?.font || DEFAULT_FONT;
  deck.slides.forEach((slide, i) => {
    F = { text: slide.fmt?.text || {}, blocks: slide.fmt?.blocks || {}, font: deckFont };
    const dark = slide.type === 'cover' || slide.type === 'section' || slide.type === 'closing';
    const s = pptx.addSlide();
    s.background = { color: slide.fmt?.bg ? hex(slide.fmt.bg) : dark ? C.navy : C.bg };
    addImages(s, slide, images, true);
    if (slide.type === 'cover' || slide.type === 'section') darkSlide(pptx, s, slide);
    else if (slide.type === 'closing') closingSlide(pptx, s, slide);
    else lightSlide(pptx, s, slide, nums[i]);
    addImages(s, slide, images, false);
    page(s, i, total, dark);
    const notes = [slide.notes, slide.why && `【這頁回應客戶】${slide.why}`].filter(Boolean).join('\n\n');
    if (notes) s.addNotes(notes);
  });
  F = { text: {}, blocks: {}, font: DEFAULT_FONT };
  return pptx;
}

export async function exportDeckPptx(deck, fileName, { images } = {}) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = buildDeckPptx(PptxGenJS, deck, { images });
  await pptx.writeFile({ fileName });
}
