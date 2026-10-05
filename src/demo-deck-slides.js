/**
 * DEMO 簡報的 HTML 投影片（16:9，字級用 cqw 隨寬度縮放：縮圖、編輯、全螢幕共用同一份）。
 * editable 時文字節點帶 data-path，可直接在投影片上改字。
 */
import { escapeHTML } from './utils.js';
import { slideNumbers } from './demo-deck.js';

const CN_NUM = ['一', '二', '三', '四', '五', '六'];
const pad = (n) => String(n).padStart(2, '0');

function t(tag, cls, path, value, editable, ph = '') {
  const v = String(value ?? '');
  if (!v && !editable) return '';
  const attrs = editable
    ? ` data-path="${escapeHTML(path)}" contenteditable="plaintext-only" spellcheck="false"${ph ? ` data-ph="${escapeHTML(ph)}"` : ''}`
    : '';
  return `<${tag} class="${cls}${v ? '' : ' dk-ph'}"${attrs}>${escapeHTML(v)}</${tag}>`;
}

function header(slide, p, num, ed) {
  const kicker = slide.kicker;
  const k = num
    ? `<div class="dk-kicker"><span class="dk-num">${pad(num)}</span><span class="dk-sep">｜</span>${t('span', 'dk-k', `${p}.kicker`, kicker, ed, '主題')}</div>`
    : t('div', 'dk-kicker', `${p}.kicker`, kicker, ed, '小標');
  return `<header class="dk-head">${k}${t('h2', 'dk-title', `${p}.title`, slide.title, ed, '標題')}${t('p', 'dk-sub', `${p}.subtitle`, slide.subtitle, ed, '副標')}</header>`;
}

function body(slide, p, ed) {
  switch (slide.type) {
    case 'cards': {
      const cards = slide.cards
        .map(
          (c, i) => `<div class="dk-card">${t('span', 'dk-card-label', `${p}.cards.${i}.label`, c.label || `第${CN_NUM[i] || i + 1}`, ed)}${t('b', 'dk-card-title', `${p}.cards.${i}.title`, c.title, ed, '重點')}${t('span', 'dk-card-text', `${p}.cards.${i}.text`, c.text, ed, '說明')}</div>`
        )
        .join('');
      return `<div class="dk-cards n${slide.cards.length}">${cards}</div>${t('div', 'dk-banner', `${p}.banner`, slide.banner, ed, '一句結論')}`;
    }
    case 'grid':
      return `<div class="dk-grid">${slide.items
        .map(
          (c, i) => `<div class="dk-gcard${c.muted ? ' muted' : ''}">${t('span', 'dk-card-label', `${p}.items.${i}.label`, c.label || `方向${CN_NUM[i] || i + 1}`, ed)}${t('b', 'dk-gtitle', `${p}.items.${i}.title`, c.title, ed)}${t('span', 'dk-gtags', `${p}.items.${i}.tags`, c.tags, ed, '例子')}${t('i', 'dk-gflow', `${p}.items.${i}.flow`, c.flow, ed, '做什麼 → 做什麼')}</div>`
        )
        .join('')}</div>`;
    case 'flow': {
      const chips = slide.chips.map((c, i) => t('span', 'dk-chip warm', `${p}.chips.${i}`, c, ed)).join('');
      const steps = slide.steps
        .map((s, i) => `${i ? '<span class="dk-arrow">→</span>' : ''}${t('span', `dk-step${i === slide.steps.length - 1 ? ' last' : ''}`, `${p}.steps.${i}`, s, ed)}`)
        .join('');
      return `<div class="dk-flow">
        ${chips ? `<div class="dk-label">${escapeHTML(slide.chipsLabel)}</div><div class="dk-chips">${chips}</div>` : ''}
        ${steps ? `<div class="dk-label">${escapeHTML(slide.stepsLabel)}</div><div class="dk-steps">${steps}</div>` : ''}
        <div class="dk-pair">
          <div class="dk-box"><span class="dk-box-label">${escapeHTML(slide.gainLabel)}</span>${t('b', 'dk-box-text', `${p}.gain`, slide.gain, ed, '能力')}</div>
          <div class="dk-box navy"><span class="dk-box-label">${escapeHTML(slide.mapLabel)}</span>${t('b', 'dk-box-text', `${p}.map`, slide.map, ed, '方向')}</div>
        </div></div>`;
    }
    case 'plan': {
      const chips = slide.focus.map((c, i) => t('span', 'dk-chip', `${p}.focus.${i}`, c, ed)).join('');
      return `<div class="dk-plan">
        <div class="dk-label">${escapeHTML(slide.focusLabel)}</div><div class="dk-chips">${chips}</div>
        <div class="dk-pair">
          <div class="dk-box"><span class="dk-box-label">${escapeHTML(slide.goalLabel)}</span>${t('b', 'dk-box-text', `${p}.goal`, slide.goal, ed, '目標')}</div>
          <div class="dk-box navy"><span class="dk-box-label">${escapeHTML(slide.alsoLabel)}</span>${t('b', 'dk-box-text', `${p}.also`, slide.also, ed, '同時開始')}</div>
        </div></div>`;
    }
    case 'quote':
      return `<div class="dk-quotes">${slide.quotes
        .map((q, i) => `<blockquote class="dk-quote">${t('span', 'dk-quote-text', `${p}.quotes.${i}.text`, q.text, ed)}${t('cite', 'dk-quote-who', `${p}.quotes.${i}.who`, q.who, ed)}</blockquote>`)
        .join('')}</div>${t('div', 'dk-banner', `${p}.confirm`, slide.confirm, ed, '所以你真正想要的是…我理解對嗎？')}`;
    case 'qa':
      return `<div class="dk-qa n${slide.items.length}">${slide.items
        .map((x, i) => `<div class="dk-qa-item"><b class="dk-q"><span>Q</span>${t('span', '', `${p}.items.${i}.q`, x.q, ed)}</b>${t('span', 'dk-a', `${p}.items.${i}.a`, x.a, ed, '回答')}</div>`)
        .join('')}</div>`;
    default:
      return '';
  }
}

