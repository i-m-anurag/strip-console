# strip-console

Strip `console.*` calls from JavaScript and TypeScript code.

> Early release. The API is not stable yet.

## Install

```bash
npm install strip-console
```

## Bundler plugin

```js
// vite.config.js
import stripConsole from 'strip-console/vite';

export default { plugins: [stripConsole()] };
```

| Bundler | Import |
| --- | --- |
| Vite | `strip-console/vite` (production builds only) |
| Rollup | `strip-console/rollup` |
| Rolldown | `strip-console/rolldown` |
| webpack | `strip-console/webpack` |
| Rspack | `strip-console/rspack` |
| esbuild | `strip-console/esbuild` |

The plugin takes the options below plus `include`, `exclude` (default: skip `node_modules`) and
`chunks`. With `chunks: true`, Vite, Rollup and Rolldown also process the final output, which
catches console calls from dependencies and compiled framework files.

## Usage

```js
import { transform } from 'strip-console';

const { code, map, removed } = transform(source, { filename: 'src/app.ts' });
```

By default `console.log`, `debug`, `info` and `trace` calls and `debugger` statements are removed;
`console.warn` and `console.error` stay. Arguments with side effects are kept, so
`console.log(i++)` becomes `i++`. A call preceded by `/* keep */` is left alone.

| Option | Default | Meaning |
| --- | --- | --- |
| `methods` | `['log', 'debug', 'info', 'trace']` | Console methods to remove |
| `loggers` | `[]` | Extra callees to remove, such as `'logger.debug'` |
| `keepComment` | `'keep'` | Comment text that preserves the next call |
| `debugger` | `true` | Also remove `debugger` statements |
| `sourcemap` | `true` | Return a source map |
| `filename` | `'input.js'` | Picks the parser (js, jsx, ts, tsx) and names the map source |

Removing console calls hides output in browser DevTools. It does not protect secrets: anything in
your bundle or sent over the network is still readable.

## Development

Requires Node.js 22 or newer and pnpm.

```bash
pnpm install
pnpm test        # vitest
pnpm lint        # biome
pnpm typecheck   # tsc --noEmit
pnpm build       # tsdown -> dist/ (ESM, CJS, types)
```

## License

MIT
