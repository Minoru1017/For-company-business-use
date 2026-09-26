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
  fieldComplete,
  findEntryForSource,
  formatEntryForPrompt,
  getDayJournal,
  isAiAnalysisUnlocked,
  isEntryComplete,
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
});
