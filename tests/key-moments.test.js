import { describe, expect, it } from 'vitest';
import { detectKeyMoments } from '../src/key-moments.js';
import { enrichSegments } from '../src/parser.js';

describe('key-moments', () => {
  it('marks discovery when sales asks and customer responds substantially', () => {
    const segs = enrichSegments([
      { start: 0, end: 5, text: '現在收入發生什麼問題？', spk: 'S' },
      { start: 5, end: 20, text: '主要是固定薪水，加班很多但收入沒有增加，壓力很大', spk: 'C' },
      { start: 20, end: 25, text: '嗯', spk: 'C' },
    ]);
    const moments = detectKeyMoments(segs);
    expect(moments.length).toBeGreaterThanOrEqual(1);
    expect(moments[0].label).toContain('L2');
    expect(moments[0].customerChars).toBeGreaterThan(10);
  });

  it('detects extended probe patterns from handbook', () => {
    const segs = enrichSegments([
      { start: 0, end: 5, text: '為什麼想增加收入？', spk: 'S' },
      { start: 5, end: 15, text: '因為家裡開銷變大，想要有更多被動收入來源', spk: 'C' },
      { start: 15, end: 20, text: '為什麼是現在？', spk: 'S' },
      { start: 20, end: 30, text: '最近公司裁員，我覺得不能再等了，必須現在開始', spk: 'C' },
      { start: 30, end: 35, text: '他真正想要的生活是什麼？', spk: 'S' },
      { start: 35, end: 45, text: '希望可以有時間陪家人，不用每天加班到很晚', spk: 'C' },
    ]);
    const moments = detectKeyMoments(segs);
    expect(moments.length).toBe(3);
    expect(moments.some((m) => m.label.includes('L4') || m.label.includes('L1'))).toBe(true);
    expect(moments.some((m) => m.label.includes('L5'))).toBe(true);
  });

  it('marks converge and amplification moments', () => {
    const segs = enrichSegments([
      { start: 0, end: 5, text: '所以你真正想解決的是收入問題，我理解對嗎？', spk: 'S' },
      { start: 5, end: 10, text: '對，沒錯，就是這樣', spk: 'C' },
      { start: 10, end: 15, text: '沒有把這段流程改掉，每週就會繼續浪費時間', spk: 'S' },
      { start: 15, end: 18, text: '是喔', spk: 'C' },
    ]);
    const moments = detectKeyMoments(segs);
    expect(moments.some((m) => m.type === 'converge')).toBe(true);
    expect(moments.some((m) => m.type === 'amplify')).toBe(true);
  });

  it('skips short customer replies', () => {
    const segs = enrichSegments([
      { start: 0, end: 5, text: '為什麼是現在？', spk: 'S' },
      { start: 5, end: 8, text: '嗯對', spk: 'C' },
    ]);
    expect(detectKeyMoments(segs)).toHaveLength(0);
  });
});
