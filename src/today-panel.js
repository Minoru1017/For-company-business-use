import { DAY_TYPES, getDayType } from './day-type.js';
import { countCompleteEntries, getDayJournal, REQUIRED_CALLS_PER_DAY } from './reflection-journal.js';
import { dateKey, shiftDateKey } from './symptom-engine.js';
import { getSettings, listDays, summarizeRange } from './symptom-store.js';
import { ACTION_LOOKBACK_DAYS, commitmentLabel, latestCommitment, weekFunnel, weekStartKey } from './today-summary.js';
import { escapeHTML } from './utils.js';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function dateLine(now) {
  return `${now.getMonth() + 1}月${now.getDate()}日`;
}

function ctaFor(commitment, done) {
  if (done < REQUIRED_CALLS_PER_DAY) return { label: `寫第 ${done + 1} 通複盤`, action: 'reflect' };
  if (!commitment) return { label: '去症狀紀錄寫一件事', action: 'log' };
  return { label: '開始今天的電訪', action: 'dev' };
}

function render(el, { commitment, done, week }) {
  const now = new Date();
  const dayType = DAY_TYPES[getDayType()]?.label || '';
  const cta = ctaFor(commitment, done);
  const label = commitment ? commitmentLabel(commitment.daysAgo) : '今天要改的一件事';
  const sentence = commitment ? commitment.action : '還沒寫下要改的一件事';
  const why = commitment
    ? [commitment.symptom && `症狀：${commitment.symptom}`, commitment.verify && `怎麼驗證：${commitment.verify}`].filter(Boolean).join('　')
    : '在症狀紀錄的「明天只改一件事」寫一句，明天打開這裡就會先看到它。';
  const retention = week.retention == null ? '—' : String(Math.round(week.retention * 100));
  const progress = Math.min(1, done / REQUIRED_CALLS_PER_DAY);

  el.innerHTML = `
    <div class="today-kicker"><span>${dateLine(now)}</span><span class="today-meta">週${WEEKDAYS[now.getDay()]} · ${escapeHTML(dayType)}</span></div>
    <p class="today-label">${escapeHTML(label)}</p>
    <p class="today-sentence${commitment ? '' : ' empty'}">${escapeHTML(sentence)}</p>
    <p class="today-why">${escapeHTML(why)}</p>
    <button type="button" class="primary today-cta" data-today-action="${cta.action}">${cta.label}</button>
    <div class="today-floor">
      <div class="today-metric">
        <span class="today-metric-l">今日自寫複盤</span>
        <b class="today-metric-n${done >= REQUIRED_CALLS_PER_DAY ? ' ok' : ''}">${done}<small>/ ${REQUIRED_CALLS_PER_DAY}</small></b>
        <span class="today-bar"><i style="width:${(progress * 100).toFixed(0)}%"></i></span>
      </div>
      <div class="today-metric">
        <span class="today-metric-l">本週留存</span>
        <b class="today-metric-n">${retention}${week.retention == null ? '' : '<small>%</small>'}</b>
        <span class="today-metric-s">${week.connected ? `${week.over} / ${week.connected} 通接通` : '本週還沒有接通紀錄'}</span>
      </div>
      <div class="today-metric">
        <span class="today-metric-l">本週邀約</span>
        <b class="today-metric-n${week.invites > 0 ? ' ok' : ''}">${week.invites}</b>
        <span class="today-metric-s">${week.dialed ? `撥出 ${week.dialed} 通` : '漏斗在症狀紀錄填'}</span>
      </div>
    </div>`;
}

/**
 * 首頁「今天」面板：只回答一個問題——今天要改哪一件事。
 * @param {HTMLElement} el
 * @param {{ onAction: (action: 'reflect'|'log'|'dev') => void }} opts
 */
export function mountTodayPanel(el, { onAction } = {}) {
  if (!el) return { refresh: async () => {} };
  let state = { commitment: null, done: 0, week: { retention: null, invites: 0, connected: 0, over: 0, dialed: 0 } };

  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-today-action]');
    if (btn) onAction?.(btn.dataset.todayAction);
  });

  async function refresh() {
    const today = dateKey();
    state = { ...state, done: countCompleteEntries(getDayJournal(today)) };
    render(el, state);
    try {
      const weekFrom = weekStartKey(today);
      const lookFrom = shiftDateKey(today, -ACTION_LOOKBACK_DAYS);
      const from = lookFrom < weekFrom ? lookFrom : weekFrom;
      const [days, summary, settings] = await Promise.all([listDays(from, today), summarizeRange(weekFrom, today), getSettings()]);
      const weekDays = (days || []).filter((d) => d.date >= weekFrom);
      state = {
        ...state,
        commitment: latestCommitment(days || [], today),
        week: weekFunnel(weekDays, summary || {}, settings),
      };
    } catch (err) {
      console.error('today panel data failed', err);
    }
    render(el, state);
  }

  refresh();
  return { refresh };
}
