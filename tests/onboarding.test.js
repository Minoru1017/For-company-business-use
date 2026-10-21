import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_KEY,
  TOURS,
  isTourDone,
  loadTourState,
  markTourDone,
  placeCard,
  resetTours,
  resolveStep,
} from '../src/onboarding.js';

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

const VIEW = { width: 1280, height: 800 };
const CARD = { width: 360, height: 220 };

describe('onboarding tour state', () => {
  it('remembers each tour separately and can be reset', () => {
    const s = memoryStorage();
    expect(isTourDone('home', s)).toBe(false);
    markTourDone('home', s);
    expect(isTourDone('home', s)).toBe(true);
    expect(isTourDone('workspace', s)).toBe(false);
    markTourDone('workspace', s);
    expect(Object.keys(loadTourState(s)).sort()).toEqual(['home', 'workspace']);
    resetTours(s);
    expect(isTourDone('home', s)).toBe(false);
  });

  it('treats corrupt or missing storage as never seen', () => {
    expect(loadTourState(memoryStorage({ [ONBOARDING_KEY]: '{oops' }))).toEqual({});
    expect(loadTourState(memoryStorage({ [ONBOARDING_KEY]: '[1]' }))).toEqual({});
    expect(isTourDone('home', null)).toBe(false);
  });
});

describe('onboarding steps', () => {
  it('every step has a unique id, a title and a body', () => {
    Object.values(TOURS).forEach((steps) => {
      expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
      steps.forEach((step) => {
        const r = resolveStep(step, 'log');
        expect(r.title.length).toBeGreaterThan(1);
        expect(r.body.length).toBeGreaterThan(10);
      });
    });
  });

  it('opens with a centred welcome and ends on the replay button', () => {
    expect(TOURS.home[0].target).toBeUndefined();
    expect(TOURS.home.at(-1).target).toBe('#onboardingHomeBtn');
    expect(TOURS.workspace.at(-1).target).toBe('#onboardingSidebarBtn');
  });

  it('tailors the workspace steps to the current mode', () => {
    const sections = TOURS.workspace.find((s) => s.id === 'sections');
    expect(resolveStep(sections, 'drill').target).toBe('#drillSection .sec-head');
    const tip = TOURS.workspace.find((s) => s.id === 'mode-tip');
    expect(resolveStep(tip, 'log').body).toContain('心智圖');
    expect(resolveStep(tip, 'deck').body).toContain('PPTX');
    expect(resolveStep(tip, 'nope').body).toBe(resolveStep(tip, 'dev').body);
  });
});

describe('placeCard', () => {
  it('centres the card when there is no target', () => {
    expect(placeCard(null, CARD, VIEW)).toEqual({ side: 'center', top: 290, left: 460 });
  });

  it('prefers below, then above, then right, then left', () => {
    expect(placeCard({ top: 100, left: 400, width: 200, height: 40 }, CARD, VIEW)).toMatchObject({ side: 'bottom', top: 154, left: 320 });
    expect(placeCard({ top: 600, left: 400, width: 200, height: 40 }, CARD, VIEW)).toMatchObject({ side: 'top', top: 366 });
    expect(placeCard({ top: 100, left: 20, width: 240, height: 640 }, CARD, VIEW)).toMatchObject({ side: 'right', left: 274 });
    expect(placeCard({ top: 100, left: 900, width: 360, height: 640 }, CARD, VIEW)).toMatchObject({ side: 'left', left: 526 });
  });

  it('keeps the card inside the viewport near the edges', () => {
    const p = placeCard({ top: 20, left: 1200, width: 60, height: 30 }, CARD, VIEW);
    expect(p.side).toBe('bottom');
    expect(p.left).toBe(VIEW.width - CARD.width - 12);
  });

  it('falls back to the bottom edge when the target fills the screen', () => {
    expect(placeCard({ top: 0, left: 0, width: 1280, height: 800 }, CARD, VIEW)).toMatchObject({ side: 'inside', top: 568 });
  });
});
