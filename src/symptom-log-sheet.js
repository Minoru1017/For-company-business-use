/**
 * 症狀紀錄的 Google 試算表同步：讀取自評病症、勾選寫回、漏斗＋筆記寫入、Apps Script 設定。
 */
import { APPS_SCRIPT_TEMPLATE, FOLLOW_THROUGH_OPTIONS, buildSheetModel, fetchSheetModel, markIsOn, planDayWrites, writeSheetCells } from './sheet-sync.js';
import { saveSettings } from './symptom-store.js';
import { applyCellsToRows, fmtDateLabel, selfMarkNamesFor } from './symptom-log-helpers.js';
import { escapeHTML } from './utils.js';

/**
 * @param {object} ctx
 * @param {(sel:string)=>Element|null} ctx.q
 * @param {object} ctx.state  症狀紀錄的共用 state（讀寫 state.sheet、state.settings，讀 state.selected）
 * @param {(el:Element, msg:string, kind?:string)=>void} ctx.setStatus
 * @param {(el:Element)=>void} ctx.hideStatus
 * @param {(msg:string)=>void} ctx.toast
 * @param {()=>void} ctx.onSheetChanged  試算表內容變了（重畫日曆與近 7 天）
 * @param {()=>object} ctx.getDayToolColumns  「漏斗＋筆記寫入」要寫的工具欄位
 */
