import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// 每個 src 模組在「載入當下」不得拋錯（例如 TDZ：在 const 宣告前讀取）。
// 這類錯誤會讓整個 app 白屏、所有按鈕無反應，但單元測試不會直接 import 到它們。

const SRC = join(process.cwd(), 'src');
// app.js 是入口，載入時會直接綁定真實 DOM，改由其餘模組逐一檢查
const files = readdirSync(SRC).filter((f) => f.endsWith('.js') && f !== 'app.js');

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

beforeAll(() => {
  globalThis.localStorage ??= memoryStorage();
  globalThis.sessionStorage ??= memoryStorage();
  globalThis.window ??= globalThis;
  globalThis.location ??= { hash: '', href: 'http://localhost/' };
  globalThis.document ??= {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    body: { appendChild: () => {} },
    createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} } }),
  };
  globalThis.navigator ??= { clipboard: {} };
  globalThis.Chart ??= class {};
});

describe('src modules load without top-level errors', () => {
  for (const f of files) {
    it(f, async () => {
      await expect(import(join(SRC, f))).resolves.toBeDefined();
    });
  }
});
