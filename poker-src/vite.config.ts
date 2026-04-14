import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/main.ts'),
      name: 'Poker',
      formats: ['iife'],
      fileName: () => 'poker.js',
    },
    outDir: resolve(__dirname, '../static/poker'),
    emptyOutDir: false,
    sourcemap: true,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        extend: true,
      },
    },
  },
});
