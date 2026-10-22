/**
 * 匯出去識別版原始碼：把 git 追蹤的文字檔套用去識別規則後寫到另一個資料夾，
 * 檔名一併改寫；二進位檔（PDF、圖片…）無法逐字改寫，直接排除並列在報告裡。
 *   node scripts/export-public.mjs [public-export]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { STUB_SOURCE, deidentify } from './deidentify-rules.mjs';
import { scanDir } from './check-deidentified.mjs';

const RULES_FILE = 'scripts/deidentify-rules.mjs';
const BINARY_EXT = /\.(pdf|png|jpe?g|gif|webp|ico|exe|zip|woff2?|ttf|mp3|mp4|wav|m4a|webm)$/i;

const outDir = resolve(process.argv[2] || 'public-export');
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
if (outDir === root || root.startsWith(`${outDir}/`)) throw new Error(`輸出資料夾不能是專案本身：${outDir}`);

const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter((f, i, all) => f && all.indexOf(f) === i && existsSync(join(root, f)));
const excluded = [];
let written = 0;

rmSync(outDir, { recursive: true, force: true });
for (const file of files) {
  const buf = readFileSync(join(root, file));
  if (BINARY_EXT.test(file) || buf.subarray(0, 8192).includes(0)) {
    excluded.push(file);
    continue;
  }
  const target = join(outDir, deidentify(file));
  const text = file === RULES_FILE ? STUB_SOURCE : deidentify(buf.toString('utf8'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
  written += 1;
}

writeFileSync(
  join(outDir, 'DEIDENTIFIED.md'),
  `# 去識別版原始碼

這份資料夾由 \`npm run export:public\` 產生：品牌、地點、帳號、網址與組織資源識別碼都已替換成通用名稱，
預設的雲端專案與試算表改為空白（請在畫面上自行設定）。

| 原本 | 公開版 |
| --- | --- |
| 兩個品牌 | 甲品牌／乙品牌（代號 branda／brandb） |
| GPU 主機所在地 | 遠端 GPU／GPU 主機（檔名中的地名改為 gpuhost） |
| GitHub 帳號與 repo | example-org/sales-call-coach |
| 內建 Supabase 專案與金鑰 | 空白 |
| 預設 Google 試算表 | 空白（測試用的 ID 改為範例值） |

共寫出 ${written} 個文字檔。以下二進位檔無法逐字去識別，沒有包含在內：

${excluded.map((f) => `- ${deidentify(f)}`).join('\n') || '- （無）'}
`
);

const { files: scanned, leaks } = scanDir(outDir);
console.log(`已匯出 ${written} 個檔案到 ${outDir}（排除 ${excluded.length} 個二進位檔）`);
console.log(`外洩檢查：掃描 ${scanned} 個文字檔，${leaks.length ? `發現 ${leaks.length} 筆` : '沒有識別資訊'}`);
leaks.slice(0, 30).forEach((l) => console.log(`  ${l.file}:${l.line}  [${l.label}]  ${l.excerpt}`));
process.exit(leaks.length ? 1 : 0);
