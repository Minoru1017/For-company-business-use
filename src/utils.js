export const $ = (id) => document.getElementById(id);

export function escapeHTML(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape text but allow a small set of trusted inline tags from rule templates. */
export function safeHTML(html) {
  const placeholders = [];
  const withPlaceholders = html.replace(
    /<(span class="q"|span class="ev"|b|\/span|\/b)>/g,
    (m) => {
      const i = placeholders.length;
      placeholders.push(m);
      return `\x00${i}\x00`;
    }
  );
  let out = escapeHTML(withPlaceholders);
  placeholders.forEach((tag, i) => {
    out = out.replace(`\x00${i}\x00`, tag);
  });
  return out;
}

export function tsToSec(h, m, s, ms) {
  return (+h) * 3600 + (+m) * 60 + (+s) + (+(ms || 0)) / 1000;
}

export function fmt(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function countChars(t) {
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  const w = (t.replace(/[\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
  return cjk + w;
}

export function stripHTML(h) {
  return h.replace(/<[^>]+>/g, '');
}

export function setText(el, text) {
  if (typeof el === 'string') el = $(el);
  if (el) el.textContent = text;
}

export function setHTML(el, html) {
  if (typeof el === 'string') el = $(el);
  if (el) el.innerHTML = safeHTML(html);
}
