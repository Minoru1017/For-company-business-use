/** 首頁：上班日 vs 非上班日（本機 localStorage） */

export const DAY_TYPE_KEY = 'call_coach_day_type_v1';

export const DAY_TYPES = {
  work: { key: 'work', label: '上班日', hint: '進入開發／陪練／症狀等日常工作流程。' },
  off: { key: 'off', label: '非上班日', hint: '輸入日：找 AI 趨勢＋銷售技巧相關影片，寫心得、累積學習庫。' },
};

export function getDayType() {
  const v = localStorage.getItem(DAY_TYPE_KEY);
  return v === 'off' ? 'off' : 'work';
}

export function setDayType(type) {
  const t = type === 'off' ? 'off' : 'work';
  localStorage.setItem(DAY_TYPE_KEY, t);
  return t;
}

export function isOffDay() {
  return getDayType() === 'off';
}
