import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RULES, deidentify, findLeaks } from '../scripts/deidentify-rules.mjs';

// 測試本身不寫任何識別字：在去識別後的匯出版本裡規則為空，這些測試仍要成立
const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

function* textFiles(dir) {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) yield* textFiles(rel);
    else if (/\.(js|mjs|css|html|md|json|yml)$/.test(name)) yield rel;
  }
}

const APP_FILES = ['index.html', 'README.md', 'vite.config.js', ...textFiles('src'), ...textFiles('docs'), ...textFiles('tests')];

describe('de-identified edition', () => {
  it('leaves no identifier in any app, doc or test file once the rules run', () => {
    const leaks = APP_FILES.flatMap((f) => findLeaks(deidentify(read(f))).map((l) => `${f}:${l.line} [${l.label}] ${l.excerpt}`));
    expect(leaks).toEqual([]);
  });

  it('is idempotent', () => {
    ['src/brands.js', 'src/local-transcribe.js', 'index.html'].forEach((f) => {
      const once = deidentify(read(f));
      expect(deidentify(once)).toBe(once);
    });
  });

  it('renames both brands to generic names and ids', () => {
    const src = deidentify(read('src/brands.js'));
    expect(src).toMatch(/name: '甲品牌'/);
    expect(src).toMatch(/name: '乙品牌'/);
    expect(src).toMatch(/LEGACY_BRAND = 'branda'/);
    expect(src).toMatch(/DEFAULT_BRAND = 'brandb'/);
    const html = deidentify(read('index.html'));
    expect(html).toContain('data-brand-set="branda">甲品牌<');
    expect(html).toContain('data-brand-set="brandb">乙品牌<');
  });

  it('ships no built-in cloud project or spreadsheet', () => {
    expect(deidentify(read('src/cloud-sync.js'))).toMatch(/BUILT_IN_CLOUD = \{\s*url: '',\s*anonKey: '',/);
    expect(deidentify(read('src/symptom-store.js'))).toMatch(/sheetUrl: '',/);
  });

  it('replaces the GPU host location with a generic wording', () => {
    const logic = deidentify(read('src/local-transcribe-logic.js'));
    expect(logic).toContain("return '本機 GPU'");
    expect(logic).toMatch(/start_gpuhost_gpu\.cmd/);
  });

  it('does not touch ordinary words that merely contain the brand letters', () => {
    const plain = 'innovation renovate supernova Novak casanovas';
    expect(deidentify(plain)).toBe(plain);
  });

  it.skipIf(RULES.length === 0)('reports where an identifier slipped through', () => {
    const place = ['新', '竹'].join('');
    const leaks = findLeaks(`ok\n上傳到${place}主機`);
    expect(leaks).toEqual([expect.objectContaining({ label: '地名', line: 2 })]);
    expect(findLeaks(deidentify(`上傳到${place}主機`))).toEqual([]);
  });
});
