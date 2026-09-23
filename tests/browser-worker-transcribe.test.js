import { describe, expect, it } from 'vitest';
import { describeWorkerConnectionFailure } from '../src/browser-worker-transcribe.js';

describe('describeWorkerConnectionFailure', () => {
  it('explains mixed-content blocking when an https page targets an http worker', () => {
    const msg = describeWorkerConnectionFailure('http://100.126.54.41:8766', 'https:');
    expect(msg).toContain('混合內容');
    expect(msg).toContain('不安全的內容');
    expect(msg).toContain('Tunnel');
  });

  it('treats a bare host as http and still warns on https pages', () => {
    expect(describeWorkerConnectionFailure('100.126.54.41:8766', 'https:')).toContain('混合內容');
  });

  it('gives generic connectivity checks otherwise', () => {
    const msg = describeWorkerConnectionFailure('https://worker.example.com', 'https:');
    expect(msg).not.toContain('混合內容');
    expect(msg).toContain('8766');
    expect(describeWorkerConnectionFailure('http://100.1.2.3:8766', 'http:')).toContain('Tailscale');
  });
});
