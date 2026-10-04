import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: ['src/index.ts'],
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
