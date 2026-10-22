import { defineConfig } from 'vite';
import { deidentify } from './scripts/deidentify-rules.mjs';

/** 公開版：src 與 index.html 的文字在建置時套用去識別規則（node_modules 不動） */
function deidentifyPlugin() {
  return {
    name: 'call-coach-deidentify',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0];
      if (file.includes('/node_modules/') || !/\.(m?js|css)$/.test(file)) return null;
      const out = deidentify(code);
      return out === code ? null : { code: out, map: null };
    },
    transformIndexHtml: (html) => deidentify(html),
  };
}

export default defineConfig(({ mode }) => {
  const isPublic = mode === 'public';
  return {
    // 一律用相對路徑，dist/ 可直接開、vite preview 也能跑；GitHub Pages 在 deploy-pages.yml 以 --base=/For-company-business-use/ 指定
    base: './',
    plugins: isPublic ? [deidentifyPlugin()] : [],
    build: {
      outDir: isPublic ? 'dist-public' : 'dist',
      rollupOptions: {
        input: {
          main: 'index.html',
        },
      },
    },
  };
});
