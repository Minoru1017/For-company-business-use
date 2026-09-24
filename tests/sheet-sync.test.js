import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  APPS_SCRIPT_TEMPLATE,
  FOLLOW_THROUGH_OPTIONS,
  a1ToCol,
  buildSheetModel,
  cellA1,
  colToA1,
  extractGid,
  extractSheetId,
  fetchSheetModel,
  formatSheetDate,
  isAppsScriptUrl,
  markIsOn,
  parseCsv,
  parseSheetDate,
  planDayWrites,
  sheetCsvUrl,
  writeSheetCells,
} from '../src/sheet-sync.js';

const CSV = readFileSync(join(process.cwd(), 'tests/fixtures/symptom-sheet.csv'), 'utf-8');
const TODAY = new Date(2026, 8, 24);
const URL = 'https://docs.google.com/spreadsheets/d/1c7W5vfpQPGqm8urKqd-fM-qt3x2Xz5fvhpt5eGgp3pA/edit?usp=sharing';

describe('url helpers', () => {
  it('extracts sheet id and gid', () => {
    expect(extractSheetId(URL)).toBe('1c7W5vfpQPGqm8urKqd-fM-qt3x2Xz5fvhpt5eGgp3pA');
    expect(extractSheetId('1c7W5vfpQPGqm8urKqd-fM-qt3x2Xz5fvhpt5eGgp3pA')).toBe('1c7W5vfpQPGqm8urKqd-fM-qt3x2Xz5fvhpt5eGgp3pA');
    expect(extractSheetId('https://example.com/x')).toBe('');
    expect(extractGid(`${URL}#gid=123`)).toBe('123');
    expect(extractGid(URL)).toBe('0');
    expect(sheetCsvUrl('abc', '5')).toBe('https://docs.google.com/spreadsheets/d/abc/gviz/tq?tqx=out:csv&gid=5');
  });
  it('validates Apps Script exec urls', () => {
    expect(isAppsScriptUrl('https://script.google.com/macros/s/AKfycbxyz_-123/exec')).toBe(true);
    expect(isAppsScriptUrl('https://script.google.com/macros/s/AKfycbxyz/dev')).toBe(false);
    expect(isAppsScriptUrl('https://docs.google.com/')).toBe(false);
  });
});

describe('csv + a1 helpers', () => {
  it('parses quoted newlines, commas and escaped quotes', () => {
    const rows = parseCsv('"a\nb","c,d","e""f"\r\n1,2,3\n');
    expect(rows).toEqual([['a\nb', 'c,d', 'e"f'], ['1', '2', '3']]);
  });
  it('A1 conversions', () => {
    expect(colToA1(0)).toBe('A');
    expect(colToA1(15)).toBe('P');
    expect(colToA1(26)).toBe('AA');
    expect(a1ToCol('P')).toBe(15);
    expect(a1ToCol('AA')).toBe(26);
    expect(cellA1(1, 3)).toBe('B3');
  });
});

describe('parseSheetDate', () => {
  it('m/d without year uses current year, or last year when far in the future', () => {
    expect(parseSheetDate('9/17', TODAY)).toBe('2026-09-17');
    expect(parseSheetDate('10/8', TODAY)).toBe('2026-10-08');
    expect(parseSheetDate('12/30', new Date(2027, 0, 3))).toBe('2026-12-30');
    expect(parseSheetDate('2026-09-17', TODAY)).toBe('2026-09-17');
    expect(parseSheetDate('2026/9/17', TODAY)).toBe('2026-09-17');
    expect(parseSheetDate('9月17日', TODAY)).toBe('2026-09-17');
    expect(parseSheetDate('2/30', TODAY)).toBe('');
    expect(parseSheetDate('', TODAY)).toBe('');
    expect(parseSheetDate('不限開發/demo', TODAY)).toBe('');
  });
  it('formatSheetDate', () => {
    expect(formatSheetDate('2026-10-09')).toBe('10/9');
  });
});

describe('buildSheetModel on the real sheet', () => {
  const model = buildSheetModel(parseCsv(CSV), TODAY);
  it('reads symptom headers from row 1 (B onward), normalising line breaks', () => {
    expect(model.headers.length).toBe(11);
    expect(model.headers[0]).toEqual({ col: 1, name: '在開發2分鐘就講服務' });
    expect(model.headers.map((h) => h.name)).toContain('根據分級決定方向、不要硬挖痛點');
    expect(model.headers.map((h) => h.name)).toContain('對達不到責任額恐慌');
  });
  it('detects the header-less follow-through column (Q)', () => {
    expect(model.statusCol).toBe(16);
    expect(model.days['2026-09-22'].status).toBe('沒做到');
    expect(model.days['2026-09-23'].status).toBe('有做到');
    expect(model.days['2026-09-24'].status).toBe('沒做到但有即時調整');
  });
  it('maps dates to rows and marks', () => {
    expect(model.days['2026-09-17']).toMatchObject({ row: 2, marks: { 1: '有' } });
    expect(model.days['2026-09-18'].marks).toEqual({ 1: '有' });
    expect(model.days['2026-09-19'].marks).toEqual({});
    expect(model.days['2026-09-24'].marks).toEqual({ 1: '無' });
    expect(markIsOn(model.days['2026-09-24'].marks[1])).toBe(false);
    expect(markIsOn('有')).toBe(true);
    expect(markIsOn('V')).toBe(true);
    expect(markIsOn('x')).toBe(false);
    expect(model.days['2026-10-08'].row).toBe(23);
    expect(model.lastRow).toBe(23);
    expect(model.toolCols).toEqual({});
  });
});

