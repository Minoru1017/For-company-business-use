/**
 * 開發症狀紀錄 × Google 試算表同步。
 *
 * 試算表版型（使用者自己維護的那張）：
 *   第 1 列：A 欄備註、B 欄起每欄一個「病症名稱」（可隨時增減欄）
 *   第 2 列起：A 欄日期（9/17 這種 m/d），病症欄填「有」代表當天犯了；
 *   另有一欄沒有標題、填「有做到／沒做到／沒做到但有即時調整」，是「昨天說要改的動作有沒有做到」。
 *
 * 讀：直接抓 Google 的 gviz CSV（公開連結即可，瀏覽器可跨網域）。
 * 寫：需要使用者在試算表「擴充功能 → Apps Script」貼上 APPS_SCRIPT_TEMPLATE 並部署成 Web App，
 *     這裡用 text/plain POST（不觸發 preflight）把要改的儲存格送過去。
 */
import { dateKey } from './symptom-engine.js';

export const FOLLOW_THROUGH_OPTIONS = ['有做到', '沒做到', '沒做到但有即時調整'];

/** 病症格的值算不算「有犯」：有／V／✓／1 算有；無／沒／否／X／- 算沒有 */
export function markIsOn(value) {
  const v = String(value ?? '').trim();
  if (!v) return false;
  return !/^(無|沒有?|否|不|x|✗|✕|-|0|n|no)$/i.test(v);
}

/** 工具寫回試算表的額外欄位（放在既有欄位右側，標題自動建立） */
export const TOOL_COLUMNS = ['撥出', '接通', '超過5分', '長Call', '進邀約', '工具偵測病症', '明天只改一個動作'];

export function extractSheetId(input) {
  const s = String(input || '').trim();
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/.exec(s);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : '';
}

