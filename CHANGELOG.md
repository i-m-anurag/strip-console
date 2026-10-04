# strip-console

## 0.2.0

### Minor Changes

- 29985e6: Add the `runtimeGuard` plugin option, which adds a small script to each entry chunk that turns the removed console methods into no-ops at runtime. It catches calls static analysis cannot see, such as `console[name]()`. `createRuntimeGuard(methods)` is also exported for setups without a plugin.

## 0.1.0

### Minor Changes

- ce5eb64: First release: the `transform` API, plugins for Vite, Rollup, Rolldown, webpack, Rspack and esbuild, and the `strip-console` CLI with an `audit` command.
