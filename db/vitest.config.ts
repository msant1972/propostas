import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['spikes/**/*.test.ts', 'test/**/*.test.ts'], testTimeout: 30_000 },
});
