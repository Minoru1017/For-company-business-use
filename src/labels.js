import { escapeHTML, fmt, $ } from './utils.js';

let labelFocusIdx = -1;

export function getLabelFocusIdx() {
  return labelFocusIdx;
}

export function createLabelController({ segs, onToast }) {
  function updateSegRow(row, s) {
    row.className = `seg ${s.spk === 'S' ? 's' : 'c'}${+row.dataset.i === labelFocusIdx ? ' active' : ''}`;
  }

  function setLabelFocus(i) {
    if (i < 0 || i >= segs.length) return;
    labelFocusIdx = i;
    $('labelList').classList.add('focus-mode');
    document.querySelectorAll('#labelList .seg').forEach((row, idx) => {
      row.classList.toggle('active', idx === i);
    });
    const row = document.querySelector(`#labelList .seg[data-i="${i}"]`);
    row?.focus({ preventScroll: false });
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function collapseLabels() {
    labelFocusIdx = -1;
    $('labelList').classList.remove('focus-mode');
    document.querySelectorAll('#labelList .seg.active').forEach((row) => row.classList.remove('active'));
  }

  function bindLabelEvents() {
    document.querySelectorAll('#labelList .seg').forEach((row) => {
      row.onclick = (e) => {
        e.stopPropagation();
        setLabelFocus(+row.dataset.i);
      };
      row.onkeydown = (e) => {
        const i = +row.dataset.i;
        const s = segs[i];
        if (e.key === 'Tab') {
          e.preventDefault();
          s.spk = s.spk === 'S' ? 'C' : 'S';
          updateSegRow(row, s);
          onToast(s.spk === 'S' ? '已標記：業務' : '已標記：客戶');
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (i < segs.length - 1) setLabelFocus(i + 1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (i > 0) setLabelFocus(i - 1);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          collapseLabels();
          row.blur();
        }
      };
    });
  }

  function renderLabels() {
    const prev = labelFocusIdx;
    $('labelList').innerHTML = segs
      .map(
        (s, i) =>
          `<div class="seg ${s.spk === 'S' ? 's' : 'c'}" data-i="${i}" tabindex="0" role="listitem"
      aria-label="第 ${i + 1} 句，${s.spk === 'S' ? '業務' : '客戶'}">
      <div class="who" aria-hidden="true">
        <span class="b-s spk-badge">業務</span>
        <span class="b-c spk-badge">客戶</span>
      </div>
      <div class="ts">${fmt(s.start)}</div>
      <div class="txt">${escapeHTML(s.text)}</div></div>`
      )
      .join('');
    bindLabelEvents();
    if (prev >= 0 && prev < segs.length) setLabelFocus(prev);
    else collapseLabels();
  }

  function resetFocus() {
    labelFocusIdx = -1;
  }

  return { renderLabels, collapseLabels, resetFocus };
}

export function bindLabelCollapseHandlers(collapseLabels) {
  $('labelList').onclick = (e) => {
    if (e.target === $('labelList')) collapseLabels();
  };
  document.addEventListener('click', (e) => {
    if ($('labelCard').hidden) return;
    const t = e.target;
    if (t.closest('#labelList .seg') || t.closest('#autoGuess') || t.closest('#flipAll') || t.closest('#analyze')) return;
    if (t.closest('#labelCard')) collapseLabels();
  });
}
