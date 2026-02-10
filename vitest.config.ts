import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: [
      'node_modules/**',
      'dist/**',
      'build/**',
      '.next/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      'e2e/**',
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/**/*.{ts,tsx}', 'apps/**/*.{ts,tsx}'],
      exclude: [
        'node_modules',
        'dist',
        'build',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        '**/node_modules/**',
        'e2e/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '@gird/core': path.resolve(__dirname, './packages/core/src'),
      '@gird/server': path.resolve(__dirname, './packages/server/src'),
      '@gird/cli': path.resolve(__dirname, './packages/cli/src'),
      '@gird/dashboard': path.resolve(__dirname, './packages/dashboard/src'),
    },
  },
});
