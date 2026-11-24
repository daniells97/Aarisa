import 'dotenv/config';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    environment: 'node',
    // Database tests share one dev database; each runs in a rolled-back transaction.
    fileParallelism: false,
    // Some database tests build a whole payroll; on a busy server they can pass 5 s.
    testTimeout: 15_000,
  },
});
