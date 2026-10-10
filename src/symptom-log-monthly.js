/**
 * 症狀紀錄的「本月作戰儀表板」與「每月總結」卡片：讀寫 settings 裡的月計畫／月複盤，自動儲存。
 */
import {
  MONTHLY_REVIEW_FIELDS,
  buildMonthlyStatsHint,
  computeMonthlyStats,
  formatDelta,
  getMonthlyReviewFromSettings,
  monthlyReviewFilled,
  patchMonthlyReviews,
  q4Label,
  reviewMonthKey,
} from './monthly-review.js';
import {
  ADJUSTMENT_CHECKPOINTS,
  MANAGER_ANALYSIS_FIELDS,
  PLAN_CHECKPOINTS,
  PLAN_METRICS,
  checkpointDateKey,
  checkpointDue,
  computeCheckpointActuals,
  evaluateCheckpoint,
  getMonthlyPlanFromSettings,
  managerDiscussionReadiness,
  patchMonthlyPlans,
  targetSequenceWarnings,
} from './monthly-plan.js';
import { loadDrillLog } from './drill-log.js';
import { SYMPTOM_DEFS } from './symptom-engine.js';
import { listCallsBetween, listDays, saveSettings, summarizeRange } from './symptom-store.js';
import { drillSparkline, fmtDateLabel } from './symptom-log-helpers.js';
import { escapeHTML } from './utils.js';

/**
 * @param {object} ctx
 * @param {(sel:string)=>Element|null} ctx.q
 * @param {{year:number, month:number, settings:object}} ctx.state  症狀紀錄的共用 state（會更新 state.settings）
 * @param {string} ctx.today  YYYY-MM-DD
 * @param {(e:any)=>void} ctx.showDbError
 */
