/**
 * 雲端同步視窗：登入（Email 驗證碼）→ 同步密碼 → 上傳／下載，以及首頁的「雲端有新資料」提示。
 */
import { version as appVersion } from '../package.json';
import { collectLocalStorage } from './backup.js';
import {
  CLOUD_DEVICE_KEY,
  CloudError,
  cloudConfig,
  compareSync,
  createCloudClient,
  defaultDeviceName,
  deviceName,
  downloadSnapshot,
  keyForMeta,
  loadRememberedKey,
  loadSyncState,
  localFingerprint,
  newCloudKey,
  rememberKey,
  saveCloudConfig,
  uploadSnapshot,
  verifyKey,
} from './cloud-sync.js';
import { escapeHTML } from './utils.js';

const STATUS_TEXT = {
  empty: '雲端還沒有資料：先把這台裝置的資料上傳。',
  synced: '已同步：這台裝置與雲端是同一份資料。',
  'local-ahead': '這台裝置有尚未上傳的變更。',
  'cloud-ahead': '雲端有其他裝置更新的資料，可以下載到這台裝置。',
  conflict: '這台裝置和雲端都有變更：請決定要保留哪一份。',
  'first-link': '這台裝置第一次連上雲端，而且兩邊都有資料：請決定要保留哪一份。',
};

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const sizeText = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function initCloudSyncUI({ showToast = () => {}, authRedirect = null } = {}) {
  const storage = localStorage;
  const modal = document.createElement('div');
  modal.id = 'cloudModal';
  modal.className = 'dev-notes-modal backup-modal cloud-modal';
  modal.hidden = true;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'cloudTitle');
  modal.innerHTML = `
    <div class="dev-notes-dialog backup-dialog cloud-dialog">
      <div class="backup-head">
        <div><p class="backup-kicker">CLOUD SYNC</p><h2 id="cloudTitle">雲端同步</h2></div>
        <button type="button" id="cloudClose" aria-label="關閉雲端同步視窗">關閉</button>
      </div>
      <div id="cloudBody"></div>
      <p class="backup-progress" id="cloudProgress" role="status" aria-live="polite"></p>
    </div>`;
  document.body.appendChild(modal);
  const body = modal.querySelector('#cloudBody');
  const progressEl = modal.querySelector('#cloudProgress');

  const ui = { busy: false, email: '', codeSent: false, key: null, keySalt: '', keyIterations: 0, meta: undefined, sync: null, msg: '' };
  let client = null;

  const config = () => cloudConfig(storage);
  const getClient = () => {
    const c = config();
    if (!c.configured) return null;
    if (!client || client.config.url !== c.url || client.config.anonKey !== c.anonKey) client = createCloudClient({ storage, config: c });
    return client;
  };
  const session = () => getClient()?.getSession() || null;
  const setProgress = (m) => {
    ui.msg = m || '';
    progressEl.textContent = ui.msg;
  };
  const errText = (err) => (err instanceof CloudError ? err.message : `發生錯誤：${err?.message || err}`);
  const jszip = async () => (await import('jszip')).default;

  async function ensureKey() {
    if (ui.key && ui.meta && ui.keySalt !== ui.meta.salt) ui.key = null;
    if (ui.key) return ui.key;
    const salt = ui.meta?.salt || ui.keySalt;
    const k = salt ? await loadRememberedKey(storage, salt) : null;
    if (k && (!ui.meta || (await verifyKey(k, ui.meta)))) {
      ui.key = k;
      ui.keySalt = salt;
      ui.keyIterations = ui.meta?.iterations || 0;
    }
    return ui.key;
  }

  async function refreshStatus({ quiet = false } = {}) {
    const c = getClient();
    if (!c || !session()) return null;
    try {
      ui.meta = await c.getMeta();
      await ensureKey();
      const hasLocalData = Object.keys(collectLocalStorage(storage)).length > 0;
      const fingerprint = await localFingerprint({ JSZip: await jszip(), storage });
      ui.sync = compareSync({ meta: ui.meta, state: loadSyncState(storage), fingerprint, hasLocalData });
    } catch (err) {
      if (err?.code === 'signed-out') ui.meta = undefined;
      if (!quiet) setProgress(errText(err));
      ui.sync = null;
    }
    renderHome();
    return ui.sync;
  }

  /* ---------- 畫面 ---------- */

  function viewSetup() {
    const c = config();
    return `
      <p class="hint">雲端同步可以讓公司電腦、家裡電腦、手機讀到同一份 Call Coach 資料。需要管理者先建立一個 Supabase 專案（免費方案即可），步驟見 <code>docs/cloud-sync-setup.md</code>。</p>
      <section class="backup-sec">
        <h3>連線設定</h3>
        <p class="hint">通常會內建在網站裡；如果這裡是空的，請向管理者索取 Project URL 與 anon public key（這兩個值可以公開，不是密碼）。</p>
        <label class="cloud-field">Project URL<input class="field" id="cloudCfgUrl" placeholder="https://xxxx.supabase.co" value="${escapeHTML(c.url)}"></label>
        <label class="cloud-field">anon public key<input class="field" id="cloudCfgKey" placeholder="eyJhbGciOi…" value="${escapeHTML(c.custom ? c.anonKey : '')}"></label>
        <div class="btns"><button type="button" class="primary" data-cloud="save-config">儲存設定</button></div>
      </section>`;
  }

  function viewSignIn() {
    return `
      <p class="hint">用 Email 登入，不用記密碼：每次登入會寄一封登入信到你的信箱。</p>
      <section class="backup-sec">
        <h3>登入</h3>
        <label class="cloud-field">Email<input class="field" id="cloudEmail" type="email" autocomplete="email" placeholder="you@company.com" value="${escapeHTML(ui.email)}" ${ui.codeSent ? 'readonly' : ''}></label>
        ${
          ui.codeSent
            ? `<div class="cloud-sent">
                 <b>登入信已寄到 ${escapeHTML(ui.email)}</b>
                 <span>請<b>在這台裝置</b>打開信，按「Sign in」或「Confirm email address」連結，就會回到 Call Coach 並完成登入。沒收到請看垃圾信件匣。</span>
               </div>
               <details class="cloud-code-alt"><summary>信裡是數字驗證碼？</summary>
                 <label class="cloud-field">驗證碼<input class="field cloud-code" id="cloudCode" inputmode="numeric" autocomplete="one-time-code" placeholder="信裡的數字"></label>
                 <div class="btns"><button type="button" class="primary" data-cloud="verify">登入</button></div>
               </details>
               <div class="btns"><button type="button" data-cloud="resend">重新寄送</button><button type="button" data-cloud="change-email">改用其他 Email</button></div>`
            : `<div class="btns"><button type="button" class="primary" data-cloud="send">寄送登入信</button></div>`
        }
      </section>
      ${config().custom ? '<p class="hint cloud-small"><button type="button" class="cloud-link" data-cloud="edit-config">修改連線設定</button></p>' : ''}`;
  }

  function viewPassword() {
    const first = !ui.meta;
    return `
      <section class="backup-sec">
        <h3>${first ? '設定同步密碼' : '輸入同步密碼'}</h3>
        <p class="hint">${
          first
            ? '資料會在這個瀏覽器裡用同步密碼加密後才上傳，雲端（包含管理者）都看不到客戶資料。<b>忘記同步密碼就無法取回雲端資料</b>，請記在安全的地方。其他裝置要輸入同一組密碼。'
            : `雲端資料是用同步密碼加密的（最後由「${escapeHTML(ui.meta.device || '其他裝置')}」在 ${escapeHTML(formatDate(ui.meta.updatedAt))} 更新）。請輸入當初設定的同步密碼。`
        }</p>
        <label class="cloud-field">同步密碼<input class="field" id="cloudPw" type="password" autocomplete="${first ? 'new-password' : 'current-password'}" placeholder="至少 8 個字"></label>
        ${first ? '<label class="cloud-field">再輸入一次<input class="field" id="cloudPw2" type="password" autocomplete="new-password"></label>' : ''}
        <label class="backup-opt"><input type="checkbox" id="cloudRemember" checked> 在這台裝置記住（公用電腦請取消勾選）</label>
        <div class="btns"><button type="button" class="primary" data-cloud="${first ? 'set-password' : 'unlock'}">${first ? '設定並繼續' : '解鎖'}</button></div>
        ${first ? '' : '<p class="hint cloud-small"><button type="button" class="cloud-link" data-cloud="forgot">忘記同步密碼？</button></p>'}
      </section>
      ${accountRow()}`;
  }

  function accountRow() {
    const s = session();
    return `<section class="backup-sec cloud-account"><span>已登入 <b>${escapeHTML(s?.user?.email || '')}</b></span><button type="button" data-cloud="sign-out">登出</button></section>`;
  }

  function viewReady() {
    const m = ui.meta;
    const st = ui.sync?.status;
    const reason = st === 'conflict' && ui.sync.reason === 'first-link' ? 'first-link' : st;
    const upPrimary = st === 'empty' || st === 'local-ahead';
    const downPrimary = st === 'cloud-ahead';
    const conflict = st === 'conflict';
    const state = loadSyncState(storage);
    return `
      <div class="cloud-status ${escapeHTML(st || 'unknown')}">
        <b>${escapeHTML(STATUS_TEXT[reason] || '正在檢查雲端狀態…')}</b>
        <dl>
          <div><dt>雲端</dt><dd>${m ? `${escapeHTML(formatDate(m.updatedAt))} · ${escapeHTML(m.device || '')} · ${sizeText(m.bytes || 0)}` : '尚無資料'}</dd></div>
          <div><dt>這台裝置</dt><dd>${state?.syncedAt ? `上次同步 ${escapeHTML(formatDate(state.syncedAt))}` : '尚未同步過'}</dd></div>
        </dl>
      </div>
      <section class="backup-sec">
        <h3>同步</h3>
        <p class="hint">上傳＝用這台裝置的資料<b>取代</b>雲端；下載＝用雲端資料<b>取代</b>這台裝置。錄音與 API Key／Token 不會上傳，下載時這台裝置原本的會保留。</p>
        ${conflict ? '<p class="backup-warn">兩邊都有變更，無法自動合併。不確定的話，先到「備份／還原」下載這台裝置的備份檔，再決定保留哪一份。</p>' : ''}
        <div class="btns">
          <button type="button" class="${upPrimary ? 'primary' : ''}" data-cloud="${conflict ? 'upload-force' : 'upload'}" ${st === 'synced' ? 'disabled' : ''}>${conflict ? '保留這台：覆蓋雲端' : '上傳這台裝置的資料'}</button>
          <button type="button" class="${downPrimary ? 'primary' : ''}" data-cloud="download" ${!m || st === 'synced' ? 'disabled' : ''}>${conflict ? '保留雲端：覆蓋這台' : '下載雲端資料'}</button>
          <button type="button" data-cloud="recheck">重新檢查</button>
        </div>
      </section>
      <section class="backup-sec">
        <label class="cloud-field">這台裝置的名稱（顯示在其他裝置）<input class="field" id="cloudDevice" value="${escapeHTML(deviceName(storage))}" placeholder="${escapeHTML(defaultDeviceName())}"></label>
      </section>
      ${accountRow()}`;
  }

  function render() {
    const c = config();
    if (!c.configured || ui.editConfig) body.innerHTML = viewSetup();
    else if (!session()) body.innerHTML = viewSignIn();
    else if (ui.meta === undefined) body.innerHTML = `<p class="hint">正在連線雲端…</p>${accountRow()}`;
    else if (!ui.key) body.innerHTML = viewPassword();
    else body.innerHTML = viewReady();
    body.querySelectorAll('button, input').forEach((el) => (el.disabled = el.disabled || ui.busy));
    progressEl.textContent = ui.msg;
    renderSidebar();
  }

  function renderSidebar() {
    const s = session();
    const st = ui.sync?.status;
    const due = st === 'cloud-ahead' || st === 'conflict' || st === 'local-ahead';
    const top = document.getElementById('homeCloudBtn');
    if (top) {
      top.textContent = s ? s.user.email.split('@')[0] : '登入';
      top.classList.toggle('signed-in', !!s);
      top.classList.toggle('due', !!s && due);
      top.title = s ? `雲端同步・已登入 ${s.user.email}` : '登入雲端，在每台裝置讀到同一份資料';
    }
    const btn = document.getElementById('sidebarCloud');
    if (!btn) return;
    btn.textContent = s ? '雲端同步' : '登入雲端';
    btn.classList.toggle('due', due);
    btn.title = s ? `已登入 ${s.user.email}${st ? `・${STATUS_TEXT[st] || ''}` : ''}` : '登入後可在每台裝置讀到同一份資料';
  }

  function renderHome() {
    renderSidebar();
    const home = document.getElementById('cloudHome');
    if (!home) return;
    const st = ui.sync?.status;
    const s = session();
    const due = !!s && !!ui.key && (st === 'cloud-ahead' || st === 'conflict' || st === 'local-ahead');
    let lead = '登入雲端，公司、家裡、手機都能讀到同一份資料。';
    let label = '登入雲端';
    if (due) {
      lead =
        st === 'cloud-ahead'
          ? `雲端有「${ui.meta?.device || '其他裝置'}」在 ${formatDate(ui.meta?.updatedAt)} 更新的資料。`
          : st === 'local-ahead'
            ? '這台裝置有尚未上傳到雲端的變更。'
            : '這台裝置和雲端都有變更，需要決定保留哪一份。';
      label = st === 'cloud-ahead' ? '下載到這台' : st === 'local-ahead' ? '上傳到雲端' : '查看';
    } else if (s) {
      lead = st === 'synced' ? `雲端已同步・${s.user.email}` : `已登入雲端・${s.user.email}`;
      label = '雲端同步';
    }
    home.hidden = false;
    home.classList.toggle('due', due);
    home.innerHTML = `<span class="backup-strip-text">${escapeHTML(lead)}</span><button type="button" class="${due ? 'primary' : ''}" data-cloud-open>${label}</button>`;
  }

  /* ---------- 動作 ---------- */

  let form = {};
  async function run(fn) {
    if (ui.busy) return;
    form = Object.fromEntries([...body.querySelectorAll('input')].map((i) => [i.id, i.type === 'checkbox' ? i.checked : i.value]));
    ui.busy = true;
    render();
    try {
      await fn();
    } catch (err) {
      setProgress(errText(err));
      if (err?.code === 'signed-out') ui.meta = undefined;
      if (err?.code === 'conflict') await refreshStatus({ quiet: true });
    } finally {
      ui.busy = false;
      render();
    }
  }

  const redirectUrl = () => `${location.origin}${location.pathname}`;
  const val = (id) => String(form[id] ?? '').trim();
  const raw = (id) => String(form[id] ?? '');

  const actions = {
    'save-config': () => {
      saveCloudConfig(storage, { url: val('cloudCfgUrl'), anonKey: val('cloudCfgKey') });
      ui.editConfig = false;
      client = null;
      setProgress(config().configured ? '已儲存連線設定' : 'Project URL 需以 https:// 開頭，anon key 也要填');
    },
    'edit-config': () => {
      ui.editConfig = true;
    },
    send: async () => {
      ui.email = val('cloudEmail');
      await getClient().sendCode(ui.email, { redirectTo: redirectUrl() });
      ui.codeSent = true;
      setProgress('');
    },
    resend: async () => {
      await getClient().sendCode(ui.email, { redirectTo: redirectUrl() });
      setProgress('已重新寄送登入信；請打開最新的那一封');
    },
    'change-email': () => {
      ui.codeSent = false;
      setProgress('');
    },
    verify: async () => {
      await getClient().verifyCode(ui.email, val('cloudCode'));
      ui.codeSent = false;
      setProgress('登入成功');
      showToast('已登入雲端');
      await refreshStatus();
    },
    'set-password': async () => {
      const pw = raw('cloudPw');
      if (pw.length < 8) throw new CloudError('同步密碼至少 8 個字');
      if (pw !== raw('cloudPw2')) throw new CloudError('兩次輸入的同步密碼不一樣');
      setProgress('產生加密金鑰…');
      const k = await newCloudKey(pw);
      ui.key = k.key;
      ui.keySalt = k.salt;
      ui.keyIterations = k.iterations;
      if (form.cloudRemember) await rememberKey(storage, k.key, k.salt);
      if (ui.forceNext) return doUpload(true);
      setProgress('同步密碼已設定，接著把這台裝置的資料上傳。');
      await refreshStatus();
    },
    unlock: async () => {
      setProgress('驗證同步密碼…');
      const k = await keyForMeta(raw('cloudPw'), ui.meta);
      if (!(await verifyKey(k, ui.meta))) throw new CloudError('同步密碼不對');
      ui.key = k;
      ui.keySalt = ui.meta.salt;
      ui.keyIterations = ui.meta.iterations;
      if (form.cloudRemember) await rememberKey(storage, k, ui.meta.salt);
      setProgress('已解鎖');
      await refreshStatus();
    },
    forgot: async () => {
      if (!confirm('同步密碼無法找回。要用「這台裝置的資料」重設雲端嗎？\n雲端目前的資料會被這台的資料取代，其他裝置之後要用新的同步密碼。')) return;
      ui.meta = null;
      ui.forceNext = true;
      setProgress('請設定新的同步密碼，設定後會立刻用這台裝置的資料重設雲端。');
    },
    upload: () => doUpload(false),
    'upload-force': () => {
      if (!confirm('確定用這台裝置的資料取代雲端？其他裝置尚未下載的變更會消失。')) return;
      return doUpload(true);
    },
    download: async () => {
      const st = ui.sync?.status;
      const warn = st === 'conflict' ? '這台裝置尚未上傳的變更會消失。' : '';
      if (!confirm(`用雲端資料取代這台裝置的 Call Coach 資料？${warn}\n（錄音與 API Key／Token 會保留）`)) return;
      await downloadSnapshot({ client: getClient(), JSZip: await jszip(), storage, key: ui.key, meta: ui.meta, onProgress: setProgress });
      setProgress('下載完成，頁面即將重新載入…');
      showToast('已從雲端下載');
      setTimeout(() => location.reload(), 900);
    },
    recheck: async () => {
      setProgress('檢查中…');
      await refreshStatus();
      setProgress('');
    },
    'sign-out': async () => {
      if (!confirm('登出雲端？這台裝置的資料會保留，但會忘記同步密碼。')) return;
      await getClient().signOut();
      Object.assign(ui, { key: null, keySalt: '', meta: undefined, sync: null, codeSent: false });
      setProgress('已登出');
      renderHome();
    },
  };

  async function doUpload(force) {
    const c = getClient();
    await uploadSnapshot({
      client: c,
      JSZip: await jszip(),
      storage,
      key: ui.key,
      salt: ui.keySalt,
      iterations: ui.keyIterations || undefined,
      appVersion,
      force: force || !!ui.forceNext,
      onProgress: setProgress,
    });
    ui.forceNext = false;
    setProgress('已上傳到雲端。其他裝置登入後按「下載雲端資料」即可。');
    showToast('已上傳到雲端');
    await refreshStatus();
  }

  body.addEventListener('click', (e) => {
    const name = e.target.closest('[data-cloud]')?.dataset.cloud;
    if (name && actions[name]) run(actions[name]);
  });
  body.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    const primary = e.target.closest('.backup-sec')?.querySelector('button.primary');
    if (primary) primary.click();
  });
  body.addEventListener('change', (e) => {
    if (e.target.id !== 'cloudDevice') return;
    const v = e.target.value.trim();
    if (v) storage.setItem(CLOUD_DEVICE_KEY, v.slice(0, 40));
    else storage.removeItem(CLOUD_DEVICE_KEY);
  });

  function open() {
    modal.hidden = false;
    setProgress('');
    render();
    if (session()) refreshStatus().then(render);
  }
  function close() {
    if (ui.busy) return;
    modal.hidden = true;
  }
  modal.querySelector('#cloudClose').addEventListener('click', close);
  modal.addEventListener('click', (e) => e.target === modal && close());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && !modal.hidden && close());
  document.addEventListener('click', (e) => {
    if (e.target.closest('#sidebarCloud, #homeCloudBtn, [data-cloud-open]')) open();
  });

  let lastCheck = 0;
  const backgroundCheck = () => {
    if (!session() || !modal.hidden || Date.now() - lastCheck < 60000) return;
    lastCheck = Date.now();
    refreshStatus({ quiet: true });
  };
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && backgroundCheck());
  setTimeout(backgroundCheck, 2500);
  renderHome();

  if (authRedirect?.tokens && getClient()) {
    modal.hidden = false;
    run(async () => {
      setProgress('完成登入中…');
      await getClient().completeRedirect(authRedirect.tokens);
      ui.codeSent = false;
      setProgress('登入成功');
      showToast('已登入雲端');
      await refreshStatus();
    });
  } else if (authRedirect?.error) {
    modal.hidden = false;
    setProgress(authRedirect.error);
    render();
  }

  return { open, refresh: () => refreshStatus({ quiet: true }) };
}
