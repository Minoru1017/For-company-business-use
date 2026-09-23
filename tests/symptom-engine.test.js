import { describe, expect, it } from 'vitest';
import { runAnalysis } from '../src/analyze.js';
import { enrichSegments } from '../src/parser.js';
import {
  SYMPTOM_DEFS,
  aggregateSymptoms,
  buildDiagnosisPrompt,
  calendarGrid,
  dateKey,
  extractSymptoms,
  formatDuration,
  funnelFromCalls,
  parseDateFromFilename,
  parseDiagnosis,
  shiftDateKey,
  symptomStreak,
} from '../src/symptom-engine.js';

function dialogue(lines) {
  return enrichSegments(lines.map(([spk, text], i) => ({ start: i * 20, end: i * 20 + 15, text, spk })));
}

/** 業務獨角戲：一開場就推方案、客戶只附和 */
const MONOLOGUE = dialogue([
  ['S', '您好，我是 AI 學院的顧問'],
  ['C', '嗯'],
  ['S', '我們的企業 AI 落地培訓營很適合你，這期名額只剩三個，不學就會被淘汰'],
  ['C', '好'],
  ['S', '課程內容包含很多實作，老師都是業界的，我們的方案可以幫你解決很多問題'],
  ['C', '對'],
  ['S', '那我發連結給你，週三方便嗎'],
  ['C', '再看看'],
]);

/** 有挖到困擾、有收斂、有判斷 */
const DECENT = dialogue([
  ['S', '您好，我是 AI 學院的顧問，請問方便聊嗎？'],
  ['C', '可以，我最近想學 AI，目前在做行銷的工作，平常都在寫文案'],
  ['S', '你現在大概是什麼狀況？最困擾你的地方是什麼？'],
  ['C', '最困擾的是每天要寫十幾篇貼文，常常加班到九點，很卡住'],
  ['S', '如果一直這樣下去，對你影響最大的是什麼？'],
  ['C', '影響最大的是沒時間陪小孩，壓力很大，因為老闆一直加需求'],
  ['S', '為什麼這件事現在對你這麼重要？'],
  ['C', '因為小孩剛上小學，我不想錯過，這是我最在意的'],
  ['S', '所以你真正想解決的是產出速度，因為你想把時間還給家庭，我理解對嗎？'],
  ['C', '對，就是這樣，我想把每天寫文案的時間壓到兩小時以內，其他時間留給家裡'],
  ['S', '依照你的狀況我判斷我們的一對一諮詢適合你，因為它直接針對文案流程'],
  ['C', '聽起來不錯，我之前也看過一些線上課但都沒有針對我的工作流程，這個比較貼近我的需要'],
  ['S', '那我們下一步約週三或週四方便哪個？'],
]);

describe('parseDateFromFilename', () => {
  it('compact YYYYMMDD_HHMMSS with phone number suffix', () => {
    expect(parseDateFromFilename('20260923_143012_0912345678.wav')).toEqual({ date: '2026-09-23', time: '14:30', source: 'filename' });
  });
  it('dashed date with dashed time', () => {
    expect(parseDateFromFilename('2026-09-23 14-30-12.wav').date).toBe('2026-09-23');
    expect(parseDateFromFilename('2026-09-23 14-30-12.wav').time).toBe('14:30');
  });
  it('dotted date with HHMM time and prefix', () => {
    expect(parseDateFromFilename('rec_2026.09.23_1430.wav')).toEqual({ date: '2026-09-23', time: '14:30', source: 'filename' });
  });
  it('phone number before compact datetime', () => {
    expect(parseDateFromFilename('0912345678-20260923143012.wav').date).toBe('2026-09-23');
  });
  it('date only, followed by a phone number', () => {
    expect(parseDateFromFilename('20260923_0912345678.wav')).toEqual({ date: '2026-09-23', time: null, source: 'filename' });
  });
  it('does not treat a phone number as a date; falls back to lastModified', () => {
    const lm = new Date(2026, 8, 21, 9, 5).getTime();
    expect(parseDateFromFilename('0920260923.wav', lm)).toEqual({ date: '2026-09-21', time: '09:05', source: 'modified' });
  });
  it('rejects impossible dates (Feb 31) and falls back', () => {
    const lm = new Date(2026, 0, 2).getTime();
    expect(parseDateFromFilename('20260231.wav', lm).source).toBe('modified');
  });
  it('returns empty when nothing available', () => {
    expect(parseDateFromFilename('call.wav')).toEqual({ date: '', time: null, source: null });
  });
});

