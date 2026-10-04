import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { rspack } from '@rspack/core';
import { build as esbuild } from 'esbuild';
import { rolldown } from 'rolldown';
import { rollup } from 'rollup';
import { build as vite } from 'vite';
import { describe, expect, it } from 'vitest';
import webpack from 'webpack';
import stripEsbuild from '../src/esbuild';
import stripRolldown from '../src/rolldown';
import stripRollup from '../src/rollup';
import stripRspack from '../src/rspack';
import stripVite from '../src/vite';
import stripWebpack from '../src/webpack';

const root = resolve(__dirname, 'fixtures/app');
const entry = join(root, 'index.js');

function expectStripped(code: string): void {
  expect(code).not.toContain('main called');
  expect(code).not.toContain('greeting');
  expect(code).toContain('errors stay');
  expect(code).toContain('kept on purpose');
  expect(code).toContain('hello');
}

async function inTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'strip-console-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

type Compiler = {
  run: (
    cb: (err: Error | null, stats?: { hasErrors(): boolean; toString(): string }) => void,
  ) => void;
};

function runCompiler(compiler: Compiler): Promise<void> {
  return new Promise((done, fail) => {
    compiler.run((err, stats) => {
      if (err) fail(err);
      else if (stats?.hasErrors()) fail(new Error(stats.toString()));
      else done();
    });
  });
}

describe('bundler plugins', { timeout: 30_000 }, () => {
  it('vite', async () => {
    const result = await vite({
      root,
      logLevel: 'silent',
      configFile: false,
      plugins: [stripVite()],
      build: { write: false, minify: false, lib: { entry, formats: ['es'], fileName: 'out' } },
    });
    const output = Array.isArray(result) ? result[0] : result;
    if (!output || !('output' in output)) throw new Error('unexpected vite result');
    expectStripped(output.output[0].code);
  });

  it('rollup', async () => {
    const bundle = await rollup({ input: entry, plugins: [stripRollup()] });
    const { output } = await bundle.generate({ format: 'es' });
    expectStripped(output[0].code);
  });

  it('rollup with chunks: true also strips excluded modules', async () => {
    const bundle = await rollup({
      input: entry,
      plugins: [stripRollup({ exclude: /util/, chunks: true })],
    });
    const { output } = await bundle.generate({ format: 'es' });
    expectStripped(output[0].code);
  });

  it('rolldown', async () => {
    const bundle = await rolldown({ input: entry, plugins: [stripRolldown()] });
    const { output } = await bundle.generate({ format: 'es' });
    expectStripped(output[0].code);
  });

  it('esbuild', async () => {
    const result = await esbuild({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: 'esm',
      logLevel: 'silent',
      plugins: [stripEsbuild()],
    });
    expectStripped(result.outputFiles[0]?.text ?? '');
  });

  it('webpack', async () => {
    await inTempDir(async (dir) => {
      const compiler = webpack({
        mode: 'production',
        entry,
        output: { path: dir, filename: 'out.js', library: { type: 'module' } },
        experiments: { outputModule: true },
        optimization: { minimize: false },
        plugins: [stripWebpack()],
      });
      await runCompiler(compiler as unknown as Compiler);
      expectStripped(await readFile(join(dir, 'out.js'), 'utf8'));
    });
  });

  it('rspack', async () => {
    await inTempDir(async (dir) => {
      const compiler = rspack({
        mode: 'production',
        entry,
        output: { path: dir, filename: 'out.js', library: { type: 'module' } },
        optimization: { minimize: false },
        plugins: [stripRspack()],
      });
      await runCompiler(compiler as unknown as Compiler);
      expectStripped(await readFile(join(dir, 'out.js'), 'utf8'));
    });
  });
});
