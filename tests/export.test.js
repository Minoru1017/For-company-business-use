import { describe, expect, it } from 'vitest';
import { runAnalysis } from '../src/analyze.js';
import {
  buildNextCallChecklist,
  buildSummaryMessage,
  exportBaseName,
  extractScripts,
  reportTextToMarkdown,
  segsToSrt,
  srtTimestamp,
} from '../src/export.js';
import { applyBuiltinSpeakerLabels, enrichSegments, parse } from '../src/parser.js';
import { SAMPLE_TRANSCRIPT_SRT } from '../src/sample-transcript.js';

function sampleResult() {
  const segs = parse(SAMPLE_TRANSCRIPT_SRT);
  applyBuiltinSpeakerLabels(segs);
  enrichSegments(segs);
  return { segs, result: runAnalysis(segs) };
}

const date = new Date(2026, 8, 10, 9, 5);

describe('filenames & timestamps', () => {
  it('builds a safe export base name with date', () => {
    expect(exportBaseName('demo call.mp4', date)).toBe('demo call-2026-09-10');
    expect(exportBaseName('transcript.vibe.json', date)).toBe('transcript-2026-09-10');
    expect(exportBaseName('a/b:c*.srt', date)).toBe('a_b_c_-2026-09-10');
    expect(exportBaseName('', date)).toBe('call-2026-09-10');
  });

  it('formats srt timestamps', () => {
    expect(srtTimestamp(0)).toBe('00:00:00,000');
    expect(srtTimestamp(61.25)).toBe('00:01:01,250');
    expect(srtTimestamp(3600 + 59.9995)).toBe('01:00:59,999');
  });
});

describe('segsToSrt', () => {
  it('writes speaker tags that parse back with the same roles', () => {
    const { segs } = sampleResult();
    const srt = segsToSrt(segs);
    expect(srt).toContain('[SPEAKER_00]');
    expect(srt).toContain('[SPEAKER_01]');
    const back = parse(srt);
    applyBuiltinSpeakerLabels(back);
    expect(back.length).toBe(segs.length);
    back.forEach((s, i) => {
      expect(s.spk).toBe(segs[i].spk);
      expect(s.text).toBe(segs[i].text);
    });
  });

  it('flipped labels round-trip too', () => {
    const { segs } = sampleResult();
    segs.forEach((s) => (s.spk = s.spk === 'S' ? 'C' : 'S'));
    const back = parse(segsToSrt(segs));
    applyBuiltinSpeakerLabels(back);
    back.forEach((s, i) => expect(s.spk).toBe(segs[i].spk));
  });
});

describe('summary / checklist / markdown', () => {
  it('extracts unique scripts from suggestion html', () => {
    const q = extractScripts([
      'a <span class="q">「你現在最缺的是什麼？」</span> b',
      '<span class="q">「你現在最缺的是什麼？」</span><span class="q">第二句</span>',
    ]);
    expect(q).toEqual(['你現在最缺的是什麼？', '第二句']);
  });

  it('summary message is short plain text with key numbers', () => {
    const { result } = sampleResult();
    const msg = buildSummaryMessage(result, { source: 'demo.srt', date, aiSummary: '整體節奏好' });
    expect(msg.split('\n')[0]).toContain('【電訪複盤】demo.srt');
    expect(msg).toContain('2026-09-10 09:05');
    expect(msg).toMatch(/客戶說話 \d+%/);
    expect(msg).toMatch(/六步驟 \d\/6/);
    expect(msg).toContain('AI 總評：整體節奏好');
    expect(msg).not.toMatch(/<[a-z]+[ >]/);
    expect(msg.split('\n').length).toBeLessThanOrEqual(12);
  });

  it('checklist lists scripts as checkboxes', () => {
    const { result } = sampleResult();
    const list = buildNextCallChecklist(result, { source: 'demo.srt', date });
    expect(list).toContain('【下一通要問】demo.srt');
    expect(list).toMatch(/☐ 「.+」/);
    expect(list).not.toMatch(/<[a-z]+[ >]/);
  });

  it('checklist falls back when nothing is missing', () => {
    const list = buildNextCallChecklist({ stepHit: {}, layerHits: [], purposeProfile: null, sug: [] }, { date });
    expect(list).toContain('☐ （這通沒有待補的話術');
  });

  it('markdown conversion keeps sections, numbering and checkboxes', () => {
    const { result } = sampleResult();
    const md = reportTextToMarkdown(result.reportText, { source: 'demo.srt', date, summaryMessage: '摘要第一行\n第二行' });
    expect(md.startsWith('# 電訪分析報告\n')).toBe(true);
    expect(md).toContain('- 來源：demo.srt');
    expect(md).toContain('> 摘要第一行\n> 第二行');
    expect(md).toContain('### 通話摘要');
    expect(md).toContain('### 做得好');
    expect(md).toMatch(/- \*\*通話長度\*\*：\d\d:\d\d/);
    expect(md).toMatch(/- \[(x| )\] 1 連結/);
    expect(md).toMatch(/\n1\. /);
    expect(md).not.toContain('═');
    expect(md.endsWith('\n')).toBe(true);
  });

  it('markdown handles the appended AI section', () => {
    const text = `${'═'.repeat(44)}\n  電訪分析報告\n${'═'.repeat(44)}\n\n■ 做得好\n  1. A\n\n${'─'.repeat(44)}\n  AI 深度分析\n${'─'.repeat(44)}\n\n■ 總評\n  很好\n`;
    const md = reportTextToMarkdown(text, { date });
    expect(md).toContain('## AI 深度分析');
    expect(md).toContain('### 總評');
    expect(md).toContain('很好');
  });
});
