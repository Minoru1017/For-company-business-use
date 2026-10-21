/**
 * 單通錄音：自訂時間軸 + M 鍵標記關鍵話點 + 下方筆記（開發分析前複盤）
 */
import { formatDuration } from './symptom-engine.js';
import { escapeHTML } from './utils.js';

export function normalizeMarkers(markers, durationSec = Infinity) {
  const max = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : Infinity;
  return (markers || [])
    .map((m) => ({
      id: m.id || `m_${Math.random().toString(36).slice(2, 9)}`,
      sec: Math.max(0, Math.min(max, Number(m.sec) || 0)),
      text: String(m.text || ''),
      createdAt: m.createdAt || Date.now(),
      // 心智圖的分析欄位（表層／真意／證據）由 marker-mindmap 編輯，播放器只負責帶著走
      surface: String(m.surface || ''),
      intent: String(m.intent || ''),
      evidence: Array.isArray(m.evidence) ? m.evidence : [],
    }))
    .sort((a, b) => a.sec - b.sec || a.createdAt - b.createdAt);
}

/** 話點超過這個數量時，清單限高、跟著播放位置捲動 */
export const NOTES_CAP = 6;

/** 目前播放位置落在哪個話點：最後一個「已經播過」的話點；還沒到第一個就回 -1 */
export function activeMarkerIndex(markers, sec) {
  const t = (Number(sec) || 0) + 0.25;
  let idx = -1;
  (markers || []).forEach((m, i) => {
    if (m.sec <= t) idx = i;
  });
  return idx;
}

const ICON_PLAY =
  '<svg class="ctp-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.14v14.72a1 1 0 0 0 1.5.86l11.04-7.36a1 1 0 0 0 0-1.72L9.5 4.28a1 1 0 0 0-1.5.86z"/></svg>';
const ICON_PAUSE =
  '<svg class="ctp-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 5h4v14H6V5zm8 0h4v14h-4V5z"/></svg>';
const ICON_BACK10 =
  '<svg class="ctp-icon ctp-icon-skip" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 5a8 8 0 1 1-7.4 4.9"/><path fill="currentColor" d="M4 3v6h6L4 3z"/><text x="12" y="16.2" text-anchor="middle" font-size="7.5" font-weight="700" font-family="JetBrains Mono, monospace" fill="currentColor">10</text></svg>';
const ICON_FWD10 =
  '<svg class="ctp-icon ctp-icon-skip" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 5a8 8 0 1 0 7.4 4.9"/><path fill="currentColor" d="M20 3v6h-6l6-6z"/><text x="12" y="16.2" text-anchor="middle" font-size="7.5" font-weight="700" font-family="JetBrains Mono, monospace" fill="currentColor">10</text></svg>';
const SKIP_SEC = 10;
/** 播放倍率（Spotify Podcast 風格：點倍率鈕展開選單；< > 鍵逐格切換） */
export const PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2];
const RATE_KEY = 'callCoachPlaybackRate';

export function formatRate(rate) {
  const r = Number(rate) || 1;
  return `${Number.isInteger(r) ? r : String(r).replace(/0+$/, '')}×`;
}

export function normalizeRate(rate) {
  const r = Number(rate);
  return PLAYBACK_RATES.includes(r) ? r : 1;
}

/** 依 step（±1）在倍率清單上移動並夾在兩端 */
export function stepRate(current, step) {
  const idx = PLAYBACK_RATES.indexOf(normalizeRate(current));
  const next = Math.max(0, Math.min(PLAYBACK_RATES.length - 1, idx + step));
  return PLAYBACK_RATES[next];
}

function loadRate() {
  try {
    return normalizeRate(localStorage.getItem(RATE_KEY));
  } catch {
    return 1;
  }
}

function saveRate(rate) {
  try {
    localStorage.setItem(RATE_KEY, String(rate));
  } catch {
    /* ignore */
  }
}
const ICON_MARK =
  '<svg class="ctp-icon ctp-icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>';

/**
 * @param {HTMLElement} container
 * @param {{ src: string, title?: string, subtitle?: string, markers?: Array, onChange?: (markers)=>void }} opts
 */
