/**
 * DEMO 簡報的 HTML 投影片（16:9，字級用 cqw 隨寬度縮放：縮圖、編輯、全螢幕共用同一份）。
 * editable 時文字節點帶 data-path、圖塊帶 data-block、圖片帶 data-img，供編輯器選取與套用格式。
 */
import { escapeHTML } from './utils.js';
import { fontCss, ptToCqw, slideNumbers } from './demo-deck.js';

const CN_NUM = ['一', '二', '三', '四', '五', '六'];
const pad = (n) => String(n).padStart(2, '0');

function textStyle(st) {
  if (!st) return '';
  const css = [];
  if (st.color) css.push(`color:${st.color}`);
  if (st.size) css.push(`font-size:${ptToCqw(st.size)}cqw`);
  if (st.font) css.push(`font-family:${fontCss(st.font)}`);
  return css.length ? ` style="${escapeHTML(css.join(';'))}"` : '';
}

function t(c, tag, cls, rel, value, ph = '') {
  const v = String(value ?? '');
  if (!v && !c.ed) return '';
  const attrs = c.ed
    ? ` data-path="${escapeHTML(`${c.p}.${rel}`)}" contenteditable="plaintext-only" spellcheck="false"${ph ? ` data-ph="${escapeHTML(ph)}"` : ''}`
    : '';
  return `<${tag} class="${cls}${v ? '' : ' dk-ph'}"${attrs}${textStyle(c.fmt.text[rel])}>${escapeHTML(v)}</${tag}>`;
}

/** 圖塊屬性：編輯模式可選取；有自訂填色就蓋過預設底色 */
function blk(c, rel) {
  const fill = c.fmt.blocks[rel]?.fill;
  return `${c.ed ? ` data-block="${escapeHTML(rel)}"` : ''}${fill ? ` style="background:${fill}"` : ''}`;
}

function header(c, num) {
  const { slide } = c;
  const k = num
    ? `<div class="dk-kicker"><span class="dk-num">${pad(num)}</span><span class="dk-sep">｜</span>${t(c, 'span', 'dk-k', 'kicker', slide.kicker, '主題')}</div>`
    : t(c, 'div', 'dk-kicker', 'kicker', slide.kicker, '小標');
  return `<header class="dk-head">${k}${t(c, 'h2', 'dk-title', 'title', slide.title, '標題')}${t(c, 'p', 'dk-sub', 'subtitle', slide.subtitle, '副標')}</header>`;
}

function banner(c, rel, value, ph) {
  if (!value && !c.ed) return '';
  return `<div class="dk-banner"${blk(c, rel)}>${t(c, 'span', 'dk-banner-text', rel, value, ph)}</div>`;
}

