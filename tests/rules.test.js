import { describe, expect, it } from 'vitest';
import { runAnalysis } from '../src/analyze.js';
import { enrichSegments } from '../src/parser.js';

describe('rules analysis', () => {
  it('produces report sections for a minimal call', () => {
    const segs = enrichSegments([
      { start: 0, end: 5, text: '您好，我是顧問，請問方便聊嗎？', spk: 'S', chars: 10 },
      { start: 5, end: 10, text: '可以，我最近想學 AI', spk: 'C', chars: 8 },
      { start: 10, end: 20, text: '你現在大概是什麼狀況？', spk: 'S', chars: 8 },
      { start: 20, end: 30, text: '工作很忙，想提升效率', spk: 'C', chars: 8 },
    ]);
    const result = runAnalysis(segs);
    expect(result.good.length + result.bad.length + result.sug.length).toBeGreaterThan(0);
    expect(result.reportText).toContain('電訪分析報告');
    expect(result.stats.sQuestions).toBeGreaterThanOrEqual(1);
    expect(result.manualChecks.discovery).toBeTruthy();
    expect(result.manualChecks.amplification).toBeTruthy();
    expect(result.purposeProfile).toBeTruthy();
  });

  it('escapes transcript text in converge hint', () => {
    const xss = '<script>alert(1)</script>';
    const segs = enrichSegments([
      { start: 0, end: 5, text: `所以你真正需要的是${xss}，我理解對嗎？`, spk: 'S', chars: 10 },
      { start: 5, end: 10, text: '對', spk: 'C', chars: 1 },
      { start: 10, end: 15, text: '請問方便嗎？', spk: 'S', chars: 5 },
      { start: 15, end: 20, text: '想了解狀況', spk: 'S', chars: 5 },
    ]);
    const result = runAnalysis(segs);
    expect(result.convergeHint).toContain('&lt;script&gt;');
    expect(result.convergeHint).not.toContain('<script>');
  });
});
