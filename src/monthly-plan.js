/**
 * 每月作戰儀表板：累計目標、實際漏斗、檢查點調整與找主管前的分析準備。
 * 純資料函式；UI 在 symptom-log.js。
 */

export const PLAN_METRICS = [
  { key: 'contracts', label: '累計承攬', short: '承攬', dailyKey: 'contracts' },
  { key: 'demos', label: 'Demo 出席', short: 'Demo', dailyKey: 'demos' },
  { key: 'invites', label: '邀約數', short: '邀約', dailyKey: 'invites' },
  { key: 'calls', label: '通次', short: '通次', dailyKey: 'dialed' },
];

export const PLAN_CHECKPOINTS = [
  { id: 'd05', day: 5, label: '5 日前' },
  { id: 'd10', day: 10, label: '10 日前' },
  { id: 'd15', day: 15, label: '15 日前' },
  { id: 'd20', day: 20, label: '20 日前' },
  { id: 'end', day: 'end', label: '月底總計' },
];

export const ADJUSTMENT_CHECKPOINTS = PLAN_CHECKPOINTS.filter((c) => c.id !== 'end');

export const MANAGER_ANALYSIS_FIELDS = [
  { key: 'listened', label: '你聽了什麼？', placeholder: '例：回聽 10/3、10/4 三通有聊到困擾卻沒邀約的錄音' },
  { key: 'did', label: '你做了什麼？', placeholder: '例：比對五天漏斗，試了「困擾→價值→二選一時間」的新邀約句' },
  { key: 'saw', label: '你看了什麼？', placeholder: '例：客戶在我提出具體下一步前，常說「我再想想」' },
  { key: 'path', label: '你的分析路徑是什麼？', placeholder: '例：有效對話夠→邀約 0→回聽發現沒有價值橋接→懷疑邀約太突然' },
];

const blankMetrics = () => Object.fromEntries(PLAN_METRICS.map((m) => [m.key, 0]));

export function emptyMonthlyPlan() {
  return {
    targets: Object.fromEntries(PLAN_CHECKPOINTS.map((c) => [c.id, blankMetrics()])),
    adjustments: Object.fromEntries(ADJUSTMENT_CHECKPOINTS.map((c) => [c.id, ''])),
    analysis: Object.fromEntries(MANAGER_ANALYSIS_FIELDS.map((f) => [f.key, ''])),
    updatedAt: 0,
  };
}

function cleanCount(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

export function normalizeMonthlyPlan(plan) {
  const base = emptyMonthlyPlan();
  for (const cp of PLAN_CHECKPOINTS) {
    for (const metric of PLAN_METRICS) {
      base.targets[cp.id][metric.key] = cleanCount(plan?.targets?.[cp.id]?.[metric.key]);
    }
  }
  for (const cp of ADJUSTMENT_CHECKPOINTS) {
    base.adjustments[cp.id] = String(plan?.adjustments?.[cp.id] || '').trim();
  }
  for (const field of MANAGER_ANALYSIS_FIELDS) {
    base.analysis[field.key] = String(plan?.analysis?.[field.key] || '').trim();
  }
  base.updatedAt = Number(plan?.updatedAt) || 0;
  return base;
}

export function getMonthlyPlanFromSettings(settings, year, month) {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  return { key, ...normalizeMonthlyPlan(settings?.monthlyPlans?.[key]) };
}

export function patchMonthlyPlans(settings, year, month, plan) {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  const bag = { ...(settings?.monthlyPlans || {}) };
  bag[key] = { ...normalizeMonthlyPlan(plan), updatedAt: Date.now() };
  return bag;
}

export function checkpointDateKey(year, month, checkpoint) {
  const last = new Date(year, month, 0).getDate();
  const day = checkpoint.day === 'end' ? last : Math.min(last, Number(checkpoint.day));
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 每個檢查點以前的累計實際值（days 是 symptom-store 的每日資料）。 */
export function computeCheckpointActuals(days, year, month) {
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}-`;
  const rows = (days || []).filter((d) => String(d?.date || '').startsWith(monthPrefix));
  return Object.fromEntries(
    PLAN_CHECKPOINTS.map((cp) => {
      const end = checkpointDateKey(year, month, cp);
      const total = blankMetrics();
      rows
        .filter((d) => d.date <= end)
        .forEach((d) => {
          PLAN_METRICS.forEach((m) => {
            total[m.key] += cleanCount(d[m.dailyKey]);
          });
        });
      return [cp.id, total];
    })
  );
}

export function evaluateCheckpoint(target, actual) {
  const metrics = {};
  let planned = 0;
  let met = 0;
  PLAN_METRICS.forEach((metric) => {
    const t = cleanCount(target?.[metric.key]);
    const a = cleanCount(actual?.[metric.key]);
    const status = t <= 0 ? 'unset' : a >= t ? 'met' : 'behind';
    if (t > 0) {
      planned++;
      if (status === 'met') met++;
    }
    metrics[metric.key] = { target: t, actual: a, status, ratio: t > 0 ? a / t : null };
  });
  return {
    metrics,
    planned,
    met,
    status: planned === 0 ? 'unset' : met === planned ? 'met' : 'behind',
  };
}

export function checkpointDue(year, month, checkpoint, todayKey) {
  return checkpointDateKey(year, month, checkpoint) <= String(todayKey || '');
}

export function latestDueCheckpoint(year, month, todayKey) {
  return [...PLAN_CHECKPOINTS]
    .reverse()
    .find((cp) => checkpointDue(year, month, cp, todayKey)) || null;
}

export function managerDiscussionReadiness(plan, actuals, year, month, todayKey) {
  const checkpoint = latestDueCheckpoint(year, month, todayKey);
  const behaviorKeys = ['demos', 'invites', 'calls'];
  const target = checkpoint ? plan?.targets?.[checkpoint.id] : null;
  const actual = checkpoint ? actuals?.[checkpoint.id] : null;
  const plannedKeys = behaviorKeys.filter((key) => cleanCount(target?.[key]) > 0);
  const behaviorReady =
    plannedKeys.length > 0 && plannedKeys.every((key) => cleanCount(actual?.[key]) >= cleanCount(target?.[key]));
  const analysisReady = MANAGER_ANALYSIS_FIELDS.every(
    (field) => String(plan?.analysis?.[field.key] || '').trim().length >= 8
  );
  return {
    checkpoint,
    behaviorReady,
    analysisReady,
    ready: behaviorReady && analysisReady,
    plannedKeys,
  };
}

/** 檢查累計目標是否倒退；回傳人類可讀警告。 */
export function targetSequenceWarnings(plan) {
  const warnings = [];
  PLAN_METRICS.forEach((metric) => {
    let previous = 0;
    for (const cp of PLAN_CHECKPOINTS) {
      const value = cleanCount(plan?.targets?.[cp.id]?.[metric.key]);
      if (value > 0 && value < previous) {
        warnings.push(`${metric.label}在「${cp.label}」比前一檢查點少；累計目標不應倒退。`);
        break;
      }
      previous = Math.max(previous, value);
    }
  });
  return warnings;
}