export function extractGid(input) {
  const m = /[#?&]gid=(\d+)/.exec(String(input || ''));
  return m ? m[1] : '0';
}

export function sheetCsvUrl(sheetId, gid = '0') {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(gid)}`;
}

/** RFC4180 風格 CSV（處理引號內的逗號／換行／雙引號） */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const src = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** 0-based 欄索引 → A1 欄名 */
export function colToA1(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function a1ToCol(letters) {
  const s = String(letters || '').toUpperCase().replace(/[^A-Z]/g, '');
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function cellA1(colIndex, rowNumber) {
  return `${colToA1(colIndex)}${rowNumber}`;
}

/**
 * 試算表的日期格式：9/17、2026/9/17、2026-09-17、9月17日。沒寫年份時：以今天為準，
 * 若推出的日期比今天晚超過 120 天，視為去年（跨年時 12/30 仍算去年）。
 */
export function parseSheetDate(text, today = new Date()) {
  const s = String(text || '').trim();
  if (!s) return '';
  let y;
  let m;
  let d;
  let mm = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(s);
  if (mm) [, y, m, d] = mm.map(Number);
  else {
    mm = /^(\d{1,2})[-/.月](\d{1,2})日?$/.exec(s);
    if (!mm) return '';
    m = Number(mm[1]);
    d = Number(mm[2]);
    y = today.getFullYear();
    const cand = new Date(y, m - 1, d);
    if ((cand - today) / 86400000 > 120) y -= 1;
  }
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return '';
  return dateKey(dt);
}

export function formatSheetDate(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  return m ? `${Number(m[2])}/${Number(m[3])}` : '';
}

/**
 * 把 CSV 列轉成可用的模型。
 * @returns {{
 *   headers: Array<{col:number, name:string}>,   病症欄（第 1 列有標題、且不是工具欄）
 *   toolCols: Record<string, number>,             工具欄名稱 → 欄索引（已存在的）
 *   statusCol: number,                            「有沒有做到」欄索引（-1 = 找不到）
 *   days: Record<string, {row:number, marks:Record<number,string>, status:string, tool:Record<string,string>}>,
 *   lastRow: number, rowCount: number
 * }}
 */
export function buildSheetModel(rows, today = new Date()) {
  const table = Array.isArray(rows) ? rows : [];
  const head = table[0] || [];
  const width = Math.max(head.length, ...table.map((r) => r.length), 0);
  const headers = [];
  const toolCols = {};
  const toolSet = new Set(TOOL_COLUMNS);
  for (let c = 1; c < width; c++) {
    const name = String(head[c] || '').trim();
    if (!name) continue;
    if (toolSet.has(name)) toolCols[name] = c;
    else headers.push({ col: c, name: name.replace(/\s*\n\s*/g, '、') });
  }
  // 「有沒有做到」欄：沒有標題、但格子裡出現三個選項之一
  let statusCol = -1;
  for (let c = 1; c < width && statusCol < 0; c++) {
    if (String(head[c] || '').trim()) continue;
    for (let r = 1; r < table.length; r++) {
      const v = String(table[r]?.[c] || '').trim();
      if (v && FOLLOW_THROUGH_OPTIONS.some((o) => v.includes(o.slice(0, 3)))) {
        statusCol = c;
        break;
      }
    }
  }
  const days = {};
  let lastRow = 1;
  for (let r = 1; r < table.length; r++) {
    const row = table[r] || [];
    const nonEmpty = row.some((v) => String(v || '').trim());
    if (nonEmpty) lastRow = r + 1;
    const key = parseSheetDate(row[0], today);
    if (!key) continue;
    const marks = {};
    headers.forEach((h) => {
      const v = String(row[h.col] || '').trim();
      if (v) marks[h.col] = v;
    });
    const tool = {};
    Object.entries(toolCols).forEach(([name, c]) => {
      const v = String(row[c] || '').trim();
      if (v) tool[name] = v;
    });
    days[key] = { row: r + 1, marks, status: statusCol >= 0 ? String(row[statusCol] || '').trim() : '', tool };
  }
  return { headers, toolCols, statusCol, days, lastRow, rowCount: table.length, width };
}

/**
 * 規劃某天要寫的儲存格。
 * @param {ReturnType<typeof buildSheetModel>} model
 * @param {string} key  YYYY-MM-DD
 * @param {{marks?:Record<number,boolean>, status?:string|null, tool?:Record<string,string|number>}} changes
 * @returns {{cells:Array<{a1:string,value:string|number}>, row:number, newRow:boolean, headerCells:Array}}
 */
export function planDayWrites(model, key, changes = {}) {
  const cells = [];
  const headerCells = [];
  const existing = model.days[key];
  const row = existing ? existing.row : Math.max(model.lastRow, 1) + 1;
  const newRow = !existing;
  if (newRow) cells.push({ a1: cellA1(0, row), value: formatSheetDate(key) });

  if (changes.marks) {
    Object.entries(changes.marks).forEach(([col, on]) => {
      cells.push({ a1: cellA1(Number(col), row), value: on ? '有' : '無' });
    });
  }
  if (changes.status !== undefined && changes.status !== null) {
    let statusCol = model.statusCol;
    if (statusCol < 0) {
      // 還沒有這一欄：放在病症欄之後空四欄（跟使用者原本的排法一致），並補標題
      const lastSym = model.headers.length ? Math.max(...model.headers.map((h) => h.col)) : 0;
      statusCol = lastSym + 5;
      headerCells.push({ a1: cellA1(statusCol, 1), value: '昨天的動作有做到嗎' });
    }
    cells.push({ a1: cellA1(statusCol, row), value: changes.status });
  }
  if (changes.tool) {
    const usedCols = new Set([
      0,
      ...model.headers.map((h) => h.col),
      ...Object.values(model.toolCols),
      ...(model.statusCol >= 0 ? [model.statusCol] : []),
    ]);
    let next = Math.max((model.width || 1) - 1, ...usedCols) + 1;
    const nextFree = () => {
      while (usedCols.has(next)) next++;
      return next++;
    };
    const toolCols = { ...model.toolCols };
    TOOL_COLUMNS.forEach((name) => {
      if (toolCols[name] == null) {
        toolCols[name] = nextFree();
        headerCells.push({ a1: cellA1(toolCols[name], 1), value: name });
      }
    });
    Object.entries(changes.tool).forEach(([name, v]) => {
      if (toolCols[name] == null || v == null) return;
      cells.push({ a1: cellA1(toolCols[name], row), value: v });
    });
  }
  return { cells: [...headerCells, ...cells], row, newRow, headerCells };
}

export async function fetchSheetModel({ sheetUrl, fetchImpl = fetch, today = new Date() }) {
  const id = extractSheetId(sheetUrl);
  if (!id) throw new Error('試算表網址格式不對，請貼完整的 docs.google.com/spreadsheets/d/… 連結');
  let res;
  try {
    res = await fetchImpl(sheetCsvUrl(id, extractGid(sheetUrl)), { cache: 'no-store' });
  } catch {
    throw new Error('連不到 Google 試算表：請確認網路，且試算表共用設定是「知道連結的使用者可檢視」');
  }
  if (!res.ok) {
    throw new Error(res.status === 401 || res.status === 403 || res.status === 404 ? '試算表不允許讀取：請把共用設定改成「知道連結的使用者 → 檢視者」' : `讀取試算表失敗（HTTP ${res.status}）`);
  }
  const text = await res.text();
  if (/<html/i.test(text.slice(0, 200))) throw new Error('試算表不允許讀取：請把共用設定改成「知道連結的使用者 → 檢視者」');
  const rows = parseCsv(text);
  return { model: buildSheetModel(rows, today), rows };
}

export function isAppsScriptUrl(url) {
  return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec\/?$/.test(String(url || '').trim());
}

/**
 * 透過 Apps Script Web App 寫儲存格。用 text/plain 避開 CORS preflight；
 * Apps Script 會 302 到 googleusercontent 網域回 JSON（有 CORS），fetch 會自動跟隨。
 */
export async function writeSheetCells({ scriptUrl, token = '', cells, gid = '0', fetchImpl = fetch }) {
  if (!isAppsScriptUrl(scriptUrl)) throw new Error('Apps Script 網址格式不對，應為 https://script.google.com/macros/s/…/exec');
  if (!cells?.length) return { ok: true, written: 0 };
  let res;
  try {
    res = await fetchImpl(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token, gid, cells }),
      redirect: 'follow',
    });
  } catch {
    throw new Error('連不到 Apps Script：請確認已「部署 → 新增部署 → 網頁應用程式」，存取權選「所有人」，且貼的是 /exec 結尾的網址');
  }
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (!res.ok || !data || data.ok === false) {
    const reason = data?.error || (/<html/i.test(text) ? '回應是網頁而不是 JSON——多半是部署時「執行身分」不是你自己，或存取權不是「所有人」' : `HTTP ${res.status}`);
    throw new Error(`寫入試算表失敗：${reason}`);
  }
  return data;
}

export const APPS_SCRIPT_TEMPLATE = `// Call Coach 症狀紀錄 → 這張試算表的寫入端。
// 1) 試算表上方「擴充功能 → Apps Script」，把整段貼進去取代原本內容，改 TOKEN（隨便一串字，網頁那邊要填一樣的）
// 2) 右上「部署 → 新增部署」→ 類型「網頁應用程式」→ 執行身分「我」→ 存取權「所有人」→ 部署
// 3) 複製「網頁應用程式 URL」（/exec 結尾）貼回 Call Coach
const TOKEN = 'CHANGE_ME';

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData && e.postData.contents || '{}'); } catch (err) { return out({ ok: false, error: 'bad json' }); }
  if (TOKEN && body.token !== TOKEN) return out({ ok: false, error: 'token 不符' });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const gid = Number(body.gid || 0);
  const sheet = ss.getSheets().find((s) => s.getSheetId() === gid) || ss.getSheets()[0];
  const cells = Array.isArray(body.cells) ? body.cells : [];
  cells.forEach((c) => { if (c && c.a1) sheet.getRange(String(c.a1)).setValue(c.value == null ? '' : c.value); });
  SpreadsheetApp.flush();
  return out({ ok: true, written: cells.length, sheet: sheet.getName() });
}

function doGet() { return out({ ok: true, name: 'Call Coach sheet writer' }); }

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
`;
