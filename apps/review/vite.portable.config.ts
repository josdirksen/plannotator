import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import pkg from '../../package.json';
import { PORTABLE_GUIDED_REVIEW_ASSET_BASE_URL } from '../../packages/shared/guide-export';

const viewerAssetPath = new URL(PORTABLE_GUIDED_REVIEW_ASSET_BASE_URL).pathname.replace(/^\/+/, '');

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      '@plannotator/shared': path.resolve(__dirname, '../../packages/shared'),
      '@plannotator/ui': path.resolve(__dirname, '../../packages/ui'),
      '@plannotator/review-editor/styles': path.resolve(__dirname, '../../packages/review-editor/index.css'),
      '@plannotator/review-editor/worker-pool': path.resolve(__dirname, '../../packages/review-editor/workerPool.tsx'),
      '@plannotator/review-editor': path.resolve(__dirname, '../../packages/review-editor/App.tsx'),
    },
  },
  build: {
    target: 'esnext',
    assetsInlineLimit: 100_000_000,
    outDir: path.resolve(__dirname, '../marketing/dist', viewerAssetPath),
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: path.resolve(__dirname, 'portable.tsx'),
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'viewer.js',
        assetFileNames: (assetInfo) => assetInfo.names.some((name) => name.endsWith('.css'))
          ? 'viewer.css'
          : 'assets/[name]-[hash][extname]',
      },
    },
  },
});
