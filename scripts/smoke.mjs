import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const OUT_DIR = process.argv[2] || 'dist';
const PORT = Number(process.env.SMOKE_PORT || 4179);
const BASE = `http://127.0.0.1:${PORT}/`;
const MODES = [
  ['dev', 'devSection'],
  ['demo', 'demoSection'],
  ['drill', 'drillSection'],
  ['log', 'logSection'],
  ['brief', 'briefSection'],
  ['deck', 'deckSection'],
];

async function waitForServer(url, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`preview server did not start: ${url}`);
}

const server = spawn('npx', ['vite', 'preview', '--outDir', OUT_DIR, '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
});
const problems = [];
let browser;

try {
  await waitForServer(BASE);
  browser = await chromium.launch();
  const watch = (page) => {
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  };

  // 新手教學：全新瀏覽器第一次打開會自動播放，走完後不再出現
  const fresh = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  watch(fresh);
  await fresh.goto(BASE);
  await fresh.waitForSelector('.ob-root[data-tour="home"] .ob-card', { timeout: 10000 });
  const homeSteps = Number((await fresh.textContent('#obCount')).split('/')[1]);
  for (let i = 0; i < homeSteps; i += 1) await fresh.click('.ob-card [data-ob="next"]');
  await fresh.waitForSelector('.ob-root', { state: 'detached' });
  await fresh.reload();
  await fresh.waitForTimeout(1200);
  if (await fresh.$('.ob-root')) problems.push('onboarding: home tour shows again after finishing');
  await fresh.click('#onboardingHomeBtn');
  await fresh.waitForSelector('.ob-root[data-tour="home"]');
  await fresh.keyboard.press('Escape');
  await fresh.waitForSelector('.ob-root', { state: 'detached' });
  await fresh.click('.mode-card[data-mode="dev"]');
  await fresh.waitForSelector('.ob-root[data-tour="workspace"] .ob-card', { timeout: 10000 });
  await fresh.keyboard.press('Escape');
  await fresh.close();
  console.log(`ok  onboarding (${homeSteps} home steps)`);

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem('callCoachOnboarding', JSON.stringify({ home: 1, workspace: 1 })));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/Failed to load resource|ERR_|net::|fonts\.g/i.test(text)) return;
    problems.push(`console.error: ${text}`);
  });

  await page.goto(BASE);
  await page.waitForSelector('#modeChooser:not([hidden])');

  for (const [mode, sectionId] of MODES) {
    await page.goto(`${BASE}#${mode}`);
    await page.reload();
    await page.waitForSelector('#mainApp:not([hidden])', { timeout: 10000 });
    await page.waitForFunction(
      (id) => {
        const el = document.getElementById(id);
        return el && !el.hidden && el.offsetParent !== null && el.children.length > 0;
      },
      sectionId,
      { timeout: 10000 },
    );
    await page.waitForTimeout(300);
    console.log(`ok  ${mode}`);
  }

  for (const [mode] of MODES) {
    await page.click(`#modeBar [data-mode="${mode}"]`);
    await page.waitForFunction((m) => document.body.dataset.mode === m, mode, { timeout: 10000 });
    await page.waitForTimeout(200);
  }
  console.log('ok  mode switching');
} catch (e) {
  problems.push(`smoke failure: ${e.message}`);
} finally {
  await browser?.close();
  server.kill();
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`smoke passed (${OUT_DIR})`);
