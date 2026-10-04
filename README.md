# strip-console

Strip `console.*` calls and `debugger` statements from JavaScript and TypeScript code, without
breaking the code around them.

> Early release. The API is not stable yet.

```js
// before
console.log('user', user);
console.log(i++);
const done = () => console.log('done');
console.warn('slow');

// after
i++;
const done = () => void 0;
console.warn('slow');
```

- Works as a plugin for Vite, Rollup, Rolldown, webpack, Rspack and esbuild.
- Ships a CLI that rewrites a build folder in place, or audits it in CI.
- Keeps arguments with side effects, keeps `console.warn` and `console.error` by default, and
  produces source maps.

## Contents

- [Install](#install)
- [Bundler plugin](#bundler-plugin)
- [CLI](#cli)
- [Audit in CI](#audit-in-ci)
- [What gets removed](#what-gets-removed)
- [Options](#options)
- [JavaScript API](#javascript-api)
- [Compared with other tools](#compared-with-other-tools)
- [Development](#development)

## Install

```bash
npm install --save-dev strip-console
```

Requires Node.js 22.12 or newer.

## Bundler plugin

Every entry exports one function that takes the [options](#options) below.

### Vite

```js
// vite.config.js
import { defineConfig } from 'vite';
import stripConsole from 'strip-console/vite';

export default defineConfig({
  plugins: [stripConsole()],
});
```

The Vite plugin only runs during `vite build`, so `console.log` still works in the dev server.

### Rollup

```js
// rollup.config.js
import stripConsole from 'strip-console/rollup';

export default {
  input: 'src/index.js',
  output: { dir: 'dist' },
  plugins: [stripConsole()],
};
```

### Rolldown

```js
// rolldown.config.js
import stripConsole from 'strip-console/rolldown';

export default {
  input: 'src/index.js',
  plugins: [stripConsole()],
};
```

### webpack

```js
// webpack.config.js
const stripConsole = require('strip-console/webpack');

module.exports = (env, argv) => ({
  entry: './src/index.js',
  plugins: argv.mode === 'production' ? [stripConsole()] : [],
});
```

### Rspack

```js
// rspack.config.js
const stripConsole = require('strip-console/rspack');

module.exports = (env, argv) => ({
  entry: './src/index.js',
  plugins: argv.mode === 'production' ? [stripConsole()] : [],
});
```

The webpack and Rspack plugins run in every mode, so add them only to production builds as shown.

### esbuild

```js
// build.mjs
import { build } from 'esbuild';
import stripConsole from 'strip-console/esbuild';

await build({
  entryPoints: ['src/index.js'],
  bundle: true,
  outdir: 'dist',
  plugins: [stripConsole()],
});
```

### Plugin-only options

| Option | Default | Meaning |
| --- | --- | --- |
| `include` | JS, TS, JSX, TSX, `.vue`, `.svelte`, `.astro` | Modules to process |
| `exclude` | `node_modules` | Modules to skip |
| `chunks` | `false` | Also process the final output chunks (Vite, Rollup and Rolldown only) |

By default the plugin skips `node_modules`. Set `chunks: true` to also clean the bundled output,
which catches console calls in dependencies and in compiled framework files. Files that fail to
parse are skipped with a warning instead of failing the build.

## CLI

The CLI works on files that are already built, so it fits any toolchain, including ones without a
plugin hook.

```bash
npx strip-console dist/            # rewrite .js/.mjs/.cjs files in place
npx strip-console dist/ --dry-run  # show what would change without writing
npx strip-console audit dist/      # list remaining calls; exits 1 if any are found
npx strip-console audit dist/ --json
```

With no folder given, both commands use `dist`. When a file has a `.map` next to it, the rewrite
updates the map so it still points at your original sources.

| Flag | Meaning |
| --- | --- |
| `--methods <list>` | Console methods to remove, such as `log,debug` |
| `--loggers <list>` | Extra callees to remove, such as `logger.debug` |
| `--keep-comment <text>` | Comment text that keeps the next call |
| `--no-debugger` | Keep `debugger` statements |
| `--include <glob>` | Files to process (default `**/*.{js,mjs,cjs}`) |
| `--exclude <glob>` | Files to skip (default `**/node_modules/**`) |
| `--config <file>` | Read settings from this file |
| `--json` | Print a machine-readable report |
| `--dry-run` | Rewrite command only: report without writing |

### Config file

Settings can live in `strip-console.config.json`, `strip-console.config.mjs`,
`strip-console.config.js`, or a `"stripConsole"` key in `package.json`. Flags override the file.

```json
{
  "dirs": ["dist", "build/public"],
  "methods": ["log", "debug", "info", "trace"],
  "loggers": ["logger.debug"],
  "exclude": ["**/vendor/**"]
}
```

## Audit in CI

`strip-console audit` exits with code 1 when any console call is left, so it can guard a build
even if you never rewrite files.

```yaml
# .github/workflows/ci.yml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run build
      - run: npx strip-console audit dist/
```

A failing run prints one line per call, so the log shows exactly where to look:

```text
dist/assets/index-B7x2.js:1:2041  console.log
dist/assets/index-B7x2.js:1:5310  debugger
Found 2 console calls in 1 file.
```

The same check works as a script in `package.json`:

```json
{
  "scripts": {
    "build": "vite build",
    "postbuild": "strip-console audit dist/"
  }
}
```

Use `--json` to feed the report into another tool. It contains `scanned`, `calls`, a `files` list
with each call's method, line and column, and an `errors` list for files that could not be parsed.

## What gets removed

With the default options:

| Input | Output |
| --- | --- |
| `console.log('ready');` | *(line removed)* |
| `console.log(i++);` | `i++;` |
| `console.log(await load());` | `await load();` |
| `if (debug) console.log(state);` | `if (debug) ;` |
| `const done = () => console.log('done');` | `const done = () => void 0;` |
| `console?.log?.(x);` | *(line removed)* |
| `window.console.info('hi');` | *(line removed)* |
| `const { log } = console; log('x');` | *(both removed)* |
| `debugger;` | *(line removed)* |
| `console.warn('slow');` | unchanged |
| `/* keep */ console.log('build id', id);` | unchanged |

Calls through `globalThis`, `self` and `global` are matched too, as long as `console` or those names
are not redeclared locally. A local variable named `console` is never touched.

## Options

These apply to the plugin, the CLI and the JavaScript API.

| Option | Default | Meaning |
| --- | --- | --- |
| `methods` | `['log', 'debug', 'info', 'trace']` | Console methods to remove |
| `loggers` | `[]` | Extra callees to remove, such as `'logger.debug'` |
| `keepComment` | `'keep'` | Comment text that preserves the next call |
| `debugger` | `true` | Also remove `debugger` statements |
| `sourcemap` | `true` | Return a source map (API only) |
| `filename` | `'input.js'` | Picks the parser and names the map source (API only) |

## JavaScript API

```js
import { transform, auditFiles, stripFiles } from 'strip-console';

// One string of code
const { code, map, removed } = transform(source, { filename: 'src/app.ts' });

// Whole folders, the same work the CLI does
const report = await auditFiles(['dist'], { methods: ['log'] });
await stripFiles(['dist'], { dryRun: true });
```

`transform` throws a `SyntaxError` when the code does not parse. `removed` lists each removed call
with its method, 1-based line and 0-based column.

## Compared with other tools

- **esbuild `drop: ['console']`** removes every console method, including `warn` and `error`,
  and drops their arguments, so `console.log(i++)` also loses the `i++`.
- **Terser `drop_console`** only runs when you minify, and it also drops arguments, so
  `console.log(i++)` loses the `i++` there too.
- **strip-console** chooses methods, keeps side effects, works in unminified builds, and can audit
  output you did not build yourself.

Removing console calls hides output in browser DevTools. It does not protect secrets: anything in
your bundle or sent over the network is still readable.

## Development

Requires Node.js 22.12 or newer and pnpm.

```bash
pnpm install
pnpm test        # vitest
pnpm lint        # biome
pnpm typecheck   # tsc --noEmit
pnpm build       # tsdown -> dist/ (ESM, CJS, types)
```

## License

MIT
