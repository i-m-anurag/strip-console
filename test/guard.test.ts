import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { rspack } from '@rspack/core';
import { build as esbuild } from 'esbuild';
import { rolldown } from 'rolldown';
import { rollup } from 'rollup';
import { build as vite } from 'vite';
import { describe, expect, it } from 'vitest';
import webpack from 'webpack';
import { createRuntimeGuard, prependGuard } from '../src/core/guard';
import stripEsbuild from '../src/esbuild';
import stripRolldown from '../src/rolldown';
import stripRollup from '../src/rollup';
import stripRspack from '../src/rspack';
import stripVite from '../src/vite';
import stripWebpack from '../src/webpack';

const entry = resolve(__dirname, 'fixtures/guard/index.js');

/** Run `code` as a script with a recording console and return the methods it called. */
function run(code: string): string[] {
  const calls: string[] = [];
  const record = (name: string) => () => calls.push(name);
  const console = { log: record('log'), debug: record('debug'), warn: record('warn') };
  runInNewContext(code, { console });
  return calls;
}

function expectGuarded(code: string): void {
  expect(run(code)).toEqual(['warn']);
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

async function inTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'strip-console-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('createRuntimeGuard', () => {
  it('silences the listed methods and leaves the others', () => {
    expect(
      run(`${createRuntimeGuard(['log'])}console.log(1);console.debug(2);console.warn(3);`),
    ).toEqual(['debug', 'warn']);
  });

  it('does nothing when console is missing', () => {
    expect(() => runInNewContext(createRuntimeGuard(), {})).not.toThrow();
  });

  it('goes after a hashbang and a use strict directive', () => {
    const { code } = prependGuard(
      "#!/usr/bin/env node\n'use strict';\nrun();\n",
      'GUARD;\n',
      'a.js',
    );
    expect(code).toBe("#!/usr/bin/env node\n'use strict';\nGUARD;\nrun();\n");
  });

  it('shifts the source map by the inserted lines', () => {
    const { map } = prependGuard('run();\n', 'GUARD;\n', 'a.js');
    expect(map.mappings.startsWith(';')).toBe(true);
  });
});

describe('runtimeGuard plugin option', { timeout: 30_000 }, () => {
  it('is off by default', async () => {
    const bundle = await rollup({ input: entry, plugins: [stripRollup()] });
    const { output } = await bundle.generate({ format: 'es' });
    expect(run(output[0].code)).toEqual(['log', 'warn']);
  });

  it('vite', async () => {
    const result = await vite({
      logLevel: 'silent',
      configFile: false,
      plugins: [stripVite({ runtimeGuard: true })],
      build: { write: false, minify: false, rollupOptions: { input: entry } },
    });
    const output = Array.isArray(result) ? result[0] : result;
    if (!output || !('output' in output)) throw new Error('unexpected vite result');
    expectGuarded(output.output[0].code);
  });

  it('rollup, with chunks: true and a chained source map', async () => {
    const bundle = await rollup({
      input: entry,
      plugins: [stripRollup({ runtimeGuard: true, chunks: true, exclude: /guard/ })],
    });
    const { output } = await bundle.generate({ format: 'cjs', sourcemap: true });
    expect(output[0].code.startsWith("'use strict';\n")).toBe(true);
    expectGuarded(output[0].code);
    // The warn call is on line 5 of the source; the guard and 'use strict' push it down in the output.
    const { code, map } = output[0];
    if (!map) throw new Error('missing source map');
    const line = code.split('\n').findIndex((l) => l.includes("'warn stays'")) + 1;
    const original = originalPositionFor(new TraceMap(map.toString()), { line, column: 0 });
    expect(original.source).toMatch(/fixtures\/guard\/index\.js$/);
    expect(original.line).toBe(5);
  });

  it('rolldown', async () => {
    const bundle = await rolldown({
      input: entry,
      plugins: [stripRolldown({ runtimeGuard: true })],
    });
    const { output } = await bundle.generate({ format: 'es' });
    expectGuarded(output[0].code);
  });

  it('esbuild', async () => {
    const result = await esbuild({
      entryPoints: [entry],
      bundle: true,
      write: false,
      logLevel: 'silent',
      plugins: [stripEsbuild({ runtimeGuard: true })],
    });
    expectGuarded(result.outputFiles[0]?.text ?? '');
  });

  it('webpack', async () => {
    await inTempDir(async (dir) => {
      const compiler = webpack({
        mode: 'production',
        entry,
        output: { path: dir, filename: 'out.js' },
        optimization: { minimize: false },
        plugins: [stripWebpack({ runtimeGuard: true })],
      });
      await runCompiler(compiler as unknown as Compiler);
      expectGuarded(await readFile(join(dir, 'out.js'), 'utf8'));
    });
  });

  it('rspack', async () => {
    await inTempDir(async (dir) => {
      const compiler = rspack({
        mode: 'production',
        entry,
        output: { path: dir, filename: 'out.js' },
        optimization: { minimize: false },
        plugins: [stripRspack({ runtimeGuard: true })],
      });
      await runCompiler(compiler as unknown as Compiler);
      expectGuarded(await readFile(join(dir, 'out.js'), 'utf8'));
    });
  });
});
