import { describe, expect, it } from 'vitest';
import { describeMicrophoneAccessError, describeSpeechError, pickRecorderMime } from '../src/meeting-notes-ui.js';

describe('meeting-notes microphone errors', () => {
  it('gives actionable Web Speech error messages', () => {
    expect(describeSpeechError('not-allowed')).toContain('網址列');
    expect(describeSpeechError('audio-capture')).toContain('Windows');
    expect(describeSpeechError('network')).toContain('網路');
    expect(describeSpeechError('no-speech')).toContain('沒有偵測到聲音');
    expect(describeSpeechError('language-not-supported')).toContain('Chrome');
  });

  it('explains insecure context before browser permission', () => {
    expect(describeMicrophoneAccessError(new Error('x'), { secureContext: false })).toContain('https://');
  });

  it('maps media-device permission and hardware errors', () => {
    expect(describeMicrophoneAccessError({ name: 'NotAllowedError' })).toContain('麥克風權限被封鎖');
    expect(describeMicrophoneAccessError({ name: 'NotFoundError' })).toContain('找不到可用的麥克風');
    expect(describeMicrophoneAccessError({ name: 'NotReadableError' })).toContain('其他程式占用');
    expect(describeMicrophoneAccessError({ name: 'OverconstrainedError' })).toContain('其他輸入裝置');
  });

  it('keeps an unknown browser error visible', () => {
    expect(describeMicrophoneAccessError({ name: 'UnknownError', message: 'device exploded' })).toContain(
      'device exploded'
    );
  });

  it('selects the best MediaRecorder format supported by the browser', () => {
    const supported = new Set(['audio/webm', 'audio/ogg;codecs=opus']);
    expect(pickRecorderMime((type) => supported.has(type))).toBe('audio/webm');
    expect(pickRecorderMime(() => false)).toBe('');
  });
});