function body(c) {
  const { slide } = c;
  switch (slide.type) {
    case 'cards': {
      const cards = slide.cards
        .map(
          (x, i) =>
            `<div class="dk-card"${blk(c, `cards.${i}`)}>${t(c, 'span', 'dk-card-label', `cards.${i}.label`, x.label || `第${CN_NUM[i] || i + 1}`)}${t(c, 'b', 'dk-card-title', `cards.${i}.title`, x.title, '重點')}${t(c, 'span', 'dk-card-text', `cards.${i}.text`, x.text, '說明')}</div>`
        )
        .join('');
      return `<div class="dk-cards n${slide.cards.length}">${cards}</div>${banner(c, 'banner', slide.banner, '一句結論')}`;
    }
    case 'grid':
      return `<div class="dk-grid">${slide.items
        .map(
          (x, i) =>
            `<div class="dk-gcard${x.muted ? ' muted' : ''}"${blk(c, `items.${i}`)}>${t(c, 'span', 'dk-card-label', `items.${i}.label`, x.label || `方向${CN_NUM[i] || i + 1}`)}${t(c, 'b', 'dk-gtitle', `items.${i}.title`, x.title)}${t(c, 'span', 'dk-gtags', `items.${i}.tags`, x.tags, '例子')}${t(c, 'i', 'dk-gflow', `items.${i}.flow`, x.flow, '做什麼 → 做什麼')}</div>`
        )
        .join('')}</div>`;
    case 'flow': {
      const chips = slide.chips.map((x, i) => `<span class="dk-chip warm"${blk(c, `chips.${i}`)}>${t(c, 'span', '', `chips.${i}`, x)}</span>`).join('');
      const steps = slide.steps
        .map(
          (x, i) =>
            `${i ? '<span class="dk-arrow">→</span>' : ''}<span class="dk-step${i === slide.steps.length - 1 ? ' last' : ''}"${blk(c, `steps.${i}`)}>${t(c, 'span', '', `steps.${i}`, x)}</span>`
        )
        .join('');
      return `<div class="dk-flow">
        ${chips ? `<div class="dk-label">${escapeHTML(slide.chipsLabel)}</div><div class="dk-chips">${chips}</div>` : ''}
        ${steps ? `<div class="dk-label">${escapeHTML(slide.stepsLabel)}</div><div class="dk-steps">${steps}</div>` : ''}
        <div class="dk-pair">
          <div class="dk-box"${blk(c, 'gain')}><span class="dk-box-label">${escapeHTML(slide.gainLabel)}</span>${t(c, 'b', 'dk-box-text', 'gain', slide.gain, '能力')}</div>
          <div class="dk-box navy"${blk(c, 'map')}><span class="dk-box-label">${escapeHTML(slide.mapLabel)}</span>${t(c, 'b', 'dk-box-text', 'map', slide.map, '方向')}</div>
        </div></div>`;
    }
    case 'plan': {
      const chips = slide.focus.map((x, i) => `<span class="dk-chip"${blk(c, `focus.${i}`)}>${t(c, 'span', '', `focus.${i}`, x)}</span>`).join('');
      return `<div class="dk-plan">
        <div class="dk-label">${escapeHTML(slide.focusLabel)}</div><div class="dk-chips">${chips}</div>
        <div class="dk-pair">
          <div class="dk-box"${blk(c, 'goal')}><span class="dk-box-label">${escapeHTML(slide.goalLabel)}</span>${t(c, 'b', 'dk-box-text', 'goal', slide.goal, '目標')}</div>
          <div class="dk-box navy"${blk(c, 'also')}><span class="dk-box-label">${escapeHTML(slide.alsoLabel)}</span>${t(c, 'b', 'dk-box-text', 'also', slide.also, '同時開始')}</div>
        </div></div>`;
    }
    case 'quote':
      return `<div class="dk-quotes">${slide.quotes
        .map((q, i) => `<blockquote class="dk-quote"${blk(c, `quotes.${i}`)}>${t(c, 'span', 'dk-quote-text', `quotes.${i}.text`, q.text)}${t(c, 'cite', 'dk-quote-who', `quotes.${i}.who`, q.who)}</blockquote>`)
        .join('')}</div>${banner(c, 'confirm', slide.confirm, '所以你真正想要的是…我理解對嗎？')}`;
    case 'qa':
      return `<div class="dk-qa n${slide.items.length}">${slide.items
        .map(
          (x, i) =>
            `<div class="dk-qa-item"${blk(c, `items.${i}`)}><b class="dk-q"><span>Q</span>${t(c, 'span', '', `items.${i}.q`, x.q)}</b>${t(c, 'span', 'dk-a', `items.${i}.a`, x.a, '回答')}</div>`
        )
        .join('')}</div>`;
    default:
      return '';
  }
}

function images(c, resolveImage, bg) {
  return (c.slide.images || [])
    .map((im, i) => ({ im, i }))
    .filter(({ im }) => im.bg === bg)
    .map(({ im, i }) => {
      const src = resolveImage?.(im.id);
      const pos = bg ? '' : ` style="left:${im.x}%;top:${im.y}%;width:${im.w}%;aspect-ratio:1 / ${im.ratio}"`;
      const inner = src ? `<img src="${escapeHTML(src)}" alt="" draggable="false">` : '<span class="dk-img-missing">圖片載入中</span>';
      const handle = c.ed && !bg ? '<span class="dk-img-handle" data-img-resize></span>' : '';
      return `<div class="dk-img${bg ? ' bg' : ''}"${c.ed ? ` data-img="${i}"` : ''}${pos}>${inner}${handle}</div>`;
    })
    .join('');
}