export function mountTimelinePlayer(container, opts) {
  const { src, onChange, title = '錄音', subtitle = '開發複盤 · M 標記話點' } = opts;
  let markers = normalizeMarkers(opts.markers);
  let selectedId = markers.length ? markers[markers.length - 1].id : null;
  let editingId = null;
  let nowId = null;
  let notesExpanded = false;
  let duration = 0;
  let rate = loadRate();

  container.innerHTML = '';
  container.classList.add('ctp-mount');
  container.tabIndex = 0;

  const root = document.createElement('div');
  root.className = 'ctp';
  root.innerHTML = `
    <audio class="ctp-audio" preload="metadata" src="${escapeHTML(src)}"></audio>
    <div class="ctp-bar">
      <div class="ctp-now">
        <span class="ctp-cover" aria-hidden="true"></span>
        <div class="ctp-now-text">
          <span class="ctp-now-title">${escapeHTML(title)}</span>
          <span class="ctp-now-sub">${escapeHTML(subtitle)}</span>
        </div>
      </div>
      <div class="ctp-main">
        <div class="ctp-transport">
          <button type="button" class="ctp-skip ctp-back" aria-label="倒退 ${SKIP_SEC} 秒" title="倒退 ${SKIP_SEC} 秒（←）">${ICON_BACK10}</button>
          <button type="button" class="ctp-play" aria-label="播放或暫停">${ICON_PLAY}</button>
          <button type="button" class="ctp-skip ctp-fwd" aria-label="快轉 ${SKIP_SEC} 秒" title="快轉 ${SKIP_SEC} 秒（→）">${ICON_FWD10}</button>
        </div>
        <div class="ctp-timeline">
          <span class="ctp-cur">0:00</span>
          <div class="ctp-track" role="slider" aria-label="播放位置">
            <div class="ctp-fill"></div>
            <div class="ctp-markers"></div>
            <div class="ctp-head"></div>
          </div>
          <span class="ctp-dur">0:00</span>
        </div>
      </div>
      <div class="ctp-tools">
        <div class="ctp-rate">
          <button type="button" class="ctp-rate-btn" aria-haspopup="listbox" aria-expanded="false" title="播放速度（＜ ＞ 切換）">${formatRate(rate)}</button>
          <div class="ctp-rate-menu" role="listbox" aria-label="播放速度" hidden>
            ${PLAYBACK_RATES.map((r) => `<button type="button" role="option" class="ctp-rate-opt" data-rate="${r}" aria-selected="${r === rate}">${formatRate(r)}</button>`).join('')}
          </div>
        </div>
        <button type="button" class="ctp-m-btn" title="在目前位置標記（快捷鍵 M）">${ICON_MARK}<span class="ctp-m-label">M</span></button>
      </div>
    </div>
    <p class="hint ctp-hint"><kbd>M</kbd> 標記話點 · <kbd>←</kbd> <kbd>→</kbd> ${SKIP_SEC} 秒 · <kbd>&lt;</kbd> <kbd>&gt;</kbd> 倍速 · 點話點文字編輯，<kbd>Enter</kbd> 完成</p>
    <div class="ctp-notes-head"><span class="ctp-notes-count"></span><button type="button" class="ctp-notes-toggle" hidden></button></div>
    <ul class="ctp-notes"></ul>
  `;
  container.appendChild(root);

  const audio = root.querySelector('.ctp-audio');
  const playBtn = root.querySelector('.ctp-play');
  const track = root.querySelector('.ctp-track');
  const fill = root.querySelector('.ctp-fill');
  const head = root.querySelector('.ctp-head');
  const markersEl = root.querySelector('.ctp-markers');
  const notesEl = root.querySelector('.ctp-notes');
  const notesCountEl = root.querySelector('.ctp-notes-count');
  const notesToggle = root.querySelector('.ctp-notes-toggle');
  const curEl = root.querySelector('.ctp-cur');
  const durEl = root.querySelector('.ctp-dur');
  const mBtn = root.querySelector('.ctp-m-btn');
  const backBtn = root.querySelector('.ctp-back');
  const fwdBtn = root.querySelector('.ctp-fwd');
  const rateBtn = root.querySelector('.ctp-rate-btn');
  const rateMenu = root.querySelector('.ctp-rate-menu');

  function renderRate() {
    rateBtn.textContent = formatRate(rate);
    rateBtn.classList.toggle('active', rate !== 1);
    rateMenu.querySelectorAll('.ctp-rate-opt').forEach((b) => {
      b.setAttribute('aria-selected', String(Number(b.dataset.rate) === rate));
    });
  }

  function setRate(next, { persist = true } = {}) {
    rate = normalizeRate(next);
    // 載入新資源時瀏覽器會把 playbackRate 重設為 defaultPlaybackRate，兩者一起設才不會被打回 1×
    audio.defaultPlaybackRate = rate;
    if (audio.playbackRate !== rate) audio.playbackRate = rate;
    renderRate();
    if (persist) saveRate(rate);
  }

  function toggleRateMenu(open = rateMenu.hidden) {
    rateMenu.hidden = !open;
    rateBtn.setAttribute('aria-expanded', String(open));
  }

  function skip(delta) {
    const max = duration || audio.duration || Infinity;
    const next = Math.max(0, Math.min(max, (audio.currentTime || 0) + delta));
    audio.currentTime = next;
    updateProgress();
    const btn = delta < 0 ? backBtn : fwdBtn;
    btn.classList.remove('bump');
    void btn.offsetWidth;
    btn.classList.add('bump');
  }

  function emit() {
    onChange?.(normalizeMarkers(markers, duration));
  }

  function updateSelection() {
    markersEl.querySelectorAll('.ctp-dot').forEach((dot) => {
      dot.classList.toggle('sel', dot.dataset.id === selectedId);
    });
    notesEl.querySelectorAll('.ctp-note').forEach((li) => {
      li.classList.toggle('sel', li.dataset.id === selectedId);
    });
  }

  function renderTrackDots() {
    markersEl.innerHTML = '';
    if (!duration) return;
    markers.forEach((m) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = `ctp-dot ${m.id === selectedId ? 'sel' : ''}`;
      dot.style.left = `${(m.sec / duration) * 100}%`;
      dot.title = `${formatDuration(m.sec)}${m.text ? ` · ${m.text.slice(0, 40)}` : ''}`;
      dot.dataset.id = m.id;
      markersEl.appendChild(dot);
    });
  }

  function noteHtml(m) {
    const cls = `ctp-note${m.id === selectedId ? ' sel' : ''}${m.id === nowId ? ' now' : ''}`;
    const jump = `<button type="button" class="ctp-jump" data-jump="${m.sec}" title="跳到這裡">${formatDuration(m.sec)}</button>`;
    if (m.id === editingId) {
      return `<li class="${cls} editing" data-id="${escapeHTML(m.id)}">${jump}
        <textarea class="field ctp-text" rows="2" aria-label="${formatDuration(m.sec)} 話點筆記" placeholder="這一句發生什麼？你的語氣／客戶可能在想…">${escapeHTML(m.text)}</textarea>
        <button type="button" class="btn slog-mini ctp-done" data-done>完成</button></li>`;
    }
    const text = m.text.trim();
    return `<li class="${cls}" data-id="${escapeHTML(m.id)}">${jump}
      <button type="button" class="ctp-note-text${text ? '' : ' empty'}" data-edit="${escapeHTML(m.id)}" title="點一下編輯">${text ? escapeHTML(text) : '還沒寫——點一下補上'}</button>
      <button type="button" class="ctp-del" data-del="${escapeHTML(m.id)}" aria-label="刪除 ${formatDuration(m.sec)} 的話點" title="刪除">×</button></li>`;
  }

  function renderNotesHead() {
    const n = markers.length;
    notesCountEl.textContent = n ? `話點 ${n}` : '';
    notesToggle.hidden = n <= NOTES_CAP;
    notesToggle.textContent = notesExpanded ? '收合' : `展開全部 ${n} 筆`;
    notesEl.classList.toggle('capped', n > NOTES_CAP && !notesExpanded);
  }

  function renderNotesList() {
    renderNotesHead();
    notesEl.innerHTML =
      markers.length === 0 ? '<li class="hint ctp-empty">尚無標記——播放後按 M</li>' : markers.map(noteHtml).join('');
  }

  /** 只換掉一列，其他列的 DOM 不動，點別列時 click 不會因為重畫而遺失 */
  function replaceNote(id) {
    const li = notesEl.querySelector(`.ctp-note[data-id="${CSS.escape(id)}"]`);
    const m = markers.find((x) => x.id === id);
    if (li && m) li.outerHTML = noteHtml(m);
  }

  /** 限高時只捲清單本身，不動整頁 */
  function revealNote(id, { center = false } = {}) {
    if (!notesEl.classList.contains('capped')) return;
    const li = notesEl.querySelector(`.ctp-note[data-id="${CSS.escape(id)}"]`);
    if (!li) return;
    const top = li.offsetTop;
    const bottom = top + li.offsetHeight;
    if (center || top < notesEl.scrollTop || bottom > notesEl.scrollTop + notesEl.clientHeight) {
      notesEl.scrollTop = Math.max(0, top - notesEl.clientHeight / 3);
    }
  }

  function flushSave() {
    if (!notesEl._saveT) return;
    clearTimeout(notesEl._saveT);
    notesEl._saveT = null;
    emit();
  }

  function openEditor(id) {
    const prev = editingId;
    editingId = id;
    selectedId = id;
    if (prev && prev !== id) replaceNote(prev);
    replaceNote(id);
    updateSelection();
    revealNote(id);
    const ta = notesEl.querySelector(`.ctp-note[data-id="${CSS.escape(id)}"] textarea`);
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }

  function closeEditor({ focusRow = false } = {}) {
    if (!editingId) return;
    const id = editingId;
    flushSave();
    editingId = null;
    replaceNote(id);
    if (focusRow) notesEl.querySelector(`.ctp-note[data-id="${CSS.escape(id)}"] .ctp-note-text`)?.focus();
  }

  function updateNow() {
    const idx = activeMarkerIndex(markers, audio.currentTime || 0);
    const id = idx >= 0 ? markers[idx].id : null;
    if (id === nowId) return;
    nowId = id;
    notesEl.querySelectorAll('.ctp-note').forEach((li) => li.classList.toggle('now', li.dataset.id === id));
    markersEl.querySelectorAll('.ctp-dot').forEach((dot) => dot.classList.toggle('now', dot.dataset.id === id));
    if (id && !editingId && !audio.paused) revealNote(id);
  }

  function renderMarkers() {
    renderTrackDots();
    renderNotesList();
  }

  function updateProgress() {
    const t = audio.currentTime || 0;
    curEl.textContent = formatDuration(t);
    if (duration) {
      const pct = (t / duration) * 100;
      fill.style.width = `${pct}%`;
      head.style.left = `${pct}%`;
    }
    updateNow();
  }

  function addMarkerAt(sec) {
    const id = `m_${Date.now()}`;
    markers = normalizeMarkers([...markers, { id, sec, text: '', createdAt: Date.now() }], duration);
    selectedId = id;
    flushSave();
    editingId = null;
    renderMarkers();
    emit();
    openEditor(id);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && !rateMenu.hidden) {
      toggleRateMenu(false);
      return;
    }
    const isMark = e.key === 'm' || e.key === 'M';
    const isBack = e.key === 'ArrowLeft';
    const isFwd = e.key === 'ArrowRight';
    const isSlower = e.key === '<' || e.key === ',';
    const isFaster = e.key === '>' || e.key === '.';
    if (!isMark && !isBack && !isFwd && !isSlower && !isFaster) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
    if (!container.isConnected) return;
    const focusedHere = container === document.activeElement || container.contains(document.activeElement);
    if (audio.paused && !focusedHere) return;
    e.preventDefault();
    if (isMark) addMarkerAt(audio.currentTime || 0);
    else if (isSlower || isFaster) setRate(stepRate(rate, isFaster ? 1 : -1));
    else skip(isBack ? -SKIP_SEC : SKIP_SEC);
  }

  function onDocPointerDown(e) {
    if (rateMenu.hidden) return;
    if (!root.querySelector('.ctp-rate').contains(e.target)) toggleRateMenu(false);
  }

  function setTransportPlaying(playing) {
    playBtn.classList.toggle('playing', playing);
    playBtn.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
  }

  playBtn.addEventListener('click', () => {
    if (audio.paused) audio.play();
    else audio.pause();
  });
  backBtn.addEventListener('click', () => skip(-SKIP_SEC));
  fwdBtn.addEventListener('click', () => skip(SKIP_SEC));
  rateBtn.addEventListener('click', () => toggleRateMenu());
  rateMenu.addEventListener('click', (e) => {
    const opt = e.target.closest('.ctp-rate-opt');
    if (!opt) return;
    setRate(Number(opt.dataset.rate));
    toggleRateMenu(false);
    rateBtn.focus();
  });
  // 瀏覽器自身的媒體控制改了倍率時同步顯示（只認清單內的值）
  audio.addEventListener('ratechange', () => {
    if (PLAYBACK_RATES.includes(audio.playbackRate) && audio.playbackRate !== rate) setRate(audio.playbackRate);
  });

  audio.addEventListener('play', () => setTransportPlaying(true));
  audio.addEventListener('pause', () => setTransportPlaying(false));
  audio.addEventListener('timeupdate', updateProgress);
  audio.addEventListener('loadedmetadata', () => {
    duration = audio.duration || 0;
    if (audio.playbackRate !== rate) audio.playbackRate = rate;
    durEl.textContent = formatDuration(duration);
    markers = normalizeMarkers(markers, duration);
    renderMarkers();
  });

  track.addEventListener('click', (e) => {
    if (!duration) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
    updateProgress();
  });

  mBtn.addEventListener('click', () => addMarkerAt(audio.currentTime || 0));

  markersEl.addEventListener('click', (e) => {
    const dot = e.target.closest('.ctp-dot');
    if (!dot) return;
    selectedId = dot.dataset.id;
    const m = markers.find((x) => x.id === selectedId);
    if (m) audio.currentTime = m.sec;
    updateSelection();
  });

  notesEl.addEventListener('click', (e) => {
    const jump = e.target.closest('[data-jump]');
    if (jump) {
      if (editingId && !jump.closest('.ctp-note.editing')) closeEditor();
      audio.currentTime = Number(jump.dataset.jump) || 0;
      updateProgress();
      return;
    }
    const edit = e.target.closest('[data-edit]');
    if (edit) {
      openEditor(edit.dataset.edit);
      return;
    }
    if (e.target.closest('[data-done]')) {
      closeEditor({ focusRow: true });
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      const id = del.dataset.del;
      flushSave();
      markers = markers.filter((x) => x.id !== id);
      editingId = null;
      if (selectedId === id) selectedId = markers[0]?.id || null;
      renderMarkers();
      emit();
    }
  });

  notesToggle.addEventListener('click', () => {
    notesExpanded = !notesExpanded;
    renderNotesHead();
    if (!notesExpanded && (editingId || nowId)) revealNote(editingId || nowId, { center: true });
  });

  notesEl.addEventListener('input', (e) => {
    const li = e.target.closest('.ctp-note');
    if (!li || !e.target.classList.contains('ctp-text')) return;
    const id = li.dataset.id;
    markers = markers.map((m) => (m.id === id ? { ...m, text: e.target.value } : m));
    selectedId = id;
    clearTimeout(notesEl._saveT);
    notesEl._saveT = setTimeout(() => {
      notesEl._saveT = null;
      emit();
    }, 350);
  });

  notesEl.addEventListener('keydown', (e) => {
    if (!e.target.classList?.contains('ctp-text')) return;
    if ((e.key === 'Enter' && !e.shiftKey && !e.isComposing) || e.key === 'Escape') {
      e.preventDefault();
      closeEditor({ focusRow: true });
    }
  });

  notesEl.addEventListener('focusout', (e) => {
    const li = e.target.closest?.('.ctp-note.editing');
    if (!li || li.contains(e.relatedTarget)) return;
    // Collapsing on mousedown shifts the rows, so the click would land on a different row.
    if (notesEl.contains(e.relatedTarget)) return;
    if (li.dataset.id === editingId) closeEditor();
  });

  window.addEventListener('keydown', onKeyDown);
  document.addEventListener('pointerdown', onDocPointerDown);
  setRate(rate, { persist: false });
  renderMarkers();

  return {
    destroy() {
      flushSave();
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onDocPointerDown);
      audio.pause();
      container.innerHTML = '';
      container.classList.remove('ctp-mount');
    },
    getAudio: () => audio,
    getRate: () => rate,
    setRate,
    /** 心智圖面板改了標記內容時同步回播放器，避免下一次 emit 用舊資料蓋掉 */
    setMarkers(next) {
      markers = normalizeMarkers(next, duration);
      if (selectedId && !markers.some((m) => m.id === selectedId)) selectedId = markers[0]?.id || null;
      if (editingId && !markers.some((m) => m.id === editingId)) editingId = null;
      renderMarkers();
    },
  };
}
