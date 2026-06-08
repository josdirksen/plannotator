import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import pkg from '../../package.json';

export default defineConfig({
  server: {
    port: 3003,
    host: '0.0.0.0',
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // Explicit .css subpath aliases (mirror the frontend) so the shared
      // design system and code-review styles resolve deterministically.
      '@plannotator/ui/design-system.css': path.resolve(__dirname, '../../packages/ui/design-system.css'),
      '@plannotator/ui': path.resolve(__dirname, '../../packages/ui'),
      '@plannotator/shared': path.resolve(__dirname, '../../packages/shared'),
      '@plannotator/code-review/styles': path.resolve(__dirname, '../../packages/plannotator-code-review/index.css'),
      '@plannotator/code-review': path.resolve(__dirname, '../../packages/plannotator-code-review/App.tsx'),
    },
  },
  build: {
    target: 'esnext',
  },
});