describe('date helpers', () => {
  it('dateKey / shiftDateKey are local-date based', () => {
    expect(dateKey(new Date(2026, 8, 23, 23, 59))).toBe('2026-09-23');
    expect(shiftDateKey('2026-10-01', -1)).toBe('2026-09-30');
    expect(shiftDateKey('bad', 1)).toBe('');
  });
  it('calendarGrid returns 42 cells starting on Sunday and flags in-month days', () => {
    const cells = calendarGrid(2026, 9);
    expect(cells).toHaveLength(42);
    expect(cells[0].weekday).toBe(0);
    expect(cells.filter((c) => c.inMonth)).toHaveLength(30);
    expect(cells.find((c) => c.inMonth && c.day === 1).key).toBe('2026-09-01');
  });
  it('formatDuration', () => {
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(0)).toBe('0:00');
  });
});

describe('funnelFromCalls', () => {
  const calls = [{ durationSec: 120 }, { durationSec: 400 }, { durationSec: 1000 }, { durationSec: 0 }];
  it('auto-counts >N min and long calls from durations', () => {
    const f = funnelFromCalls({ dialed: 40, connected: 10, invites: 1 }, calls);
    expect(f.autoOver).toBe(2);
    expect(f.autoLong).toBe(1);
    expect(f.over).toBe(2);
    expect(f.long).toBe(1);
    expect(f.connectRate).toBeCloseTo(0.25);
    expect(f.inviteRate).toBeCloseTo(0.5);
  });
  it('manual counts override auto', () => {
    const f = funnelFromCalls({ dialed: 40, connected: 10, over5Manual: 5, longManual: '2', invites: 2 }, calls);
    expect(f.over).toBe(5);
    expect(f.long).toBe(2);
    expect(f.inviteRate).toBeCloseTo(0.4);
  });
  it('custom thresholds and null ratios when denominator is 0', () => {
    const f = funnelFromCalls({}, calls, { shortMin: 3, longMin: 6 });
    expect(f.autoOver).toBe(2);
    expect(f.autoLong).toBe(2);
    expect(f.connectRate).toBeNull();
  });
});

describe('extractSymptoms', () => {
  it('flags the monologue call with the expected core symptoms', () => {
    const r = runAnalysis(MONOLOGUE);
    const s = extractSymptoms(r, MONOLOGUE);
    expect(s.keys).toEqual(expect.arrayContaining(['talk_too_much', 'short_replies', 'premature_pitch', 'fear_words', 'no_converge', 'stuck_L1', 'step_missing_discovery']));
    expect(s.evidence.fear_words.text).toContain('淘汰');
    expect(s.metrics.firstPitchMin).toBeCloseTo(40 / 60, 1);
    expect(s.metrics.firstTroubleMin).toBeNull();
    s.keys.forEach((k) => expect(SYMPTOM_DEFS[k]).toBeDefined());
  });
  it('does not flag the decent call for the same symptoms and records first-trouble minute', () => {
    const r = runAnalysis(DECENT);
    const s = extractSymptoms(r, DECENT);
    ['talk_too_much', 'short_replies', 'premature_pitch', 'fear_words', 'no_converge', 'stuck_L1', 'step_missing_clarify', 'step_missing_diagnose'].forEach((k) =>
      expect(s.keys).not.toContain(k)
    );
    expect(s.metrics.firstTroubleMin).toBeCloseTo(1, 0);
  });
  it('works without a full analysis result (fallback disclosure levels)', () => {
    const s = extractSymptoms({}, MONOLOGUE);
    expect(s.keys).toContain('stuck_L1');
  });
});