/**
 * @param {object} slide normalizeSlide 後的投影片
 * @param {{index:number,total:number,num?:number,editable?:boolean}} opts
 */
export function renderSlideHtml(slide, { index = 0, total = 1, num = 0, editable = false } = {}) {
  const p = `slides.${index}`;
  const ed = !!editable;
  const foot = `<span class="dk-page">${pad(index + 1)} / ${pad(total)}</span>`;
  if (slide.type === 'cover' || slide.type === 'section') {
    return `<div class="dk-slide dark ${slide.type}"><div class="dk-center">
      ${t('div', 'dk-kicker', `${p}.kicker`, slide.kicker, ed, slide.type === 'cover' ? 'DEMO' : '第一部分')}
      ${t('h2', 'dk-title', `${p}.title`, slide.title, ed, '標題')}
      <span class="dk-rule"></span>
      ${t('p', 'dk-sub', `${p}.subtitle`, slide.subtitle, ed, '副標')}
      ${slide.type === 'cover' ? t('p', 'dk-meta', `${p}.meta`, slide.meta, ed, '日期・方案') : ''}
    </div>${foot}</div>`;
  }
  if (slide.type === 'closing') {
    const steps = slide.steps.map((s, i) => `<li><span>${i + 1}</span>${t('b', '', `${p}.steps.${i}`, s, ed)}</li>`).join('');
    return `<div class="dk-slide dark closing"><div class="dk-center">
      ${t('div', 'dk-kicker', `${p}.kicker`, slide.kicker, ed, '下一步')}
      ${t('h2', 'dk-title', `${p}.title`, slide.title, ed, '標題')}
      ${t('p', 'dk-sub', `${p}.subtitle`, slide.subtitle, ed, '副標')}
      ${t('p', 'dk-confirm', `${p}.confirm`, slide.confirm, ed, '所以你真正想要的是…我理解對嗎？')}
      ${steps ? `<ol class="dk-next">${steps}</ol>` : ''}
    </div>${foot}</div>`;
  }
  return `<div class="dk-slide light ${slide.type}">${header(slide, p, num, ed)}${body(slide, p, ed)}${foot}</div>`;
}

export function renderDeckSlides(deck, opts = {}) {
  const nums = slideNumbers(deck.slides);
  return deck.slides.map((s, i) => renderSlideHtml(s, { ...opts, index: i, total: deck.slides.length, num: nums[i] }));
}
