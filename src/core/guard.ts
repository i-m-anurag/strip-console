import { MagicString } from 'magic-string';
import { DEFAULT_METHODS } from './options';

/**
 * Source of a small script that turns the given `console` methods into no-ops at runtime. It
 * catches calls static analysis cannot see, such as `console[name]()`, and also silences calls a
 * `keep` comment preserved.
 */
export function createRuntimeGuard(methods: readonly string[] = DEFAULT_METHODS): string {
  return (
    '(function(){var c=typeof console!=="undefined"?console:void 0;if(!c)return;' +
    `var n=function(){};${JSON.stringify(methods)}.forEach(function(m){` +
    'if(typeof c[m]==="function")c[m]=n})})();\n'
  );
}

/** Hashbang and a leading `'use strict'` directive, which must stay at the top of the file. */
const PREAMBLE = /^(?:#![^\n]*\n)?(?:\s*(['"])use strict\1;?[ \t]*\n?)?/;

/** Insert `guard` at the top of `code`, after any hashbang or `'use strict'` directive. */
export function prependGuard(
  code: string,
  guard: string,
  filename: string,
): { code: string; map: ReturnType<MagicString['generateMap']> } {
  const s = new MagicString(code);
  s.appendRight(PREAMBLE.exec(code)?.[0].length ?? 0, guard);
  return {
    code: s.toString(),
    map: s.generateMap({ source: filename, hires: 'boundary', includeContent: true }),
  };
}
