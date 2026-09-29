import { beforeEach, describe, expect, it, vi } from 'vitest';

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

let mn;

beforeEach(async () => {
  globalThis.localStorage = memoryStorage();
  vi.resetModules();
  mn = await import('../src/meeting-notes.js');
});

const SAMPLE = `那今天早會就講幾件事。
第一，從今天開始每個人每天至少打三十通，接通率我們要看。
然後開場不要一上來就介紹產品，先問客戶「最近在忙什麼」。
嗯對，業績是做出來的，不是聽出來的。
還有記得不要在電話裡承諾折扣。
好，就這樣。`;

describe('meeting-notes: sentence split & extraction', () => {
  it('splits sentences and strips filler prefixes / short fragments', () => {
    const s = mn.splitSentences(SAMPLE);
    expect(s.some((x) => x.startsWith('那今天'))).toBe(false);
    expect(s.some((x) => x.includes('早會就講幾件事'))).toBe(true);
    expect(s).not.toContain('好，就這樣。');
    expect(s.every((x) => x.length >= 6)).toBe(true);
  });

  it('classifies by KPI / script / remind / value', () => {
    expect(mn.classifyPoint('每個人每天至少打三十通')).toBe('kpi');
    expect(mn.classifyPoint('先問客戶「最近在忙什麼」')).toBe('script');
    expect(mn.classifyPoint('記得不要在電話裡承諾折扣')).toBe('remind');
    expect(mn.classifyPoint('業績是做出來的，不是聽出來的')).toBe('value');
    expect(mn.classifyPoint('明天早上照流程跑一遍')).toBe('process');
  });

  it('extracts directive-like key points in transcript order, skipping chatter', () => {
    const pts = mn.extractKeyPoints(SAMPLE);
    const texts = pts.map((p) => p.text);
    expect(texts.some((t) => t.includes('三十通'))).toBe(true);
    expect(texts.some((t) => t.includes('最近在忙什麼'))).toBe(true);
    expect(texts.some((t) => t.includes('承諾折扣'))).toBe(true);
    expect(texts.some((t) => t.includes('就這樣'))).toBe(false);
    const kpiIdx = texts.findIndex((t) => t.includes('三十通'));
    const remindIdx = texts.findIndex((t) => t.includes('承諾折扣'));
    expect(kpiIdx).toBeLessThan(remindIdx);
    expect(pts.every((p) => p.source === 'rule' && p.category)).toBe(true);
  });

  it('respects max and dedups near-identical sentences', () => {
    const dup = '每天至少打三十通。每天至少要打三十通！每天至少打三十通。';
    expect(mn.extractKeyPoints(dup, { max: 5 })).toHaveLength(1);
    expect(mn.extractKeyPoints(SAMPLE, { max: 2 })).toHaveLength(2);
  });

  it('returns empty for empty input', () => {
    expect(mn.extractKeyPoints('')).toEqual([]);
    expect(mn.splitSentences(null)).toEqual([]);
  });
});

describe('meeting-notes: AI prompt / parse', () => {
  it('builds a prompt containing the transcript and JSON contract', () => {
    const p = mn.buildMeetingSummaryPrompt('主管說要多打電話', { date: '2026-09-29' });
    expect(p).toContain('2026-09-29');
    expect(p).toContain('主管說要多打電話');
    expect(p).toContain('"points"');
    expect(p).toContain('value|process|kpi|script|remind');
  });

  it('parses fenced JSON and normalizes categories', () => {
    const raw = '```json\n{"theme":"多打多聽","points":[{"text":"每天 30 通","category":"kpi","action":"上午先打 15 通"},{"text":"不要先報價","category":"weird"}]}\n```';
    const out = mn.parseMeetingSummary(raw);
    expect(out.theme).toBe('多打多聽');
    expect(out.points).toHaveLength(2);
    expect(out.points[0]).toMatchObject({ text: '每天 30 通', category: 'kpi', action: '上午先打 15 通', source: 'ai', selected: true });
    expect(out.points[1].category).toBe('process');
  });

  it('drops empty points and throws on garbage', () => {
    expect(mn.parseMeetingSummary({ points: [{ text: '' }, { text: 'ok 的點' }] }).points).toHaveLength(1);
    expect(() => mn.parseMeetingSummary('not json')).toThrow();
  });
});

describe('meeting-notes: storage', () => {
  it('saves, lists newest first, updates in place and deletes', () => {
    const a = mn.saveMeeting({ title: 'A', startedAt: 1000, lines: [{ t: 1, text: 'x' }], transcript: 'x' });
    const b = mn.saveMeeting({ title: 'B', startedAt: 2000 });
    expect(mn.listMeetings().map((m) => m.id)).toEqual([b.id, a.id]);

    const a2 = mn.saveMeeting({ ...a, transcript: 'x y' });
    expect(a2.id).toBe(a.id);
    expect(mn.listMeetings()).toHaveLength(2);
    expect(mn.getMeeting(a.id).transcript).toBe('x y');

    mn.deleteMeeting(b.id);
    expect(mn.listMeetings().map((m) => m.id)).toEqual([a.id]);
  });

  it('defaults title and normalizes points', () => {
    const m = mn.saveMeeting({ startedAt: new Date(2026, 8, 29, 9).getTime(), points: [{ text: ' 重點 ', category: 'nope' }, { text: '' }] });
    expect(m.title).toBe('9/29 主管早會');
    expect(m.points).toHaveLength(1);
    expect(m.points[0]).toMatchObject({ text: '重點', category: 'process', selected: true });
  });

  it('caps stored meetings at MEETING_LIMIT', () => {
    for (let i = 0; i < mn.MEETING_LIMIT + 5; i++) mn.saveMeeting({ title: `m${i}`, startedAt: i });
    expect(mn.listMeetings()).toHaveLength(mn.MEETING_LIMIT);
  });

  it('formats clock and joins lines', () => {
    expect(mn.formatClock(65)).toBe('01:05');
    expect(mn.formatClock(-3)).toBe('00:00');
    expect(mn.linesToTranscript([{ text: ' a ' }, { text: '' }, { text: 'b' }])).toBe('a\nb');
  });
});
