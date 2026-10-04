# strip-console

## 1.0.0

### Major Changes

- 3b4c6b9: First stable release. The options, entry points, CLI flags and exit codes, and report shapes now follow semantic versioning, as described in the README's Versioning section.
- dfa1cb9: Options are now validated. An unknown option or a value of the wrong type throws a `TypeError` that names it and suggests the right name for a typo, instead of being silently ignored. The CLI prints the error, names the config file, and exits with code 2.

## 0.2.0

### Minor Changes

- 29985e6: Add the `runtimeGuard` plugin option, which adds a small script to each entry chunk that turns the removed console methods into no-ops at runtime. It catches calls static analysis cannot see, such as `console[name]()`. `createRuntimeGuard(methods)` is also exported for setups without a plugin.

## 0.1.0

### Minor Changes

- ce5eb64: First release: the `transform` API, plugins for Vite, Rollup, Rolldown, webpack, Rspack and esbuild, and the `strip-console` CLI with an `audit` command.
