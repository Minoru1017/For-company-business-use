import { describe, expect, it } from 'vitest';
import { appendAIReportSection, formatReportText } from '../src/report-format.js';
import { RULES } from '../src/rules.js';
import { fmt } from '../src/utils.js';

describe('report-format', () => {
  it('formats report with section breaks and numbered bullets', () => {
    const text = formatReportText({
      stats: { totalDur: 125, custRatio: 0.4, sQuestions: 3, sCount: 5, cCount: 4 },
      stepHit: { open: true, explore: false },
      deepest: 2,
      convergeSeg: null,
      purposeProfile: { dominant: { label: '要什麼' } },
      manualChecks: {
        discovery: { statusLabel: '通過' },
        amplification: { statusLabel: '待加強' },
      },
      good: ['<b>做得好</b>'],
      bad: ['待改進'],
      sug: ['建議一句'],
      fmt,
      RULES,
    });
    expect(text).toContain('電訪分析報告');
    expect(text).toContain('■ 通話摘要');
    expect(text).toContain('1. 做得好');
    expect(text).not.toContain('｜業務提問');
  });

  it('appends AI section with line breaks', () => {
    const out = appendAIReportSection('BASE', {
      summary: '總評文字',
      good: [{ point: 'A' }],
      bad: [{ point: 'B', rule: '規則' }],
      suggest: [{ say: 'C' }],
    });
    expect(out).toContain('BASE');
    expect(out).toContain('AI 深度分析');
    expect(out).toContain('1. A');
    expect(out).toContain('（規則）');
  });
});
