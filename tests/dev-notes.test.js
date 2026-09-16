import { describe, expect, it } from 'vitest';
import {
  buildDevNotesLocal,
  formatDevNotesText,
  mergeSpeakerRuns,
  parseDevNotesAI,
  devNotesFromAI,
} from '../src/dev-notes.js';

describe('dev-notes', () => {
  const sampleSegs = [
    { spk: 'S', start: 31, end: 40, text: '請問您目前的工作性質大概是什麼？', chars: 16 },
    { spk: 'C', start: 43, end: 48, text: '裝修', chars: 2 },
    { spk: 'S', start: 52, end: 58, text: '那您點廣告是想了解哪方面呢？', chars: 14 },
    { spk: 'C', start: 59, end: 62, text: '都有', chars: 2 },
    { spk: 'C', start: 150, end: 155, text: '可以呀', chars: 3 },
  ];

  it('merges consecutive same-speaker runs', () => {
    const segs = [
      { spk: 'S', start: 0, end: 2, text: 'a', chars: 1 },
      { spk: 'S', start: 2.5, end: 5, text: 'b', chars: 1 },
      { spk: 'C', start: 6, end: 8, text: 'c', chars: 1 },
    ];
    const runs = mergeSpeakerRuns(segs.map((s, i) => ({ ...s, _idx: i })));
    expect(runs).toHaveLength(2);
    expect(runs[0].text).toBe('a b');
  });

  it('builds local timeline with role timestamps', () => {
    const notes = buildDevNotesLocal(sampleSegs);
    const text = formatDevNotesText(notes);
    expect(text).toMatch(/業務\[00:31\]/);
    expect(text).toMatch(/客戶\[00:43\].*裝修/);
    expect(text).toContain('【客戶語調變化】');
  });

  it('parses AI JSON into notes', () => {
    const raw = JSON.stringify({
      agent_name: '潘秉鈞',
      timeline: [{ role: '業務', start_mmss: '00:31', end_mmss: null, summary: '問工作性質' }],
      atmosphere: [],
      tone_shifts: [],
    });
    const notes = devNotesFromAI(parseDevNotesAI(raw));
    expect(notes.agentName).toBe('潘秉鈞');
    expect(formatDevNotesText(notes)).toContain('潘秉鈞');
    expect(formatDevNotesText(notes)).toContain('問工作性質');
  });
});
