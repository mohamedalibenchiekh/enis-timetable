import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: __dirname,
  esbuild: { tsconfigRaw: { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } } },
  test: {
    include: ['test/visual/visual.spec.ts'],
    environment: 'node',
    testTimeout: 180_000,
  },
});
