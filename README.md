# strip-console

Strip `console.*` calls from JavaScript and TypeScript code.

> Early release. The API is not stable yet.

## Install

```bash
npm install strip-console
```

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
