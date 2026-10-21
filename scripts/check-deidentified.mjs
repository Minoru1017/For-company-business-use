/**
 * 外洩檢查：掃描資料夾內所有文字檔（含檔名），找出去識別規則列管的字串。
 *   node scripts/check-deidentified.mjs [dist-public] [public-export] …
 * 有任何一筆就以結束碼 1 離開。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findLeaks } from './deidentify-rules.mjs';

const SKIP_DIRS = new Set(['node_modules', '.git']);

export function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

function isBinary(buf) {
  return buf.subarray(0, 8192).includes(0);
}

export function scanDir(dir) {
  const leaks = [];
  let files = 0;
  for (const file of walk(dir)) {
    const rel = relative(dir, file);
    findLeaks(rel).forEach((l) => leaks.push({ file: rel, ...l, line: 0 }));
    const buf = readFileSync(file);
    if (isBinary(buf)) continue;
    files += 1;
    findLeaks(buf.toString('utf8')).forEach((l) => leaks.push({ file: rel, ...l }));
  }
  return { files, leaks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dirs = process.argv.slice(2);
  if (!dirs.length) dirs.push('dist-public');
  let total = 0;
  for (const dir of dirs) {
    const { files, leaks } = scanDir(dir);
    total += leaks.length;
    console.log(`${dir}: 掃描 ${files} 個文字檔，${leaks.length ? `發現 ${leaks.length} 筆識別資訊` : '沒有識別資訊'}`);
    leaks.slice(0, 50).forEach((l) => console.log(`  ${l.file}${l.line ? `:${l.line}` : '（檔名）'}  [${l.label}]  ${l.excerpt}`));
    if (leaks.length > 50) console.log(`  …另有 ${leaks.length - 50} 筆`);
  }
  process.exit(total ? 1 : 0);
}
