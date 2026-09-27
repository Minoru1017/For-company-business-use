import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  LEARNING_STORAGE_KEY,
  addLearningEntry,
  fieldOk,
  hasLearningForDate,
  isLearningEntryComplete,
  listLearningEntries,
} from '../src/learning-library.js';

function mockLocalStorage() {
  const store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
}

const fill = (n) => '這是一段足夠長的學習心得文字內容'.repeat(Math.ceil(n / 12));

describe('learning-library', () => {
  beforeEach(() => {
    mockLocalStorage();
    localStorage.removeItem(LEARNING_STORAGE_KEY);
  });

  it('validates complete entry', () => {
    expect(fieldOk('短')).toBe(false);
    const e = {
      videoTitle: 'AI 銷售',
      aiTakeaway: fill(20),
      salesTakeaway: fill(20),
      learnedSummary: fill(20),
    };
    expect(isLearningEntryComplete(e)).toBe(true);
  });

  it('stores entry and detects today', () => {
    addLearningEntry({
      dateKey: '2026-09-27',
      videoUrl: 'https://example.com/watch?v=1',
      videoTitle: 'test',
      aiTakeaway: fill(20),
      salesTakeaway: fill(20),
      learnedSummary: fill(20),
    });
    expect(listLearningEntries()).toHaveLength(1);
    expect(hasLearningForDate('2026-09-27')).toBe(true);
    expect(hasLearningForDate('2026-09-26')).toBe(false);
  });
});
