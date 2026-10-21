/** 版本：一般建置是公司版；`vite build --mode public` 產生去識別公開版（文字替換見 scripts/deidentify-rules.mjs） */
function viteMode() {
  try {
    return import.meta.env?.MODE || '';
  } catch {
    return '';
  }
}

export const EDITION = viteMode() === 'public' ? 'public' : 'company';
