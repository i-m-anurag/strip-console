// Runs the transform over real published code in node_modules and fails if any output no longer
// parses, or if a second pass still finds something to remove. Run `pnpm build` first.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, relative } from 'node:path';
import { parseSync } from 'oxc-parser';
import { glob } from 'tinyglobby';
import { transform } from '../dist/index.mjs';

const PACKAGES = [
  'typescript',
  'webpack',
  'rollup',
  'vite',
  'rolldown',
  '@rspack/core',
  'magic-string',
];
const METHODS = [
  'log',
  'debug',
  'info',
  'trace',
  'warn',
  'error',
  'table',
  'dir',
  'group',
  'groupEnd',
  'time',
  'timeEnd',
  'assert',
  'count',
];

const require = createRequire(import.meta.url);
const failures = [];
let files = 0;
let removed = 0;
let bytes = 0;
const started = performance.now();

for (const name of PACKAGES) {
  const root = dirname(require.resolve(`${name}/package.json`));
  const paths = await glob('**/*.{js,mjs,cjs}', {
    cwd: root,
    absolute: true,
    ignore: ['**/node_modules/**'],
  });
  for (const file of paths) {
    const code = await readFile(file, 'utf8');
    const filename = file;
    // Only code the parser accepts as-is is a fair test.
    if (parseSync(filename, code).errors.length > 0) continue;
    files++;
    bytes += code.length;
    const where = relative(process.cwd(), file);
    try {
      const first = transform(code, { filename, methods: METHODS, sourcemap: false });
      removed += first.removed.length;
      const errors = parseSync(filename, first.code).errors;
      if (errors.length > 0) {
        failures.push(`${where}: output does not parse: ${errors[0]?.message}`);
        continue;
      }
      const second = transform(first.code, { filename, methods: METHODS, sourcemap: false });
      if (second.removed.length > 0) {
        failures.push(`${where}: second pass removed ${second.removed.length} more call(s)`);
      }
    } catch (error) {
      failures.push(`${where}: ${error.message}`);
    }
  }
}

const seconds = ((performance.now() - started) / 1000).toFixed(1);
console.log(
  `Fuzzed ${files} files (${(bytes / 1e6).toFixed(1)} MB) in ${seconds}s, removed ${removed} calls.`,
);
for (const failure of failures) console.error(failure);
if (failures.length > 0) process.exitCode = 1;
