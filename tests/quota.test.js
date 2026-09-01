import { describe, expect, it } from 'vitest';
import { bumpUsage, checkQuotaBefore, getLimit, getUsage, quotaPercent } from '../src/quota.js';

class MemoryStorage {
  constructor() {
    this.store = {};
  }
  getItem(k) {
    return this.store[k] ?? null;
  }
  setItem(k, v) {
    this.store[k] = v;
  }
  removeItem(k) {
    delete this.store[k];
  }
}

describe('quota', () => {
  it('resets usage on new day', () => {
    const storage = new MemoryStorage();
    storage.setItem('gemini_usage', JSON.stringify({ date: '2000-01-01', count: 9, tokens: 100 }));
    const u = getUsage(storage);
    expect(u.count).toBe(0);
  });

  it('bumps usage counters', () => {
    const storage = new MemoryStorage();
    const u = bumpUsage(500, storage);
    expect(u.count).toBe(1);
    expect(u.tokens).toBe(500);
  });

  it('blocks when limit reached', () => {
    expect(checkQuotaBefore(250, 250).ok).toBe(false);
    expect(checkQuotaBefore(200, 250).level).toBe('warn');
    expect(quotaPercent(125, 250)).toBe(50);
    expect(getLimit(10, new MemoryStorage())).toBe(10);
  });
});