describe('aggregateSymptoms', () => {
  it('counts symptoms across calls, keeps ≤3 evidence quotes and computes common set', () => {
    const mk = (name, segs) => ({ name, symptoms: extractSymptoms(runAnalysis(segs), segs) });
    const agg = aggregateSymptoms([mk('a.wav', MONOLOGUE), mk('b.wav', MONOLOGUE), mk('c.wav', DECENT), { name: 'no-analysis.wav' }]);
    expect(agg.total).toBe(3);
    const fear = agg.symptoms.find((s) => s.key === 'fear_words');
    expect(fear.count).toBe(2);
    expect(fear.ratio).toBeCloseTo(2 / 3);
    expect(fear.evidence).toHaveLength(2);
    expect(fear.evidence[0].call).toBe('a.wav');
    expect(agg.common).toContain('talk_too_much');
    expect(agg.symptoms[0].count).toBeGreaterThanOrEqual(agg.symptoms[agg.symptoms.length - 1].count);
    expect(agg.metrics.troubleReached).toBe(1);
    expect(agg.metrics.avgCustRatio).toBeGreaterThan(0);
  });
  it('empty input', () => {
    const agg = aggregateSymptoms([]);
    expect(agg.total).toBe(0);
    expect(agg.symptoms).toEqual([]);
    expect(agg.metrics.avgCustRatio).toBeNull();
  });
});

describe('symptomStreak', () => {
  it('counts consecutive days ending at endKey', () => {
    const hist = { '2026-09-21': ['talk_too_much'], '2026-09-22': ['talk_too_much', 'fear_words'], '2026-09-23': ['talk_too_much'] };
    expect(symptomStreak(hist, 'talk_too_much', '2026-09-23')).toBe(3);
    expect(symptomStreak(hist, 'fear_words', '2026-09-23')).toBe(0);
    expect(symptomStreak(hist, 'fear_words', '2026-09-22')).toBe(1);
  });
});

describe('diagnosis prompt / parse', () => {
  it('prompt includes funnel, metrics, symptom counts and quotes but no full transcript', () => {
    const s = extractSymptoms(runAnalysis(MONOLOGUE), MONOLOGUE);
    const agg = aggregateSymptoms([{ name: 'a.wav', symptoms: s }]);
    const funnel = funnelFromCalls({ dialed: 30, connected: 8, invites: 1 }, [{ durationSec: 600 }]);
    const p = buildDiagnosisPrompt(agg, { funnel, date: '2026-09-23', recentNotes: [{ date: '2026-09-22', action: '每問一句就閉嘴' }] });
    expect(p).toContain('撥出 30');
    expect(p).toContain('2026-09-23');
    expect(p).toContain('用了恐嚇式用語');
    expect(p).toContain('淘汰');
    expect(p).toContain('每問一句就閉嘴');
    expect(p).toContain('core_symptoms');
    expect(p).not.toContain('那我發連結給你');
  });
  it('parses fenced JSON and truncates to 3 symptoms', () => {
    const raw = '```json\n' + JSON.stringify({
      core_symptoms: [1, 2, 3, 4].map((i) => ({ name: `s${i}`, why: 'w', evidence: 'e', tomorrow_action: 'a' })),
      pattern: 'p',
      one_thing: 'o',
    }) + '\n```';
    const d = parseDiagnosis(raw);
    expect(d.core_symptoms).toHaveLength(3);
    expect(d.core_symptoms[0].name).toBe('s1');
    expect(d.one_thing).toBe('o');
  });
  it('salvages JSON wrapped in prose and rejects garbage', () => {
    expect(parseDiagnosis('好的：{"core_symptoms":[],"pattern":"x","one_thing":"y"} 完')).toEqual({ core_symptoms: [], pattern: 'x', one_thing: 'y' });
    expect(() => parseDiagnosis('not json')).toThrow();
  });
});
