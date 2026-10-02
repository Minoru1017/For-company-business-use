import { describe, expect, it } from 'vitest';
import { normalizeCallSourceStem } from '../src/symptom-store.js';

describe('symptom-store source matching', () => {
  it('matches transcript and audio names by filename stem', () => {
    expect(normalizeCallSourceStem('C:\\錄音\\0922-客戶.wav')).toBe('0922-客戶');
    expect(normalizeCallSourceStem('/tmp/0922-客戶.srt')).toBe('0922-客戶');
  });
});
