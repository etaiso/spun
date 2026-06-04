import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // Mirror the tsconfig `@/*` -> `./*` alias so tests can import modules
  // (e.g. API route handlers) that use the `@/` prefix.
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
