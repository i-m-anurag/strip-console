---
"strip-console": minor
---

Add the `runtimeGuard` plugin option, which adds a small script to each entry chunk that turns the removed console methods into no-ops at runtime. It catches calls static analysis cannot see, such as `console[name]()`. `createRuntimeGuard(methods)` is also exported for setups without a plugin.
