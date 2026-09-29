import { renderHeroBarHtml, renderHomePhilosophyHtml } from './coach-philosophy.js';
import { renderDirectivesHtml } from './coach-directives.js';

export function mountHomePhilosophy() {
  const host = document.getElementById('coachPhilosophyHome');
  if (!host) return;
  host.innerHTML = renderDirectivesHtml({ max: 5 }) + renderHomePhilosophyHtml();
}

export function updateHeroPhilosophyBar(mode) {
  const host = document.getElementById('coachHeroBar');
  if (!host) return;
  if (!mode) {
    host.hidden = true;
    host.innerHTML = '';
    return;
  }
  // 早會模式本身就在管理方向，頁首不重複顯示
  const directives = mode === 'brief' ? '' : renderDirectivesHtml({ max: 3, compact: true });
  host.innerHTML = renderHeroBarHtml(mode) + directives;
  host.hidden = false;
}
