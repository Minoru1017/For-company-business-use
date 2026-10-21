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

export default defineConfig(({ command, mode }) => {
  const isPublic = mode === 'public';
  return {
    // GitHub Pages: /For-company-business-use/  |  本機開 dist/ 與公開版: ./
    base: command === 'build' && process.env.GITHUB_ACTIONS && !isPublic ? '/For-company-business-use/' : './',
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
