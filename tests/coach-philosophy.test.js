import { describe, expect, it } from 'vitest';
import {
  COACH_CYCLE,
  MODE_ROLES,
  monthPaceMessage,
  renderCycleHtml,
  renderHomePhilosophyHtml,
} from '../src/coach-philosophy.js';

describe('coach-philosophy', () => {
  it('defines four-step cycle and six modes', () => {
    expect(COACH_CYCLE).toHaveLength(4);
    expect(Object.keys(MODE_ROLES).sort()).toEqual(['brief', 'deck', 'demo', 'dev', 'drill', 'log']);
  });

  it('month pace by day of month', () => {
    expect(monthPaceMessage(new Date(2026, 8, 5)).tone).toBe('ok');
    expect(monthPaceMessage(new Date(2026, 8, 15)).tone).toBe('neutral');
    expect(monthPaceMessage(new Date(2026, 8, 28)).tone).toBe('warn');
  });

  it('renders cycle html', () => {
    expect(renderCycleHtml()).toContain('coach-cycle');
    expect(renderHomePhilosophyHtml()).toContain('業績是做出來的');
  });
});
