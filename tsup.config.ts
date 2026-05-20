import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'cli/index': 'src/cli/index.ts',
  },
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  target: 'es2022',
  platform: 'node',
  external: [
    '@mariozechner/pi-ai',
    '@mariozechner/pi-coding-agent',
    '@mariozechner/pi-tui',
    'typebox',
    '@sinclair/typebox',
    'proper-lockfile',
    'better-sqlite3',
  ],
});