describe('planDayWrites', () => {
  const model = buildSheetModel(parseCsv(CSV), TODAY);
  it('writes marks and status into the existing row', () => {
    const plan = planDayWrites(model, '2026-09-24', { marks: { 1: true, 3: false }, status: '有做到' });
    expect(plan.newRow).toBe(false);
    expect(plan.row).toBe(9);
    expect(plan.cells).toEqual([
      { a1: 'B9', value: '有' },
      { a1: 'D9', value: '無' },
      { a1: 'Q9', value: '有做到' },
    ]);
  });
  it('appends a new dated row when the date is missing', () => {
    const plan = planDayWrites(model, '2026-10-09', { marks: { 2: true } });
    expect(plan.newRow).toBe(true);
    expect(plan.row).toBe(24);
    expect(plan.cells[0]).toEqual({ a1: 'A24', value: '10/9' });
    expect(plan.cells[1]).toEqual({ a1: 'C24', value: '有' });
  });
  it('creates tool columns (with headers) to the right of everything, then reuses them', () => {
    const plan = planDayWrites(model, '2026-09-24', { tool: { 撥出: 30, 接通: 8, 進邀約: 1, 明天只改一個動作: '第 3 個問題前不提方案' } });
    const headers = plan.headerCells.map((c) => c.value);
    expect(headers).toEqual(['撥出', '接通', '超過5分', '長Call', '進邀約', '工具偵測病症', '明天只改一個動作']);
    // fixture is 28 columns wide (A..AB) → tool columns start at AC
    expect(plan.headerCells[0].a1).toBe('AC1');
    expect(plan.cells.find((c) => c.value === 30).a1).toBe('AC9');
    expect(plan.cells.find((c) => c.value === 1).a1).toBe('AG9');
    // once headers exist, the model picks them up and no header cells are re-written
    const rows = parseCsv(CSV);
    plan.headerCells.forEach((h) => { rows[0][a1ToCol(h.a1)] = h.value; });
    const model2 = buildSheetModel(rows, TODAY);
    expect(model2.toolCols['撥出']).toBe(28);
    expect(model2.headers.length).toBe(11);
    const plan2 = planDayWrites(model2, '2026-09-24', { tool: { 撥出: 31 } });
    expect(plan2.headerCells).toEqual([]);
    expect(plan2.cells).toEqual([{ a1: 'AC9', value: 31 }]);
  });
  it('adds a status header when the sheet has no follow-through column yet', () => {
    const rows = [['', '病症A', '病症B'], ['9/1', '有', '']];
    const m = buildSheetModel(rows, TODAY);
    expect(m.statusCol).toBe(-1);
    const plan = planDayWrites(m, '2026-09-01', { status: '沒做到' });
    expect(plan.cells).toEqual([
      { a1: 'H1', value: '昨天的動作有做到嗎' },
      { a1: 'H2', value: '沒做到' },
    ]);
  });
});

describe('fetch / write', () => {
  it('fetchSheetModel hits the gviz csv endpoint and builds the model', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => CSV }));
    const { model } = await fetchSheetModel({ sheetUrl: URL, fetchImpl, today: TODAY });
    expect(fetchImpl.mock.calls[0][0]).toContain('/gviz/tq?tqx=out:csv&gid=0');
    expect(model.headers.length).toBe(11);
  });
  it('fetchSheetModel explains sharing problems', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403, text: async () => '' }));
    await expect(fetchSheetModel({ sheetUrl: URL, fetchImpl })).rejects.toThrow(/共用設定/);
    const html = vi.fn(async () => ({ ok: true, status: 200, text: async () => '<html><body>Sign in</body></html>' }));
    await expect(fetchSheetModel({ sheetUrl: URL, fetchImpl: html })).rejects.toThrow(/共用設定/);
  });
  it('writeSheetCells posts text/plain JSON and returns the script response', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, written: 2 }) }));
    const r = await writeSheetCells({ scriptUrl: 'https://script.google.com/macros/s/AKfycb123/exec', token: 't', cells: [{ a1: 'B9', value: '有' }, { a1: 'P9', value: '有做到' }], fetchImpl });
    expect(r.written).toBe(2);
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toMatch(/text\/plain/);
    expect(JSON.parse(init.body)).toEqual({ token: 't', gid: '0', cells: [{ a1: 'B9', value: '有' }, { a1: 'P9', value: '有做到' }] });
  });
  it('writeSheetCells surfaces token / deployment errors', async () => {
    const bad = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: false, error: 'token 不符' }) }));
    await expect(writeSheetCells({ scriptUrl: 'https://script.google.com/macros/s/AK/exec', cells: [{ a1: 'A1', value: 1 }], fetchImpl: bad })).rejects.toThrow(/token 不符/);
    const html = vi.fn(async () => ({ ok: true, status: 200, text: async () => '<html>login</html>' }));
    await expect(writeSheetCells({ scriptUrl: 'https://script.google.com/macros/s/AK/exec', cells: [{ a1: 'A1', value: 1 }], fetchImpl: html })).rejects.toThrow(/所有人/);
    await expect(writeSheetCells({ scriptUrl: 'https://evil.example/exec', cells: [{ a1: 'A1', value: 1 }] })).rejects.toThrow(/Apps Script 網址/);
  });
  it('template mentions the three deployment settings and echoes the options', () => {
    expect(APPS_SCRIPT_TEMPLATE).toContain('doPost');
    expect(APPS_SCRIPT_TEMPLATE).toContain('所有人');
    expect(FOLLOW_THROUGH_OPTIONS).toHaveLength(3);
  });
});
