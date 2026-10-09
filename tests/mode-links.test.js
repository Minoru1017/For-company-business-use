import { describe, expect, it } from 'vitest';
import { runAnalysis } from '../src/analyze.js';
import { deckInputFromCall, filledDeckFields } from '../src/deck-from-call.js';
import { DRILL_FOCUSES, evaluateFocus, focusForSymptom, pickDrillFocus, recentSymptomAggregate } from '../src/drill-focus.js';
import { appendDrillLog, DRILL_LOG_KEY, drillLogEntry, loadDrillLog, summarizeDrills } from '../src/drill-log.js';
import { endSession, newSession, respond, sessionStats, startSession } from '../src/drill-engine.js';
import { getPersona, DRILL_PERSONAS } from '../src/drill-personas.js';
import { buildMonthlyStatsHint, computeMonthlyStats, monthlyDrillStats } from '../src/monthly-review.js';
import { enrichSegments } from '../src/parser.js';
import { SYMPTOM_DEFS } from '../src/symptom-engine.js';

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

const call = (name, keys) => ({ name, symptoms: { keys, evidence: {}, metrics: {} } });

describe('drill-focus：症狀 → 陪練重點', () => {
  it('每個陪練重點對應的症狀都存在，且每個症狀只屬於一個重點', () => {
    const seen = new Set();
    Object.values(DRILL_FOCUSES).forEach((f) => {
      f.symptoms.forEach((k) => {
        expect(SYMPTOM_DEFS[k], k).toBeTruthy();
        expect(seen.has(k), k).toBe(false);
        seen.add(k);
      });
      expect(['full', 'icebreak']).toContain(f.track);
    });
    expect(focusForSymptom('early_hangup').key).toBe('icebreak');
    expect(focusForSymptom('premature_pitch').key).toBe('noRush');
    expect(focusForSymptom('nope')).toBeNull();
  });

  it('挑最近最常出現的弱點，同一重點的症狀次數合併計算', async () => {
    const calls = [
      call('a', ['premature_pitch', 'layer_shallow']),
      call('b', ['premature_pitch', 'no_converge']),
      call('c', ['layer_incomplete', 'early_hangup']),
    ];
    const agg = await recentSymptomAggregate(async () => calls);
    const pick = pickDrillFocus(agg);
    expect(pick.focus.key).toBe('dig');
    expect(pick.total).toBe(3);
    expect(pick.symptoms.map((s) => s.key)).toEqual(expect.arrayContaining(['layer_shallow', 'no_converge', 'layer_incomplete']));
  });

  it('恐嚇式用語加權優先，沒有資料時回傳 null', async () => {
    const agg = await recentSymptomAggregate(async () => [call('a', ['fear_words', 'talk_too_much']), call('b', ['talk_too_much'])]);
    expect(pickDrillFocus(agg).focus.key).toBe('noFear');
    expect(pickDrillFocus({ total: 0, symptoms: [] })).toBeNull();
    expect(pickDrillFocus(null)).toBeNull();
  });

  it('recentSymptomAggregate 用最近 14 天（含今天）的區間查詢', async () => {
    let range;
    await recentSymptomAggregate(
      async (from, to) => {
        range = [from, to];
        return [];
      },
      { now: new Date(2026, 9, 9) }
    );
    expect(range).toEqual(['2026-09-26', '2026-10-09']);
  });

  it('依陪練結果判斷重點有沒有做到', () => {
    const base = { score: 80, salesLines: 6, timeouts: 0, canned: 0, fear: 0, tooEarly: 0, wrongProbe: 0, tooLong: 0, goodQuestions: 4, followUps: 3, generalLayers: 4, tierLayers: 2, connected: true, endReason: 'manual' };
    expect(evaluateFocus('noRush', base).met).toBe(true);
    expect(evaluateFocus('noRush', { ...base, tooEarly: 1 }).met).toBe(false);
    expect(evaluateFocus('listen', { ...base, tooLong: 2 }).detail).toContain('太長 2');
    expect(evaluateFocus('tier', base, { tierCorrect: false }).met).toBe(false);
    expect(evaluateFocus('icebreak', { ...base, endReason: 'icebreakWin' }).met).toBe(true);
    expect(evaluateFocus('', base)).toBeNull();
  });
});

describe('drill-log：陪練紀錄與趨勢', () => {
  it('真實陪練結束後存一筆摘要，並裁到上限', () => {
    const storage = memStorage();
    const s = newSession({ persona: getPersona(DRILL_PERSONAS[0].key), track: 'full', difficulty: 'gentle', limitSec: 30, engine: 'script' });
    startSession(s);
    respond(s, '您好，我是 AI 學院的顧問，現在方便聊兩分鐘嗎？', 3000);
    respond(s, '你現在工作上大概是什麼狀況？', 4000);
    endSession(s, 'manual');
    const stats = sessionStats(s);
    const entry = drillLogEntry({ session: s, stats, focus: { key: 'listen', met: false }, now: new Date(2026, 9, 9, 10).getTime() });
    expect(entry).toMatchObject({ date: '2026-10-09', track: 'full', score: stats.score, focus: 'listen', focusMet: false });
    appendDrillLog(entry, storage);
    expect(loadDrillLog(storage)).toHaveLength(1);
    storage.setItem(DRILL_LOG_KEY, 'not json');
    expect(loadDrillLog(storage)).toEqual([]);
  });

  it('彙總練習量、平均、前後半趨勢與每日分數', () => {
    const at = (d, h = 9) => new Date(2026, 9, d, h).getTime();
    const log = [
      { at: at(1), date: '2026-10-01', track: 'icebreak', score: 50 },
      { at: at(1, 10), date: '2026-10-01', track: 'full', score: 60 },
      { at: at(5), date: '2026-10-05', track: 'full', score: 70, focus: 'dig', focusMet: true },
      { at: at(8), date: '2026-10-08', track: 'full', score: 80, focus: 'dig', focusMet: false },
      { at: at(1), date: '2026-09-30', track: 'full', score: 10 },
    ];
    const s = summarizeDrills(log, '2026-10-01', '2026-10-31');
    expect(s).toMatchObject({ count: 4, days: 3, avgScore: 65, bestScore: 80, trend: 20, icebreak: 1, full: 3, focusCount: 2, focusMet: 1 });
    expect(s.daily).toEqual([
      { date: '2026-10-01', count: 2, avg: 55 },
      { date: '2026-10-05', count: 1, avg: 70 },
      { date: '2026-10-08', count: 1, avg: 80 },
    ]);
    expect(summarizeDrills(log.slice(0, 2), '2026-10-01', '2026-10-31').trend).toBeNull();
  });
});

