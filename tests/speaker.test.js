import { describe, expect, it } from 'vitest';
import { autoGuess, isQuestion } from '../src/speaker.js';

describe('speaker', () => {
  it('detects questions', () => {
    expect(isQuestion('方便聊幾分鐘嗎？')).toBe(true);
    expect(isQuestion('好的')).toBe(false);
  });

  it('autoGuess assigns sales-like lines to S', () => {
    const segs = [{ text: '請問方便聊一下嗎？' }, { text: '嗯' }];
    autoGuess(segs);
    expect(segs[0].spk).toBe('S');
  });
});
