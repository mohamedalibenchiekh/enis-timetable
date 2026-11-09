import { defineConfig } from 'vitest/config';
import * as path from 'node:path';

export default defineConfig({
  root: __dirname,
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': path.resolve(__dirname) } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.tsx', 'test/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
  },
});
