import { describe, expect, it } from 'vitest';
import {
  assembleMeetingAudioBlob,
  makeMeetingAudioChunkKey,
  makeMeetingAudioSessionId,
} from '../src/meeting-audio-store.js';

describe('meeting audio continuous storage helpers', () => {
  it('creates stable session and sortable chunk keys', () => {
    expect(makeMeetingAudioSessionId('mt_123', 1000)).toBe('brief_mt_123_rs');
    expect(makeMeetingAudioChunkKey('session', 2)).toBe('session:00000002');
    expect(makeMeetingAudioChunkKey('session', 12) > makeMeetingAudioChunkKey('session', 2)).toBe(true);
  });

  it('assembles persisted chunks in recording order', async () => {
    const blob = assembleMeetingAudioBlob(
      [
        { index: 2, blob: new Blob(['C']) },
        { index: 0, blob: new Blob(['A']) },
        { index: 1, blob: new Blob(['B']) },
      ],
      'audio/webm'
    );
    expect(blob.type).toBe('audio/webm');
    expect(await blob.text()).toBe('ABC');
  });
});
