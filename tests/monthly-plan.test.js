import { describe, expect, it } from 'vitest';
import {
  PLAN_CHECKPOINTS,
  checkpointDateKey,
  computeCheckpointActuals,
  emptyMonthlyPlan,
  evaluateCheckpoint,
  getMonthlyPlanFromSettings,
  latestDueCheckpoint,
  managerDiscussionReadiness,
  patchMonthlyPlans,
  targetSequenceWarnings,
} from '../src/monthly-plan.js';

describe('monthly-plan', () => {
  it('uses the 5 / 10 / 15 / 20 / month-end checkpoints', () => {
    expect(PLAN_CHECKPOINTS.map((c) => c.id)).toEqual(['d05', 'd10', 'd15', 'd20', 'end']);
    expect(checkpointDateKey(2026, 10, PLAN_CHECKPOINTS[0])).toBe('2026-10-05');
    expect(checkpointDateKey(2026, 2, PLAN_CHECKPOINTS.at(-1))).toBe('2026-02-28');
  });

  it('persists and normalizes a plan in settings', () => {
    const plan = emptyMonthlyPlan();
    plan.targets.d05.calls = 30.9;
    plan.targets.end.contracts = 3;
    plan.adjustments.d05 = '回聽三通';
    const bag = patchMonthlyPlans({}, 2026, 10, plan);
    const out = getMonthlyPlanFromSettings({ monthlyPlans: bag }, 2026, 10);
    expect(out.targets.d05.calls).toBe(30);
    expect(out.targets.end.contracts).toBe(3);
    expect(out.adjustments.d05).toBe('回聽三通');
  });

  it('calculates cumulative actuals from daily funnel data', () => {
    const days = [
      { date: '2026-10-03', dialed: 20, invites: 1, demos: 1, contracts: 0 },
      { date: '2026-10-05', dialed: 30, invites: 2, demos: 0, contracts: 1 },
      { date: '2026-10-07', dialed: 10, invites: 1, demos: 1, contracts: 0 },
      { date: '2026-09-30', dialed: 999, invites: 99 },
    ];
    const actuals = computeCheckpointActuals(days, 2026, 10);
    expect(actuals.d05).toEqual({ contracts: 1, demos: 1, invites: 3, calls: 50 });
    expect(actuals.d10).toEqual({ contracts: 1, demos: 2, invites: 4, calls: 60 });
    expect(actuals.end).toEqual(actuals.d10);
  });

  it('evaluates only targets that were planned', () => {
    const out = evaluateCheckpoint(
      { contracts: 0, demos: 2, invites: 4, calls: 50 },
      { contracts: 0, demos: 2, invites: 3, calls: 60 }
    );
    expect(out.status).toBe('behind');
    expect(out.planned).toBe(3);
    expect(out.met).toBe(2);
    expect(out.metrics.invites.status).toBe('behind');
    expect(out.metrics.calls.status).toBe('met');
    expect(out.metrics.contracts.status).toBe('unset');
  });

  it('finds the latest due checkpoint', () => {
    expect(latestDueCheckpoint(2026, 10, '2026-10-04')).toBeNull();
    expect(latestDueCheckpoint(2026, 10, '2026-10-12')?.id).toBe('d10');
    expect(latestDueCheckpoint(2026, 10, '2026-11-01')?.id).toBe('end');
  });

  it('requires behavior targets and four analysis answers before manager discussion', () => {
    const plan = emptyMonthlyPlan();
    Object.assign(plan.targets.d05, { demos: 1, invites: 2, calls: 30 });
    Object.assign(plan.analysis, {
      listened: '回聽了三通邀約失敗的電話',
      did: '比對數據並換了一種邀約說法',
      saw: '客戶不清楚下一次談話的價值',
      path: '從長通有量但邀約為零推到橋接不足',
    });
    const actuals = { d05: { demos: 1, invites: 2, calls: 30 } };
    expect(managerDiscussionReadiness(plan, actuals, 2026, 10, '2026-10-06').ready).toBe(true);
    actuals.d05.invites = 1;
    expect(managerDiscussionReadiness(plan, actuals, 2026, 10, '2026-10-06')).toMatchObject({
      behaviorReady: false,
      analysisReady: true,
      ready: false,
    });
  });

  it('warns when cumulative targets decrease', () => {
    const plan = emptyMonthlyPlan();
    plan.targets.d05.calls = 50;
    plan.targets.d10.calls = 40;
    expect(targetSequenceWarnings(plan)[0]).toContain('累計目標不應倒退');
    plan.targets.d10.calls = 60;
    expect(targetSequenceWarnings(plan)).toEqual([]);
  });
});
