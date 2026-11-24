import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts so vitest's bundled vite types never collide with
// the plugin types used by the app build.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
