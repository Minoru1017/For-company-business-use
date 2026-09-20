/**
 * DEMO 錄影本機播放（<video> + 助手 Range 串流），與逐字稿時間軸對齊。
 */
import { bridgeSupports, getSelectedDemoMp4 } from './local-transcribe.js';

const LOCAL_API = 'http://127.0.0.1:8765';

let mountEl = null;
let videoEl = null;
let hintEl = null;
let titleEl = null;
let segments = [];
let activeIdx = -1;
let lastBridgeStatus = null;
let lastSourceName = '';
let currentFile = '';
let getApiToken = async () => '';

function pickMp4Name(st, sourceName, selected) {
  const files = st?.mp4_files || [];
  if (!files.length) return '';
  if (selected && files.includes(selected)) return selected;
  const stem = (sourceName || '').replace(/\.(srt|vtt)$/i, '');
  if (stem) {
    const hit = files.find((f) => f.replace(/\.mp4$/i, '').toLowerCase() === stem.toLowerCase());
    if (hit) return hit;
  }
  return files[0];
}

function mediaUrl(fileName, token) {
  const enc = encodeURIComponent(fileName);
  const q = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${LOCAL_API}/api/media/${enc}${q}`;
}

function findActiveIndex(t) {
  if (!segments.length) return -1;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (t >= s.start && t < s.end) return i;
  }
  for (let i = segments.length - 1; i >= 0; i--) {
    if (t >= segments[i].start) return i;
  }
  return -1;
}

function setPlayingHighlight(idx) {
  if (idx === activeIdx) return;
  activeIdx = idx;
  document.querySelectorAll('#labelList .seg.playing').forEach((row) => row.classList.remove('playing'));
  if (idx < 0) return;
  const row = document.querySelector(`#labelList .seg[data-i="${idx}"]`);
  row?.classList.add('playing');
}

function onTimeUpdate() {
  if (!videoEl || videoEl.paused) return;
  setPlayingHighlight(findActiveIndex(videoEl.currentTime));
}

export function seekDemoTo(seconds) {
  if (!videoEl || !Number.isFinite(seconds)) return false;
  const t = Math.max(0, seconds);
  try {
    videoEl.currentTime = t;
    videoEl.play().catch(() => {});
    setPlayingHighlight(findActiveIndex(t));
    return true;
  } catch {
    return false;
  }
}

export function updateDemoPlayerSegments(segs, sourceName = '') {
  segments = Array.isArray(segs) ? segs : [];
  lastSourceName = sourceName || lastSourceName;
  if (videoEl && !videoEl.paused) onTimeUpdate();
}

async function attachMedia(fileName) {
  if (!mountEl || !videoEl) return;
  if (!fileName) {
    videoEl.removeAttribute('src');
    videoEl.load();
    currentFile = '';
    if (titleEl) titleEl.textContent = '尚無可播放的 MP4';
    if (hintEl) hintEl.textContent = '請將錄影放到 input 資料夾並重新掃描。';
    mountEl.hidden = true;
    return;
  }

  const token = await getApiToken();
  const url = mediaUrl(fileName, token);
  if (currentFile === fileName && videoEl.src && videoEl.src.includes(encodeURIComponent(fileName))) {
    mountEl.hidden = false;
    return;
  }
  currentFile = fileName;
  videoEl.src = url;
  videoEl.load();
  mountEl.hidden = false;
  if (titleEl) titleEl.textContent = fileName;
  if (hintEl) {
    hintEl.textContent =
      '本機串流播放（Range），長檔不需整檔載入記憶體。點下方逐字稿句子可跳轉時間。';
  }
}

export async function refreshDemoPlayerFromBridge(st) {
  lastBridgeStatus = st;
  if (!bridgeSupports('media-playback')) {
    if (mountEl) mountEl.hidden = true;
    return;
  }
  const name = pickMp4Name(st, lastSourceName, getSelectedDemoMp4());
  await attachMedia(name);
}

function ensureDom() {
  if (!mountEl) return;
  if (videoEl) return;
  mountEl.innerHTML = `
    <div class="demo-player">
      <div class="demo-player-head">
        <strong>DEMO 錄影播放</strong>
        <span class="demo-player-title" id="demoPlayerTitle"></span>
      </div>
      <video id="demoPlayerVideo" class="demo-player-video" controls playsinline preload="metadata"></video>
      <p class="hint demo-player-hint" id="demoPlayerHint"></p>
    </div>`;
  videoEl = mountEl.querySelector('#demoPlayerVideo');
  titleEl = mountEl.querySelector('#demoPlayerTitle');
  hintEl = mountEl.querySelector('#demoPlayerHint');
  videoEl.addEventListener('timeupdate', onTimeUpdate);
  videoEl.addEventListener('seeked', onTimeUpdate);
  videoEl.addEventListener('pause', () => setPlayingHighlight(findActiveIndex(videoEl.currentTime)));
}

export function initDemoPlayer({ mountId = 'demoPlayerMount', fetchApiToken }) {
  mountEl = document.getElementById(mountId);
  if (!mountEl) return;
  getApiToken = fetchApiToken || getApiToken;
  ensureDom();
  mountEl.hidden = true;
  window.__demoPlayerOnBridgeStatus = (st) => {
    refreshDemoPlayerFromBridge(st).catch(() => {});
  };
}
