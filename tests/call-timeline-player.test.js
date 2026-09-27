import { describe, expect, it } from 'vitest';
import { normalizeMarkers } from '../src/call-timeline-player.js';

describe('call-timeline-player', () => {
  it('normalizes and sorts markers', () => {
    const out = normalizeMarkers(
      [
        { id: 'b', sec: 90, text: 'x' },
        { id: 'a', sec: 10, text: 'y' },
      ],
      120
    );
    expect(out[0].sec).toBe(10);
    expect(out[1].sec).toBe(90);
  });

  it('clamps to duration', () => {
    const out = normalizeMarkers([{ sec: 999 }], 60);
    expect(out[0].sec).toBe(60);
  });
});
