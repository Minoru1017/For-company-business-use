import { describe, expect, it, beforeEach, vi } from 'vitest';

function mockLocalStorage() {
  const store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
}
import {
  JOURNAL_STORAGE_KEY,
  appendReflectionToPrompt,
  countCompleteEntries,
  entryHasContent,
  fieldComplete,
  findEntryForSource,
  formatEntryForPrompt,
  getDayJournal,
  isAiAnalysisUnlocked,
  isEntryComplete,
  journalTrajectoryStats,
  listJournalDays,
  saveDayJournal,
  unlockStatusMessage,
} from '../src/reflection-journal.js';

const fill = (n) => '這是一段足夠長的自寫複盤內容'.repeat(Math.ceil(n / 10));

describe('reflection-journal', () => {
  beforeEach(() => {
    mockLocalStorage();
    localStorage.removeItem(JOURNAL_STORAGE_KEY);
  });

  it('requires four fields per entry', () => {
    expect(fieldComplete('短')).toBe(false);
    expect(fieldComplete(fill(12))).toBe(true);
    const e = { iDid: fill(12), customerSaid: fill(12), toneEffect: fill(12), customerMind: fill(12) };
    expect(isEntryComplete(e)).toBe(true);
  });

  it('unlocks after three complete entries', () => {
    expect(isAiAnalysisUnlocked()).toBe(false);
    const entries = [0, 1, 2].map((slot) => ({
      slot,
      callTitle: `通話${slot}`,
      linkedSource: '',
      iDid: fill(20),
      customerSaid: fill(20),
      toneEffect: fill(20),
      customerMind: fill(20),
    }));
    saveDayJournal(getDayJournal().dateKey, entries);
    expect(countCompleteEntries(getDayJournal())).toBe(3);
    expect(isAiAnalysisUnlocked()).toBe(true);
    expect(unlockStatusMessage().unlocked).toBe(true);
  });

  it('finds entry by linked source', () => {
    const entries = [
      {
        slot: 0,
        callTitle: '黃烱桐',
        linkedSource: '20250925-黃烱桐.wav',
        iDid: fill(15),
        customerSaid: fill(15),
        toneEffect: fill(15),
        customerMind: fill(15),
      },
    ];
    saveDayJournal(getDayJournal().dateKey, entries);
    const day = getDayJournal();
    const hit = findEntryForSource(day, '20250925-黃烱桐.wav');
    expect(hit?.callTitle).toBe('黃烱桐');
    expect(formatEntryForPrompt(hit)).toContain('我做了什麼');
  });

  it('appends crosscheck instruction when reflection provided', () => {
    const out = appendReflectionToPrompt('BASE', '通話：test\n1. 我做了');
    expect(out).toContain('reflection_crosscheck');
    expect(out).toContain('通話：test');
    expect(appendReflectionToPrompt('BASE', '')).toBe('BASE');
  });

  it('lists every written day newest first and omits blank saved days', () => {
    const complete = {
      callTitle: '客戶 A',
      iDid: fill(15),
      customerSaid: fill(15),
      toneEffect: fill(15),
      customerMind: fill(15),
    };
    saveDayJournal('2026-09-27', [{ ...complete, slot: 0 }]);
    saveDayJournal('2026-09-29', [
      { ...complete, slot: 0, callTitle: '客戶 B' },
      { slot: 1, callTitle: '客戶 C', iDid: '還沒寫完' },
    ]);
    saveDayJournal('2026-09-28', [{ slot: 0 }]);

    const days = listJournalDays();
    expect(days.map((d) => d.dateKey)).toEqual(['2026-09-29', '2026-09-27']);
    expect(days[0].entries.filter(entryHasContent)).toHaveLength(2);
    expect(days[1].entries.filter(isEntryComplete)).toHaveLength(1);
  });

  it('summarizes learning days, written calls, complete calls and recent streak', () => {
    const complete = {
      callTitle: '一通',
      iDid: fill(15),
      customerSaid: fill(15),
      toneEffect: fill(15),
      customerMind: fill(15),
    };
    saveDayJournal('2026-09-26', [{ ...complete, slot: 0 }]);
    saveDayJournal('2026-09-28', [{ ...complete, slot: 0 }]);
    saveDayJournal('2026-09-29', [
      { ...complete, slot: 0 },
      { slot: 1, callTitle: '未完成', iDid: '今天我打了一通電話' },
    ]);

    expect(journalTrajectoryStats()).toEqual({
      days: 3,
      writtenEntries: 4,
      completeEntries: 3,
      recentStreak: 2,
      latestDate: '2026-09-29',
    });
  });

  it('returns a zero trajectory when storage is empty', () => {
    expect(journalTrajectoryStats()).toEqual({
      days: 0,
      writtenEntries: 0,
      completeEntries: 0,
      recentStreak: 0,
      latestDate: '',
    });
  });
});
