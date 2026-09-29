import { describe, expect, it } from 'vitest';
import { PLAYBACK_RATES, formatRate, normalizeMarkers, normalizeRate, stepRate } from '../src/call-timeline-player.js';

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

describe('playback rate', () => {
  it('offers 1 / 1.25 / 1.5 / 1.75 / 2', () => {
    expect(PLAYBACK_RATES).toEqual([1, 1.25, 1.5, 1.75, 2]);
  });

  it('formats rates compactly', () => {
    expect(formatRate(1)).toBe('1×');
    expect(formatRate(1.25)).toBe('1.25×');
    expect(formatRate(1.5)).toBe('1.5×');
    expect(formatRate(2)).toBe('2×');
  });

  it('normalizes unknown / stored values back to 1', () => {
    expect(normalizeRate('1.5')).toBe(1.5);
    expect(normalizeRate('3')).toBe(1);
    expect(normalizeRate(null)).toBe(1);
    expect(normalizeRate('abc')).toBe(1);
  });

  it('steps through the list and clamps at both ends', () => {
    expect(stepRate(1, 1)).toBe(1.25);
    expect(stepRate(1.25, 1)).toBe(1.5);
    expect(stepRate(1.75, 1)).toBe(2);
    expect(stepRate(2, 1)).toBe(2);
    expect(stepRate(1, -1)).toBe(1);
    expect(stepRate(1.5, -1)).toBe(1.25);
    expect(stepRate('weird', 1)).toBe(1.25);
  });
});
