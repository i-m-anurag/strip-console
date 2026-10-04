// Compares strip-console with esbuild `drop`, Terser `drop_console` and
// babel-plugin-transform-remove-console: what each one outputs on tricky cases, and how long each
// takes over the same real-world files the fuzz check uses. Run `pnpm build` first.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { transformSync as babel } from '@babel/core';
import { transformSync as esbuild } from 'esbuild';
import { parseSync } from 'oxc-parser';
import { minify_sync as terser } from 'terser';
import { glob } from 'tinyglobby';
import { transform } from '../dist/index.mjs';

const require = createRequire(import.meta.url);
const removeConsole = require.resolve('babel-plugin-transform-remove-console');
const METHODS = ['log', 'debug', 'info', 'trace'];

const TOOLS = {
  'strip-console': (code, filename) =>
    transform(code, { filename, methods: METHODS, sourcemap: false }).code,
  'esbuild drop': (code) => esbuild(code, { drop: ['console'], loader: 'js' }).code,
  'terser drop_console': (code) =>
    terser(code, {
      compress: { defaults: false, drop_console: METHODS },
      mangle: false,
      format: { beautify: true },
    }).code,
  'babel remove-console': (code, filename) =>
    babel(code, {
      filename,
      babelrc: false,
      configFile: false,
      compact: false,
      plugins: [[removeConsole, { exclude: ['warn', 'error'] }]],
    }).code,
};

const CASES = [
  ['side effect in argument', 'console.log(i++);'],
  ['call used as a value', 'const done = () => console.log("done");'],
  ['warn is kept', 'console.warn("slow");'],
  ['keep comment', '/* keep */ console.log("build id");'],
  ['local variable named console', 'function f(console) { console.log(1); }'],
  ['destructured alias', 'const { log } = console;\nlog("aliased");'],
];

function oneLine(code) {
  const text = code.replace(/\s+/g, ' ').trim();
  return text === '' ? '(removed)' : text;
}

console.log('## Output on tricky cases\n');
for (const [label, input] of CASES) {
  console.log(`${label}: ${input.replace(/\n/g, ' ')}`);
  for (const [name, run] of Object.entries(TOOLS)) {
    let out;
    try {
      out = oneLine(run(input, 'case.js'));
    } catch (error) {
      out = `error: ${error.message.split('\n')[0]}`;
    }
    console.log(`  ${name.padEnd(22)} ${out}`);
  }
}

const PACKAGES = [
  'typescript',
  'webpack',
  'rollup',
  'vite',
  'rolldown',
  '@rspack/core',
  'magic-string',
];
const corpus = [];
for (const name of PACKAGES) {
  const root = dirname(require.resolve(`${name}/package.json`));
  const paths = await glob('**/*.{js,mjs,cjs}', {
    cwd: root,
    absolute: true,
    ignore: ['**/node_modules/**'],
  });
  for (const file of paths) {
    const code = await readFile(file, 'utf8');
    // Scripts only, so every tool parses the same input.
    if (parseSync('x.cjs', code, { sourceType: 'script' }).errors.length > 0) continue;
    corpus.push({ file, code });
  }
}
const megabytes = corpus.reduce((sum, f) => sum + f.code.length, 0) / 1e6;

console.log(`\n## Time over ${corpus.length} files (${megabytes.toFixed(1)} MB), best of 3\n`);
for (const [name, run] of Object.entries(TOOLS)) {
  let best = Number.POSITIVE_INFINITY;
  let failed = 0;
  for (let round = 0; round < 3; round++) {
    failed = 0;
    const start = performance.now();
    for (const { file, code } of corpus) {
      try {
        run(code, file);
      } catch {
        failed++;
      }
    }
    best = Math.min(best, performance.now() - start);
  }
  const note = failed > 0 ? ` (${failed} files failed)` : '';
  console.log(`  ${name.padEnd(22)} ${(best / 1000).toFixed(2)}s${note}`);
}