/**
 * @param {object} slide normalizeSlide 後的投影片
 * @param {{index:number,total:number,num?:number,editable?:boolean,font?:string,style?:string,tag?:string,resolveImage?:(id:string)=>string}} opts
 */
export function renderSlideHtml(slide, { index = 0, total = 1, num = 0, editable = false, font = '', style: deckStyle = 'classic', tag = '', resolveImage } = {}) {
  const c = { p: `slides.${index}`, ed: !!editable, slide, fmt: slide.fmt || { bg: '', text: {}, blocks: {} } };
  const css = [];
  if (c.fmt.bg) css.push(`background:${c.fmt.bg}`);
  if (font) css.push(`font-family:${fontCss(font)}`);
  const style = css.length ? ` style="${escapeHTML(css.join(';'))}"` : '';
  const nomad = deckStyle === 'nomad';
  const dark = slide.type === 'cover' || slide.type === 'section' || slide.type === 'closing';
  const foot = `<span class="dk-page">${nomad ? 'N° ' : ''}${pad(index + 1)} / ${pad(total)}</span>`;
  const bgImgs = images(c, resolveImage, true);
  const fgImgs = images(c, resolveImage, false);
  const label = escapeHTML(tag || 'Digital Nomad');
  const deco = !nomad
    ? ''
    : dark
      ? `<span class="dk-pill">${label}</span>`
      : `<div class="dk-deco-stamp" aria-hidden="true"><small>ADMITTED</small><b>DEMO</b><small>${label}</small></div>`;
  const wrap = (cls, inner) =>
    `<div class="dk-slide ${cls}${nomad ? ' t-nomad' : ''}${nomad && bgImgs ? ' has-photo' : ''}"${style}>${bgImgs}${deco}${inner}${fgImgs}${foot}</div>`;
  const nav = nomad ? '<div class="dk-nav" aria-hidden="true"><span>規劃</span><span>作品</span><span>自由</span></div>' : '';
  if (slide.type === 'cover' || slide.type === 'section') {
    return wrap(
      `dark ${slide.type}`,
      `<div class="dk-center">${nav}
      ${t(c, 'div', 'dk-kicker', 'kicker', slide.kicker, slide.type === 'cover' ? 'DEMO' : '第一部分')}
      ${t(c, 'h2', 'dk-title', 'title', slide.title, '標題')}
      <span class="dk-rule"></span>
      ${t(c, 'p', 'dk-sub', 'subtitle', slide.subtitle, '副標')}
      ${slide.type === 'cover' ? t(c, 'p', 'dk-meta', 'meta', slide.meta, '日期・方案') : ''}
    </div>`
    );
  }
  if (slide.type === 'closing') {
    const steps = slide.steps.map((s, i) => `<li${blk(c, `steps.${i}`)}><span>${i + 1}</span>${t(c, 'b', '', `steps.${i}`, s)}</li>`).join('');
    const confirm = slide.confirm || c.ed ? `<div class="dk-confirm"${blk(c, 'confirm')}>${t(c, 'span', '', 'confirm', slide.confirm, '所以你真正想要的是…我理解對嗎？')}</div>` : '';
    return wrap(
      'dark closing',
      `<div class="dk-center">${nav}
      ${t(c, 'div', 'dk-kicker', 'kicker', slide.kicker, '下一步')}
      ${t(c, 'h2', 'dk-title', 'title', slide.title, '標題')}
      ${t(c, 'p', 'dk-sub', 'subtitle', slide.subtitle, '副標')}
      ${confirm}
      ${steps ? `<ol class="dk-next">${steps}</ol>` : ''}
    </div>`
    );
  }
  return wrap(`light ${slide.type}`, `<div class="dk-in">${header(c, num)}${body(c)}</div>`);
}

export function renderDeckSlides(deck, opts = {}) {
  const nums = slideNumbers(deck.slides);
  return deck.slides.map((s, i) =>
    renderSlideHtml(s, {
      font: deck.theme?.font || '',
      style: deck.theme?.style || 'classic',
      tag: deck.customer ? `${deck.customer} · Nomad Notes` : '',
      ...opts,
      index: i,
      total: deck.slides.length,
      num: nums[i],
    })
  );
}
