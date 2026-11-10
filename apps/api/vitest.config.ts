import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: __dirname,
  esbuild: { tsconfigRaw: { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } } },
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    exclude: ['test/fixtures/**', 'test/visual/**'],
    coverage: {
      provider: 'v8',
      include: ['src/parser/html-parser.ts', 'src/export/**/*.ts'],
      reporter: ['text', 'lcov'],
      thresholds: { lines: 90 },
    },
    testTimeout: 20_000,
  },
});
