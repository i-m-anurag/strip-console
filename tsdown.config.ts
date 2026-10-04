import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: [
      'src/index.ts',
      'src/vite.ts',
      'src/rollup.ts',
      'src/rolldown.ts',
      'src/webpack.ts',
      'src/rspack.ts',
      'src/esbuild.ts',
    ],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    target: 'node22',
  },
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    dts: false,
    target: 'node22',
    banner: { js: '#!/usr/bin/env node' },
  },
]);
