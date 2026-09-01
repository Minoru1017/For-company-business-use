import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // GitHub Pages: /For-company-business-use/  |  本機開 dist/: ./
  base: command === 'build' && process.env.GITHUB_ACTIONS ? '/For-company-business-use/' : './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: 'index.html',
    },
  },
}));