describe('monthly-review：每月總結帶陪練量', () => {
  const log = [
    { at: 1, date: '2026-09-10', track: 'full', score: 50 },
    { at: 2, date: '2026-10-02', track: 'full', score: 60 },
    { at: 3, date: '2026-10-03', track: 'full', score: 70 },
  ];

  it('當月對上月平均分', () => {
    const d = monthlyDrillStats(log, 2026, 10);
    expect(d).toMatchObject({ count: 2, avgScore: 65, prevAvgScore: 50, prevCount: 1 });
    expect(monthlyDrillStats(log, 2026, 1).prevAvgScore).toBeNull();
  });

  it('computeMonthlyStats 回傳 drills，提示文字寫出練習量與進退步', async () => {
    const stats = await computeMonthlyStats({
      year: 2026,
      month: 10,
      summarizeRange: async () => ({}),
      listDays: async () => [],
      listCallsBetween: async () => [],
      drillLog: log,
    });
    expect(stats.drills.count).toBe(2);
    const hint = buildMonthlyStatsHint(stats);
    expect(hint).toContain('陪練 2 次（2 天）');
    expect(hint).toContain('進步 15 分');
  });

  it('沒有陪練也不影響原本提示', () => {
    expect(buildMonthlyStatsHint({ analyzedCalls: 0, drills: { count: 0 } })).toContain('尚無批次分析紀錄');
  });
});

describe('deck-from-call：電訪分析 → DEMO 簡報客戶資料', () => {
  const segs = enrichSegments(
    [
      ['S', '您好，我是 AI 學院的顧問，現在方便聊嗎？'],
      ['C', '可以啊，我之前有在網站上留資料'],
      ['S', '你現在工作大概是什麼狀況？'],
      ['C', '我現在是自由業，平常接案做設計，也兼職跑外送'],
      ['S', '如果一直這樣，對你影響最大的是什麼？'],
      ['C', '影響最大是時間，每週花十幾個小時在重複的事'],
      ['S', '為什麼這件事現在對你這麼重要？'],
      ['C', '因為這個想法我想了五年，一直沒有開始'],
      ['S', '如果真的做到了，你最希望變成什麼樣子？'],
      ['C', '希望可以用 AI 做音樂 cover，工作生活更自由'],
      ['C', '可是我很擔心自己學不會，工具一直變怎麼辦？'],
      ['C', '我平日晚上大概只有一小時，用的是 Windows 筆電'],
      ['C', '嗯嗯'],
    ].map(([spk, text], i) => ({ start: i * 20, end: i * 20 + 15, text, spk }))
  );

  it('只取客戶原話，依問到的層次與關鍵字分到各欄位', () => {
    const input = deckInputFromCall(segs, runAnalysis(segs), { source: 'call-1006.srt' });
    expect(input.background).toContain('自由業');
    expect(input.story).toContain('想了五年');
    expect(input.goals).toContain('音樂 cover');
    expect(input.concerns).toContain('學不會');
    expect(input.availability).toContain('Windows');
    expect(input.story).toContain('影響最大是時間');
    expect(input.availability).not.toContain('影響最大');
    expect(input.story).not.toContain('留資料');
    expect(input.raw).toContain('[00:20] 可以啊');
    expect(input.raw).toContain('call-1006.srt');
    expect(input.raw).toContain('[01:00] 我現在是自由業');
    expect(input.raw).not.toContain('顧問');
    expect(input.raw).not.toContain('嗯嗯');
    const all = ['background', 'story', 'goals', 'concerns', 'availability'].map((k) => input[k]).join('\n');
    expect(all.match(/學不會/g)).toHaveLength(1);
    expect(filledDeckFields(input).length).toBeGreaterThanOrEqual(5);
  });

  it('目的分級帶入學員特質；沒有客戶原話時欄位留空', () => {
    const fake = { purposeProfile: { classified: true, dominant: { label: '爽什麼', purpose: '想要成就感' }, secondary: null } };
    expect(deckInputFromCall(segs, fake).traits).toBe('目的分級：爽什麼（想要成就感）');
    const empty = deckInputFromCall(segs.filter((s) => s.spk === 'S'), null);
    expect(empty.raw).toBe('');
    expect(filledDeckFields(empty)).toEqual([]);
  });
});
