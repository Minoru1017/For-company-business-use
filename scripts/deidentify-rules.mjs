/**
 * 去識別規則：公開版建置（vite --mode public）、原始碼匯出（npm run export:public）、
 * 外洩檢查（npm run check:public）共用同一份。
 *
 * 這是整個專案唯一允許出現原始識別字的檔案；匯出時會換成 STUB_SOURCE，不會跟著出去。
 * 規則依序套用，長的、具體的放前面，短的兜底放後面。
 */

/** @type {Array<[RegExp, string]>} */
export const RULES = [
  // 組織資源：公開版不帶任何預設專案，使用者自己在畫面上填
  [/'https:\/\/docs\.google\.com\/spreadsheets\/d\/1c7W5vfpQPGqm8urKqd-fM-qt3x2Xz5fvhpt5eGgp3pA\/edit'/g, "''"],
  [/1c7W5vfpQPGqm8urKqd-fM-qt3x2Xz5fvhpt5eGgp3pA/g, '1ExampleSheetId000000000000000000000000000AB'],
  [/'https:\/\/tgmpwiuavzuzsqjcftrj\.supabase\.co'/g, "''"],
  [/'eyJhbGciOi[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+'/g, "''"],
  [/tgmpwiuavzuzsqjcftrj/g, 'your-project-ref'],

  // 帳號與網址
  [/https:\/\/minoru1017\.github\.io\/For-company-business-use/gi, 'https://example-org.github.io/sales-call-coach'],
  [/Minoru1017\/For-company-business-use/gi, 'example-org/sales-call-coach'],
  [/minoru1017/gi, 'example-org'],
  [/For-company-business-use/g, 'sales-call-coach'],

  // 品牌
  [/NOVA\s*超星計劃/g, '乙品牌'],
  [/超星計劃/g, '乙品牌'],
  [/AI\s*未來學院/g, '甲品牌'],
  [/未來學院/g, '甲品牌'],
  [/(?<![A-Za-z])NOVA(?![A-Za-z])/g, '乙品牌'],
  [/(?<![A-Za-z])nova(?![A-Za-z])/g, 'brandb'],
  [/(?<![A-Za-z])aifa(?![A-Za-z])/g, 'branda'],

  // 地點（GPU 主機所在地）
  [/新竹本機 GPU/g, '本機 GPU'],
  [/（新竹）/g, ''],
  [/新竹\s*GPU/g, '遠端 GPU'],
  [/新竹\s*Worker/g, '遠端 Worker'],
  [/新竹\s*(?:主機|PC|電腦)/g, 'GPU 主機'],
  [/(在|到|連|對)新竹/g, '$1 GPU 主機'],
  [/新竹/g, 'GPU 主機'],
  [/HSINCHU/g, 'GPUHOST'],
  [/Hsinchu/g, 'GpuHost'],
  [/hsinchu/g, 'gpuhost'],
];

/** 外洩檢查：產出物裡只要出現任一個就算沒清乾淨 */
export const FORBIDDEN = [
  { label: '品牌名（甲）', re: /未來學院/ },
  { label: '品牌名（乙）', re: /超星|(?<![A-Za-z])NOVA(?![A-Za-z])/ },
  { label: '品牌代號', re: /(?<![A-Za-z])(?:aifa|nova)(?![A-Za-z])/ },
  { label: '地名', re: /新竹|hsinchu/i },
  { label: 'GitHub 帳號', re: /minoru(?:1017)?(?![a-z])/i },
  { label: '原始 repo 名稱', re: /For-company-business-use/i },
  { label: 'Supabase 專案', re: /tgmpwiuavzuzsqjcftrj/ },
  { label: 'Supabase 金鑰', re: /eyJhbGciOi[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+/ },
  { label: 'Google 試算表', re: /1c7W5vfpQPGqm8urKqd/ },
];

export function deidentify(text) {
  return RULES.reduce((s, [re, to]) => s.replace(re, to), String(text));
}

/** 回傳 [{ label, line, excerpt }]；沒有外洩就是空陣列 */
export function findLeaks(text) {
  const out = [];
  String(text)
    .split('\n')
    .forEach((line, i) => {
      FORBIDDEN.forEach(({ label, re }) => {
        const m = line.match(re);
        if (!m) return;
        const at = Math.max(0, m.index - 30);
        out.push({ label, line: i + 1, excerpt: line.slice(at, m.index + m[0].length + 30).trim() });
      });
    });
  return out;
}

/** 匯出後的替身：規則都已套用完，公開版本身不需要再轉換 */
export const STUB_SOURCE = `/**
 * 去識別規則（公開版替身）：這份原始碼已經是去識別後的版本，因此規則為空。
 * 公開版建置、原始碼匯出與外洩檢查仍可照常執行。
 */

/** @type {Array<[RegExp, string]>} */
export const RULES = [];

export const FORBIDDEN = [];

export function deidentify(text) {
  return String(text);
}

export function findLeaks() {
  return [];
}

export const STUB_SOURCE = '';
`;
