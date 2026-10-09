/**
 * 資料備份／還原視窗：首頁提醒條、側欄按鈕、下載備份檔、選檔→預覽→確認還原。
 */
import { version as appVersion } from '../package.json';
import { backupFileName, backupStatus, createBackup, markBackedUp, readBackup, restoreBackup, summarizeBackup } from './backup.js';
import { storageEstimate } from './symptom-store.js';
import { escapeHTML } from './utils.js';

const $ = (id) => document.getElementById(id);

function formatBytes(n) {
  if (!(n > 0)) return '0 KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function statusText(st) {
  if (!st.lastAt) return '尚未備份過';
  const ago = st.days === 0 ? '今天' : `${st.days} 天前`;
  return `上次備份：${formatDate(st.lastAt)}（${ago}）`;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function initBackupUI({ showToast = () => {} } = {}) {
  const modal = $('backupModal');
  if (!modal) return { refresh: () => {} };
  let busy = false;
  let pending = null;

  const setProgress = (msg) => ($('backupProgress').textContent = msg || '');
  const setBusy = (on) => {
    busy = on;
    ['backupDownload', 'backupPick', 'backupClose'].forEach((id) => ($(id).disabled = on));
    modal.querySelectorAll('.backup-preview button').forEach((b) => (b.disabled = on));
  };

  function refresh() {
    const st = backupStatus(localStorage);
    const side = $('sidebarBackup');
    if (side) {
      side.classList.toggle('due', st.due);
      side.title = st.due ? `${statusText(st)}，建議現在備份` : statusText(st);
    }
    const home = $('backupHome');
    if (home) {
      home.hidden = false;
      home.classList.toggle('due', st.due);
      const lead = st.due
        ? st.lastAt
          ? `已經 ${st.days} 天沒備份了。紀錄只存在這台電腦，清除瀏覽器資料就會消失。`
          : '還沒有備份過。紀錄只存在這台電腦，清除瀏覽器資料就會消失。'
        : statusText(st);
      home.innerHTML = `<span class="backup-strip-text">${escapeHTML(lead)}</span><button type="button" class="${st.due ? 'primary' : ''}" data-backup-open>${st.due ? '立即備份' : '備份／還原'}</button>`;
    }
    $('backupStatus').textContent = statusText(st);
  }

  async function showUsage() {
    const est = await storageEstimate();
    const st = statusText(backupStatus(localStorage));
    $('backupStatus').textContent = est ? `${st}・目前瀏覽器資料約 ${formatBytes(est.usage)}` : st;
  }

  function open() {
    pending = null;
    $('backupPreview').hidden = true;
    $('backupPreview').innerHTML = '';
    setProgress('');
    modal.hidden = false;
    refresh();
    showUsage();
    $('backupDownload').focus();
  }

  function close() {
    if (busy) return;
    modal.hidden = true;
  }

  async function doDownload() {
    if (busy) return;
    setBusy(true);
    try {
      const { default: JSZip } = await import('jszip');
      const now = new Date();
      const { zip, manifest } = await createBackup({
        JSZip,
        storage: localStorage,
        includeAudio: $('backupAudio').checked,
        includeSecrets: $('backupSecrets').checked,
        appVersion,
        now,
        onProgress: setProgress,
      });
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }, (m) =>
        setProgress(`壓縮中… ${Math.round(m.percent)}%`)
      );
      download(blob, backupFileName(now));
      markBackedUp(localStorage, now);
      refresh();
      setProgress(`已下載備份檔（${formatBytes(blob.size)}${manifest.includeAudio ? '' : '，不含錄音'}）。建議存到雲端硬碟或隨身碟。`);
      showToast('備份檔已下載');
    } catch (err) {
      const hint = $('backupAudio').checked ? '；如果是資料太大，可以取消勾選「包含錄音」再試' : '';
      setProgress(`備份失敗：${err?.message || err}${hint}`);
    } finally {
      setBusy(false);
    }
  }

  async function onPick(file) {
    if (!file || busy) return;
    setBusy(true);
    setProgress('讀取備份檔…');
    try {
      const { default: JSZip } = await import('jszip');
      pending = await readBackup(JSZip, file);
      const m = pending.manifest;
      const rows = summarizeBackup(m)
        .map((r) => `<li><span>${escapeHTML(r.label)}</span><b>${r.count}</b></li>`)
        .join('');
      const flags = [m.includeAudio ? '含錄音' : '不含錄音（這台電腦的錄音會保留）', m.includeSecrets ? '含 API Key／Token' : '不含 API Key／Token'];
      $('backupPreview').innerHTML = `
        <p class="backup-preview-head"><b>${escapeHTML(file.name)}</b><span>備份時間 ${escapeHTML(formatDate(m.createdAt))}${m.appVersion ? `・VER ${escapeHTML(m.appVersion)}` : ''}</span></p>
        <p class="hint">${escapeHTML(flags.join('・'))}</p>
        <ul class="backup-preview-list">${rows}</ul>
        <p class="backup-warn">確認後會取代這台電腦目前的 Call Coach 資料，無法復原。若不確定，請先按上面的「下載備份檔」保存目前的資料。</p>
        <div class="btns"><button type="button" class="danger" data-backup-restore>確認還原</button><button type="button" data-backup-cancel>取消</button></div>`;
      $('backupPreview').hidden = false;
      setProgress('');
    } catch (err) {
      pending = null;
      $('backupPreview').hidden = true;
      setProgress(err?.message || String(err));
    } finally {
      $('backupFile').value = '';
      setBusy(false);
    }
  }

  async function doRestore() {
    if (!pending || busy) return;
    setBusy(true);
    try {
      await restoreBackup(pending, { storage: localStorage, onProgress: setProgress });
      setProgress('還原完成，頁面即將重新載入…');
      showToast('還原完成');
      setTimeout(() => location.reload(), 900);
    } catch (err) {
      setProgress(`還原失敗：${err?.message || err}`);
      setBusy(false);
    }
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-backup-open], #sidebarBackup')) open();
    else if (e.target.closest('[data-backup-restore]')) doRestore();
    else if (e.target.closest('[data-backup-cancel]')) {
      pending = null;
      $('backupPreview').hidden = true;
    }
  });
  modal.addEventListener('click', (e) => e.target === modal && close());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && !modal.hidden && close());
  $('backupClose').addEventListener('click', close);
  $('backupDownload').addEventListener('click', doDownload);
  $('backupPick').addEventListener('click', () => $('backupFile').click());
  $('backupFile').addEventListener('change', (e) => onPick(e.target.files?.[0]));

  refresh();
  return { refresh, open };
}
