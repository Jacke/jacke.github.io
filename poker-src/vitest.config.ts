import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    environmentMatchGlobs: [
      ['src/ui/**', 'jsdom'],
      ['src/transports/broadcast.test.ts', 'jsdom'],
    ],
    include: ['src/**/*.test.ts'],
  },
});
