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

/**
 * @param {HTMLElement} container
 * @param {{ src: string, markers?: Array, onChange?: (markers)=>void }} opts
 */
export function mountTimelinePlayer(container, opts) {
  const { src, onChange } = opts;
  let markers = normalizeMarkers(opts.markers);
  let selectedId = markers.length ? markers[markers.length - 1].id : null;
  let duration = 0;

  container.innerHTML = '';
  container.classList.add('ctp-mount');
  container.tabIndex = 0;

  const root = document.createElement('div');
  root.className = 'ctp';
  root.innerHTML = `
    <audio class="ctp-audio" preload="metadata" src="${escapeHTML(src)}"></audio>
    <div class="ctp-shell">
      <button type="button" class="ctp-play" aria-label="播放或暫停">▶</button>
      <span class="ctp-time"><span class="ctp-cur">0:00</span> / <span class="ctp-dur">0:00</span></span>
      <div class="ctp-track" role="slider" aria-label="播放位置">
        <div class="ctp-fill"></div>
        <div class="ctp-markers"></div>
        <div class="ctp-head"></div>
      </div>
      <button type="button" class="ctp-m-btn" title="在目前位置標記（快捷鍵 M）">M 標記</button>
    </div>
    <p class="hint ctp-hint">聚焦此列後，播放中按鍵盤 <kbd>M</kbd> 可標記關鍵話點；在下方寫這一句的複盤筆記。</p>
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

  function emit() {
    onChange?.(normalizeMarkers(markers, duration));
  }

  function renderMarkers() {
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
    if (e.key !== 'm' && e.key !== 'M') return;
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
    if (!container.isConnected) return;
    const focusedHere = container === document.activeElement || container.contains(document.activeElement);
    if (audio.paused && !focusedHere) return;
    e.preventDefault();
    addMarkerAt(audio.currentTime || 0);
  }

  playBtn.addEventListener('click', () => {
    if (audio.paused) audio.play();
    else audio.pause();
  });

  audio.addEventListener('play', () => {
    playBtn.textContent = '▮▮';
  });
  audio.addEventListener('pause', () => {
    playBtn.textContent = '▶';
  });
  audio.addEventListener('timeupdate', updateProgress);
  audio.addEventListener('loadedmetadata', () => {
    duration = audio.duration || 0;
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
    renderMarkers();
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
    if (li) {
      selectedId = li.dataset.id;
      renderMarkers();
    }
  });

  window.addEventListener('keydown', onKeyDown);
  container.focus();

  return {
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      audio.pause();
      container.innerHTML = '';
      container.classList.remove('ctp-mount');
    },
    getAudio: () => audio,
  };
}
