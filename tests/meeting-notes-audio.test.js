import { describe, expect, it } from 'vitest';
import {
  audioFileExtension,
  buildMicrophoneConstraints,
  detectProcessingPreset,
  measureAudioLevel,
  processingForPreset,
  describeMicrophoneAccessError,
  describeSpeechError,
  pickRecorderMime,
  shouldSampleAudioLevel,
} from '../src/meeting-notes-audio.js';

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

  it('can select an exact input device and preserve speaker audio', () => {
    expect(buildMicrophoneConstraints({ deviceId: 'usb-mic' })).toMatchObject({
      deviceId: { exact: 'usb-mic' },
      echoCancellation: true,
      noiseSuppression: true,
    });
    expect(buildMicrophoneConstraints({ preserveSpeakerAudio: true })).toMatchObject({
      echoCancellation: false,
      noiseSuppression: false,
    });
  });

  it('allows each browser audio-processing constraint to be adjusted independently', () => {
    expect(
      buildMicrophoneConstraints({
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
      })
    ).toMatchObject({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true,
    });
    expect(buildMicrophoneConstraints({ autoGainControl: false }).autoGainControl).toBe(false);
  });

  it('keeps sampling while MediaRecorder is recording even before the UI flag changes', () => {
    expect(shouldSampleAudioLevel({ recorderState: 'recording', paused: false })).toBe(true);
    expect(shouldSampleAudioLevel({ recorderState: 'paused', paused: false })).toBe(false);
    expect(shouldSampleAudioLevel({ recorderState: 'recording', paused: true })).toBe(false);
  });
});

describe('meeting-notes audio processing', () => {
  it('maps presets to processing options and back', () => {
    expect(processingForPreset('distant')).toEqual({ echoCancellation: false, noiseSuppression: false, autoGainControl: true });
    expect(processingForPreset('raw')).toEqual({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
    expect(processingForPreset('standard')).toEqual({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
    expect(processingForPreset('anything')).toEqual(processingForPreset('standard'));
    for (const preset of ['standard', 'distant', 'raw']) {
      expect(detectProcessingPreset(processingForPreset(preset))).toBe(preset);
    }
    expect(detectProcessingPreset({ echoCancellation: true, noiseSuppression: false, autoGainControl: true })).toBe('custom');
  });

  it('measures audio level from time-domain samples', () => {
    const silent = measureAudioLevel(new Uint8Array(512).fill(128));
    expect(silent).toEqual({ rms: 0, pct: 0, hasSignal: false });
    const loud = measureAudioLevel(Uint8Array.from({ length: 512 }, (_, i) => (i % 2 ? 160 : 96)));
    expect(loud.rms).toBeCloseTo(0.25, 5);
    expect(loud.pct).toBe(100);
    expect(loud.hasSignal).toBe(true);
    const faint = measureAudioLevel(Uint8Array.from({ length: 512 }, (_, i) => (i % 2 ? 129 : 127)));
    expect(faint.hasSignal).toBe(false);
    expect(faint.pct).toBe(3);
    expect(measureAudioLevel(new Uint8Array(0)).rms).toBe(0);
  });

  it('picks a download extension from the recorder mime', () => {
    expect(audioFileExtension('audio/mp4')).toBe('m4a');
    expect(audioFileExtension('audio/ogg;codecs=opus')).toBe('ogg');
    expect(audioFileExtension('audio/webm;codecs=opus')).toBe('webm');
    expect(audioFileExtension('')).toBe('webm');
  });
});
