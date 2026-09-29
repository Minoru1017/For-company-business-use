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
    }))
    .sort((a, b) => a.sec - b.sec || a.createdAt - b.createdAt);
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
    <p class="hint ctp-hint">播放中按 <kbd>M</kbd> 或右側標記鈕，在下方寫該句複盤筆記；<kbd>←</kbd> <kbd>→</kbd> 倒退／快轉 ${SKIP_SEC} 秒；<kbd>&lt;</kbd> <kbd>&gt;</kbd> 調整倍速。</p>
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

  function renderNotesList() {
    notesEl.innerHTML =
      markers.length === 0
        ? '<li class="hint ctp-empty">尚無標記——播放後按 M</li>'
        : markers
            .map(
              (m) => `<li class="ctp-note ${m.id === selectedId ? 'sel' : ''}" data-id="${escapeHTML(m.id)}">
        <div class="ctp-note-head"><button type="button" class="ctp-jump" data-jump="${m.sec}">${formatDuration(m.sec)}</button>
        <button type="button" class="btn slog-mini ctp-del" data-del="${escapeHTML(m.id)}">刪除</button></div>
        <textarea class="field ctp-text" rows="2" placeholder="這一句發生什麼？你的語氣／客戶可能在想…">${escapeHTML(m.text)}</textarea>
      </li>`
            )
            .join('');
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
  }

  function addMarkerAt(sec) {
    const id = `m_${Date.now()}`;
    markers = normalizeMarkers([...markers, { id, sec, text: '', createdAt: Date.now() }], duration);
    selectedId = id;
    renderMarkers();
    emit();
    const ta = notesEl.querySelector(`[data-id="${id}"] textarea`);
    ta?.focus();
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
      audio.currentTime = Number(jump.dataset.jump) || 0;
      updateProgress();
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      const id = del.dataset.del;
      markers = markers.filter((x) => x.id !== id);
      if (selectedId === id) selectedId = markers[0]?.id || null;
      renderMarkers();
      emit();
    }
  });

  notesEl.addEventListener('input', (e) => {
    const li = e.target.closest('.ctp-note');
    if (!li || !e.target.classList.contains('ctp-text')) return;
    const id = li.dataset.id;
    markers = markers.map((m) => (m.id === id ? { ...m, text: e.target.value } : m));
    selectedId = id;
    clearTimeout(notesEl._saveT);
    notesEl._saveT = setTimeout(() => emit(), 350);
  });

  notesEl.addEventListener('focusin', (e) => {
    const li = e.target.closest('.ctp-note');
    if (!li || li.dataset.id === selectedId) return;
    selectedId = li.dataset.id;
    updateSelection();
  });

  window.addEventListener('keydown', onKeyDown);
  document.addEventListener('pointerdown', onDocPointerDown);
  setRate(rate, { persist: false });
  renderMarkers();

  return {
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onDocPointerDown);
      audio.pause();
      container.innerHTML = '';
      container.classList.remove('ctp-mount');
    },
    getAudio: () => audio,
    getRate: () => rate,
    setRate,
  };
}
