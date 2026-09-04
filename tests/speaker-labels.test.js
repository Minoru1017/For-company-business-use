import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assignSpeakerRoles, labeledRatio, parseSpeakerLine, splitCueBody } from '../src/speaker-labels.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('speaker-labels', () => {
  it('parseSpeakerLine supports 發言者 and optional colon', () => {
    expect(parseSpeakerLine('發言者 1：您好')).toEqual({ id: 1, rest: '您好' });
    expect(parseSpeakerLine('Speaker 2 對')).toEqual({ id: 2, rest: '對' });
  });

  it('parseSpeakerLine supports WhisperX [SPEAKER_00] format', () => {
    expect(parseSpeakerLine('[SPEAKER_00] 您好')).toEqual({ id: 0, rest: '您好' });
    expect(parseSpeakerLine('[SPEAKER_01]: 你好')).toEqual({ id: 1, rest: '你好' });
    expect(parseSpeakerLine('SPEAKER_02 請說')).toEqual({ id: 2, rest: '請說' });
  });

  it('splitCueBody handles speaker on separate line', () => {
    expect(splitCueBody('Speaker 1\n您好，請問是王先生嗎？')).toEqual({
      speakerId: 1,
      text: '您好，請問是王先生嗎？',
    });
  });

  it('assignSpeakerRoles maps lowest id to S', () => {
    const segs = [{ speakerId: 1 }, { speakerId: 2 }, { speakerId: 1 }];
    assignSpeakerRoles(segs);
    expect(segs[0].spk).toBe('S');
    expect(segs[1].spk).toBe('C');
    expect(segs[0].labeled).toBe(true);
  });

  it('labeledRatio counts labeled segments', () => {
    expect(labeledRatio([{ labeled: true }, {}, { labeled: true }])).toBeCloseTo(2 / 3);
  });
});
