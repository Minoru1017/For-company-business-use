import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

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

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
});
const problems = [];
let browser;

try {
  await waitForServer(BASE);
  browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
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
console.log('smoke passed');