export function createMonthlyPanels({ q, state, today, showDbError }) {
  let monthlyReviewTimer = null;
  let monthlyPlanTimer = null;

  function readMonthlyPlanForm(base) {
    const next =
      typeof structuredClone === 'function'
        ? structuredClone(base)
        : JSON.parse(JSON.stringify(base));
    q('#slPlanTargets')?.querySelectorAll('[data-plan-target]').forEach((input) => {
      const [checkpoint, metric] = input.dataset.planTarget.split(':');
      next.targets[checkpoint][metric] = Math.max(0, Math.floor(Number(input.value) || 0));
    });
    q('#slPlanAdjustments')?.querySelectorAll('[data-plan-adjust]').forEach((input) => {
      next.adjustments[input.dataset.planAdjust] = input.value;
    });
    q('#slPlanAnalysis')?.querySelectorAll('[data-plan-analysis]').forEach((input) => {
      next.analysis[input.dataset.planAnalysis] = input.value;
    });
    return next;
  }

  function scheduleMonthlyPlanSave(plan) {
    clearTimeout(monthlyPlanTimer);
    monthlyPlanTimer = setTimeout(async () => {
      try {
        const next = readMonthlyPlanForm(plan);
        const bag = patchMonthlyPlans(state.settings, state.year, state.month, next);
        state.settings = await saveSettings({ monthlyPlans: bag });
        const saved = q('#slPlanSaved');
        if (saved) saved.textContent = `已自動儲存 ${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
        const badge = q('#slPlanBadge');
        const total = next.targets.end;
        if (badge) badge.textContent = PLAN_METRICS.every((metric) => total[metric.key] > 0) ? '月底目標已設定' : '尚未填完月底目標';
      } catch (error) {
        showDbError(error);
      }
    }, 400);
  }

  async function renderMonthlyPlan() {
    const title = q('#slPlanTitle');
    if (title) title.textContent = `${state.month} 月作戰儀表板`;
    const from = `${reviewMonthKey(state.year, state.month)}-01`;
    const last = new Date(state.year, state.month, 0).getDate();
    const to = `${reviewMonthKey(state.year, state.month)}-${String(last).padStart(2, '0')}`;
    let days = [];
    try {
      days = await listDays(from, to);
    } catch {
      days = [];
    }
    const plan = getMonthlyPlanFromSettings(state.settings, state.year, state.month);
    const actuals = computeCheckpointActuals(days, state.year, state.month);
    const evaluations = Object.fromEntries(
      PLAN_CHECKPOINTS.map((cp) => [cp.id, evaluateCheckpoint(plan.targets[cp.id], actuals[cp.id])])
    );
    const dueList = PLAN_CHECKPOINTS.filter((cp) => checkpointDue(state.year, state.month, cp, today));
    const focus = dueList.at(-1) || PLAN_CHECKPOINTS[0];
    const focusEval = evaluations[focus.id];
    const focusDue = checkpointDue(state.year, state.month, focus, today);

    const badge = q('#slPlanBadge');
    if (badge) {
      const total = plan.targets.end;
      badge.textContent = PLAN_METRICS.every((metric) => total[metric.key] > 0) ? '月底目標已設定' : '設定目標';
    }

    const progress = q('#slPlanProgress');
    if (progress) {
      const metricHtml = PLAN_METRICS.map((metric) => {
        const item = focusEval.metrics[metric.key];
        const cls = !focusDue || item.status === 'unset' ? '' : item.status;
        return `<span class="slog-plan-progress-metric ${cls}"><b>${escapeHTML(metric.short)}</b>${item.actual}<i>/ ${item.target || '—'}</i></span>`;
      }).join('');
      const focusDate = checkpointDateKey(state.year, state.month, focus);
      progress.innerHTML = `<div class="slog-plan-progress-head">
          <div><span>${focusDue ? '最近檢查點' : '下一檢查點'}</span><strong>${escapeHTML(fmtDateLabel(focusDate))}</strong></div>
          <span class="slog-plan-state ${focusDue ? focusEval.status : 'upcoming'}">${
            focusDue ? (focusEval.status === 'met' ? '行為進度達標' : focusEval.status === 'behind' ? '需要調整' : '請先設定目標') : '進行中'
          }</span>
        </div><div class="slog-plan-progress-metrics">${metricHtml}</div>`;
    }

    const targets = q('#slPlanTargets');
    if (targets) {
      targets.innerHTML = `
        <div class="slog-plan-table-head"><span>檢查點</span>${PLAN_METRICS.map((m) => `<span>${escapeHTML(m.label)}</span>`).join('')}</div>
        ${PLAN_CHECKPOINTS.map((cp) => {
          const due = checkpointDue(state.year, state.month, cp, today);
          const evaluation = evaluations[cp.id];
          return `<div class="slog-plan-target-row ${due ? evaluation.status : 'upcoming'}">
            <div class="slog-plan-cp"><strong>${state.month}/${cp.day === 'end' ? last : cp.day} 前</strong><span>${cp.id === 'end' ? '總計' : '累計'}</span></div>
            ${PLAN_METRICS.map((metric) => {
              const item = evaluation.metrics[metric.key];
              return `<label class="slog-plan-target ${due ? item.status : ''}">
                <span class="slog-plan-mobile-label">${escapeHTML(metric.label)}</span>
                <input type="number" min="0" inputmode="numeric" data-plan-target="${cp.id}:${metric.key}" value="${item.target || ''}" placeholder="目標">
                <small>實際 <b>${item.actual}</b>${due && item.target ? ` · ${item.status === 'met' ? '達標' : '差 ' + Math.max(0, item.target - item.actual)}` : ''}</small>
              </label>`;
            }).join('')}
          </div>`;
        }).join('')}`;
    }

    const warnings = targetSequenceWarnings(plan);
    const warningsEl = q('#slPlanWarnings');
    if (warningsEl) {
      warningsEl.innerHTML = warnings.length
        ? warnings.map((w) => `<p>⚠ ${escapeHTML(w)}</p>`).join('')
        : '';
    }

    const adjustments = q('#slPlanAdjustments');
    if (adjustments) {
      adjustments.innerHTML = ADJUSTMENT_CHECKPOINTS.map(
        (cp) => `<label><span>如果 ${state.month}/${cp.day} 前沒達標，我會：</span>
          <textarea class="field" rows="2" data-plan-adjust="${cp.id}" placeholder="例：回聽 3 通有聊到困擾卻沒邀約的電話，重寫價值橋接句，隔天每通練一次">${escapeHTML(plan.adjustments[cp.id])}</textarea>
        </label>`
      ).join('');
    }

    const readiness = managerDiscussionReadiness(plan, actuals, state.year, state.month, today);
    const readinessEl = q('#slPlanReadiness');
    if (readinessEl) {
      const cpLabel = readiness.checkpoint ? `${state.month}/${readiness.checkpoint.day === 'end' ? last : readiness.checkpoint.day}` : '首個檢查點';
      readinessEl.innerHTML = `
        <div class="slog-plan-condition ${readiness.behaviorReady ? 'ok' : ''}">
          <span>${readiness.behaviorReady ? '✓' : '1'}</span><div><strong>行為量要夠</strong><p>${readiness.checkpoint ? `以 ${cpLabel} 累計目標檢查 Demo／邀約／通次：${readiness.behaviorReady ? '已達到自己設定的量。' : '尚未全部達標，先確認是否真的落實動作量。'}` : '第一個檢查點尚未到期；先填好 Demo／邀約／通次目標。'}</p></div>
        </div>
        <div class="slog-plan-condition ${readiness.analysisReady ? 'ok' : ''}">
          <span>${readiness.analysisReady ? '✓' : '2'}</span><div><strong>真的努力分析過</strong><p>${readiness.analysisReady ? '四個分析問題都有具體紀錄。' : '請先具體寫下聽了什麼、做了什麼、看了什麼，以及推理路徑。'}</p></div>
        </div>
        <p class="slog-plan-ready ${readiness.ready ? 'ok' : ''}">${readiness.ready ? '已準備好：帶著數據與分析去找主管討論。' : '準備中：不是要獨自撐住，而是先帶著證據與假設來討論。'}</p>
        <p class="hint slog-plan-escalate">合規、客訴或重大承諾風險請立刻找主管，不必等行為量達標。</p>`;
    }

    const analysis = q('#slPlanAnalysis');
    if (analysis) {
      analysis.innerHTML = MANAGER_ANALYSIS_FIELDS.map(
        (field) => `<label><span>${escapeHTML(field.label)}</span>
          <textarea class="field" rows="2" data-plan-analysis="${field.key}" placeholder="${escapeHTML(field.placeholder)}">${escapeHTML(plan.analysis[field.key])}</textarea>
        </label>`
      ).join('');
    }

    q('#slPlanCard')?.querySelectorAll('[data-plan-target], [data-plan-adjust], [data-plan-analysis]').forEach((input) => {
      input.addEventListener('input', () => scheduleMonthlyPlanSave(plan));
    });
    q('#slPlanTargets')?.querySelectorAll('[data-plan-target]').forEach((input) => {
      input.addEventListener('change', () => {
        scheduleMonthlyPlanSave(plan);
        setTimeout(renderMonthlyPlan, 450);
      });
    });
  }

  function bindMonthlyReviewFields() {
    const fieldsHost = q('#slMonthlyReviewFields');
    if (!fieldsHost) return;
    const mk = reviewMonthKey(state.year, state.month);
    if (fieldsHost.dataset.monthKey === mk) return;
    fieldsHost.dataset.monthKey = mk;
    fieldsHost.innerHTML = MONTHLY_REVIEW_FIELDS.map((f) => {
      const label = f.key === 'q4' ? q4Label(state.year, state.month) : f.label;
      return `<label class="slog-monthly-q"><span class="slog-monthly-q-label">${escapeHTML(label)}</span>
        <textarea class="field" data-mr="${f.key}" rows="4" placeholder="${escapeHTML(f.placeholder)}"></textarea></label>`;
    }).join('');
    fieldsHost.querySelectorAll('[data-mr]').forEach((el) => {
      el.addEventListener('input', () => {
        if (!state.settings) return;
        const key = el.dataset.mr;
        const cur = getMonthlyReviewFromSettings(state.settings, state.year, state.month);
        clearTimeout(monthlyReviewTimer);
        monthlyReviewTimer = setTimeout(async () => {
          try {
            const bag = patchMonthlyReviews(state.settings, state.year, state.month, {
              ...cur,
              [key]: el.value,
            });
            state.settings = await saveSettings({ monthlyReviews: bag });
            const saved = q('#slMonthlySaved');
            if (saved) {
              saved.textContent = `已自動儲存 ${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
            }
            const badge = q('#slMonthlyReviewBadge');
            if (badge) {
              badge.textContent = monthlyReviewFilled(getMonthlyReviewFromSettings(state.settings, state.year, state.month))
                ? '已填'
                : '待填';
            }
          } catch (e) {
            showDbError(e);
          }
        }, 400);
      });
    });
  }

  async function renderMonthlyReview() {
    bindMonthlyReviewFields();
    const review = getMonthlyReviewFromSettings(state.settings, state.year, state.month);
    q('#slMonthlyReviewFields')?.querySelectorAll('[data-mr]').forEach((el) => {
      el.value = review[el.dataset.mr] || '';
    });
    const badge = q('#slMonthlyReviewBadge');
    if (badge) badge.textContent = monthlyReviewFilled(review) ? '已填' : '待填';
    const statsEl = q('#slMonthlyStatsHint');
    if (statsEl) {
      try {
        const stats = await computeMonthlyStats({
          year: state.year,
          month: state.month,
          summarizeRange,
          listDays,
          listCallsBetween,
          drillLog: loadDrillLog(),
        });
        const tops = stats.topSymptoms.map((k) => SYMPTOM_DEFS[k]?.label || k);
        statsEl.textContent = buildMonthlyStatsHint({ ...stats, topSymptoms: tops });
        renderMonthlyDrill(stats.drills);
      } catch {
        statsEl.textContent = '';
        renderMonthlyDrill(null);
      }
    }
  }

  function renderMonthlyDrill(d) {
    const el = q('#slMonthlyDrill');
    if (!el) return;
    el.hidden = !d?.count;
    if (!d?.count) {
      el.innerHTML = '';
      return;
    }
    const chip = (label, value, hint = '') =>
      `<div class="slog-chip"><span class="slog-chip-v">${value}</span><span class="slog-chip-l">${label}</span>${hint ? `<span class="slog-chip-h">${hint}</span>` : ''}</div>`;
    const vsPrev = d.prevAvgScore != null ? formatDelta(d.avgScore - d.prevAvgScore) : '上月沒有紀錄';
    const trend = d.trend != null ? formatDelta(d.trend) : '練滿 4 次後顯示';
    el.innerHTML = `
      <div class="slog-monthly-drill-head"><b>陪練練習量</b><span class="hint">每次陪練結束自動記錄</span></div>
      <div class="slog-metrics">
        ${chip('陪練次數', `${d.count} 次`, `${d.days} 天有練 · 破冰 ${d.icebreak}／完整 ${d.full}`)}
        ${chip('平均分數', `${d.avgScore}`, `最高 ${d.bestScore}`)}
        ${chip('比上月', vsPrev, d.prevAvgScore != null ? `上月平均 ${d.prevAvgScore}（${d.prevCount} 次）` : '')}
        ${chip('月內趨勢', trend, '後半次數 vs 前半次數')}
        ${d.focusCount ? chip('重點達成', `${d.focusMet}/${d.focusCount}`, '來自症狀紀錄的弱點') : ''}
      </div>
      ${drillSparkline(d.daily)}`;
  }

  return { renderMonthlyPlan, renderMonthlyReview };
}