export function createSheetSync({ q, state, setStatus, hideStatus, toast, onSheetChanged, getDayToolColumns }) {
  const sheetUrlEl = q('#slSheetUrl');
  const scriptUrlEl = q('#slScriptUrl');
  const scriptTokenEl = q('#slScriptToken');
  const sheetStatusEl = q('#slSheetStatus');
  const selfCard = q('#slSelfCard');
  const selfListEl = q('#slSelfList');
  const followEl = q('#slFollow');
  const selfStatusEl = q('#slSelfStatus');

  function selfMarkNames(key) {
    return selfMarkNamesFor(state.sheet.model, key);
  }

  function canWrite() {
    return !!(state.settings.scriptUrl || '').trim();
  }

  function renderSheetState() {
    const el = q('#slSheetState');
    const m = state.sheet.model;
    if (state.sheet.error) el.textContent = '讀取失敗';
    else if (!m) el.textContent = state.settings.sheetUrl ? '尚未讀取' : '未設定';
    else el.textContent = `${m.headers.length} 個病症 · ${Object.keys(m.days).length} 天${canWrite() ? ' · 可寫回' : ' · 唯讀'}`;
    const open = q('#slSheetOpen');
    if (open) open.href = state.settings.sheetUrl || '#';
  }

  async function loadSheet({ quiet = false } = {}) {
    const url = (state.settings.sheetUrl || '').trim();
    if (!url) {
      state.sheet.model = null;
      renderSheetState();
      renderSelf();
      return;
    }
    if (state.sheet.busy) return;
    state.sheet.busy = true;
    if (!quiet) setStatus(sheetStatusEl, '讀取試算表…');
    try {
      const { model, rows } = await fetchSheetModel({ sheetUrl: url });
      state.sheet.model = model;
      state.sheet.rows = rows;
      state.sheet.loadedAt = Date.now();
      state.sheet.error = '';
      if (!quiet) setStatus(sheetStatusEl, `已讀取：${model.headers.length} 個病症欄、${Object.keys(model.days).length} 天${model.statusCol >= 0 ? '、找到「有沒有做到」欄' : ''}`, 'ok');
    } catch (e) {
      state.sheet.error = e.message || '讀取失敗';
      if (!quiet) setStatus(sheetStatusEl, state.sheet.error, 'err');
    } finally {
      state.sheet.busy = false;
    }
    renderSheetState();
    renderSelf();
    onSheetChanged();
  }

  /** 寫入成功後先把本地的 rows 依 cells 改掉再重建模型，不用等 Google 的 CSV 快取更新 */
  function applyCellsLocally(cells) {
    state.sheet.rows = applyCellsToRows(state.sheet.rows, cells);
    state.sheet.model = buildSheetModel(state.sheet.rows);
  }

  async function writeDay(changes, { label = '寫入' } = {}) {
    if (!state.sheet.model || !state.selected) return false;
    if (!canWrite()) {
      setStatus(selfStatusEl, '目前是唯讀：要從這裡寫回試算表，請在上方「Google 試算表同步」填 Apps Script 網址', 'err');
      return false;
    }
    if (state.sheet.writing) return false;
    state.sheet.writing = true;
    state.sheet.flash = true;
    setStatus(selfStatusEl, `${label}中…`);
    try {
      const plan = planDayWrites(state.sheet.model, state.selected, changes);
      await writeSheetCells({ scriptUrl: state.settings.scriptUrl.trim(), token: state.settings.scriptToken || '', cells: plan.cells });
      applyCellsLocally(plan.cells);
      state.sheet.loadedAt = Date.now();
      setStatus(selfStatusEl, `${label}完成（${plan.newRow ? `新增 ${fmtDateLabel(state.selected)} 這一列，` : ''}${plan.cells.length} 格）`, 'ok');
      renderSheetState();
      onSheetChanged();
      setTimeout(() => loadSheet({ quiet: true }), 2500);
      return true;
    } catch (e) {
      setStatus(selfStatusEl, e.message || `${label}失敗`, 'err');
      toast(e.message || `${label}失敗`);
      return false;
    } finally {
      state.sheet.writing = false;
      renderSelf();
    }
  }

  function renderSelf() {
    const m = state.sheet.model;
    if (!selfCard) return;
    if (!m || !state.selected) {
      selfCard.hidden = true;
      return;
    }
    selfCard.hidden = false;
    const day = m.days[state.selected];
    const ro = !canWrite();
    const writing = state.sheet.writing;
    selfListEl.innerHTML = m.headers.length
      ? m.headers
          .map((h) => {
            const on = day ? markIsOn(day.marks[h.col]) : false;
            return `<label class="slog-self-item ${on ? 'on' : ''}"><input type="checkbox" data-self-col="${h.col}" ${on ? 'checked' : ''} ${ro || writing ? 'disabled' : ''}><span>${escapeHTML(h.name)}</span></label>`;
          })
          .join('')
      : '<p class="hint">試算表第 1 列還沒有病症名稱（B 欄起每欄填一個）。</p>';
    const status = day?.status || '';
    followEl.innerHTML =
      FOLLOW_THROUGH_OPTIONS.map(
        (o) => `<label class="slog-follow-opt ${status === o ? 'on' : ''}"><input type="radio" name="slFollow" value="${escapeHTML(o)}" ${status === o ? 'checked' : ''} ${ro || writing ? 'disabled' : ''}>${escapeHTML(o)}</label>`
      ).join('') + (status && !FOLLOW_THROUGH_OPTIONS.includes(status) ? `<span class="hint">試算表目前填：${escapeHTML(status)}</span>` : '');
    q('#slPushDay').disabled = ro || writing;
    q('#slPushDay').title = ro ? '需先填 Apps Script 網址' : '';
    if (state.sheet.flash) return;
    if (ro) {
      setStatus(selfStatusEl, day ? '唯讀：顯示試算表裡這一天的內容。填 Apps Script 網址後可直接在這裡勾選寫回。' : '試算表裡還沒有這一天；填 Apps Script 網址後，第一次勾選會自動新增這一列。', 'busy');
    } else if (!day) {
      setStatus(selfStatusEl, '試算表裡還沒有這一天，第一次勾選會自動新增這一列。', 'busy');
    } else hideStatus(selfStatusEl);
  }

  selfListEl?.addEventListener('change', (e) => {
    const cb = e.target.closest('[data-self-col]');
    if (!cb) return;
    const col = Number(cb.dataset.selfCol);
    const name = state.sheet.model?.headers.find((h) => h.col === col)?.name || '';
    writeDay({ marks: { [col]: cb.checked } }, { label: `「${name}」${cb.checked ? '記為有' : '記為無'}` });
  });
  followEl?.addEventListener('change', (e) => {
    const r = e.target.closest('input[name="slFollow"]');
    if (r) writeDay({ status: r.value }, { label: '「有沒有做到」' });
  });
  q('#slPushDay')?.addEventListener('click', () => {
    writeDay({ tool: getDayToolColumns() }, { label: '漏斗＋筆記寫入' });
  });

  const persistSheetSettings = (() => {
    let t = null;
    return () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const patch = { sheetUrl: sheetUrlEl.value.trim(), scriptUrl: scriptUrlEl.value.trim(), scriptToken: scriptTokenEl.value.trim() };
        state.settings = { ...state.settings, ...patch };
        try {
          state.settings = await saveSettings(patch);
        } catch {
          /* keep in-memory */
        }
        renderSheetState();
        renderSelf();
      }, 300);
    };
  })();
  [sheetUrlEl, scriptUrlEl, scriptTokenEl].forEach((el) => el?.addEventListener('input', persistSheetSettings));
  sheetUrlEl?.addEventListener('change', () => setTimeout(() => loadSheet(), 350));
  q('#slSheetReload')?.addEventListener('click', () => loadSheet());
  q('#slCopyScript')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(APPS_SCRIPT_TEMPLATE);
      toast('已複製 Apps Script 程式碼');
    } catch {
      q('#slScriptCode')?.select();
      toast('請按 Ctrl+C 複製');
    }
  });
  q('#slTestWrite')?.addEventListener('click', async () => {
    const scriptStatusEl = q('#slScriptStatus');
    const scriptUrl = scriptUrlEl.value.trim();
    if (!scriptUrl) return setStatus(scriptStatusEl, '請先貼 Apps Script 網址', 'err');
    setStatus(scriptStatusEl, '測試寫入（只碰空格子 ZZ1000，寫完立刻清空）…');
    try {
      await writeSheetCells({ scriptUrl, token: scriptTokenEl.value.trim(), cells: [{ a1: 'ZZ1000', value: 'call-coach-test' }] });
      await writeSheetCells({ scriptUrl, token: scriptTokenEl.value.trim(), cells: [{ a1: 'ZZ1000', value: '' }] });
      setStatus(scriptStatusEl, '寫入測試成功，之後勾選會直接寫回試算表', 'ok');
    } catch (e) {
      setStatus(scriptStatusEl, e.message || '測試失敗', 'err');
    }
  });

  /** 啟動時把已存的試算表設定填回表單 */
  function fillSettingsForm() {
    sheetUrlEl.value = state.settings.sheetUrl || '';
    scriptUrlEl.value = state.settings.scriptUrl || '';
    scriptTokenEl.value = state.settings.scriptToken || '';
    const codeEl = q('#slScriptCode');
    if (codeEl) codeEl.value = APPS_SCRIPT_TEMPLATE;
    renderSheetState();
  }

  return { selfMarkNames, loadSheet, renderSelf, fillSettingsForm };
}
