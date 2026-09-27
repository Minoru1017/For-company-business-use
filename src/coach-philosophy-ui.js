import { renderHeroBarHtml, renderHomePhilosophyHtml } from './coach-philosophy.js';

export function mountHomePhilosophy() {
  const host = document.getElementById('coachPhilosophyHome');
  if (!host) return;
  host.innerHTML = renderHomePhilosophyHtml();
}

export function updateHeroPhilosophyBar(mode) {
  const host = document.getElementById('coachHeroBar');
  if (!host) return;
  if (!mode) {
    host.hidden = true;
    host.innerHTML = '';
    return;
  }
  host.innerHTML = renderHeroBarHtml(mode);
  host.hidden = false;
}
