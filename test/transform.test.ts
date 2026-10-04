import { parseSync } from 'oxc-parser';
import { describe, expect, it } from 'vitest';
import { DEFAULT_METHODS, type StripConsoleOptions, transform } from '../src/index';

function strip(code: string, options: StripConsoleOptions = {}): string {
  const out = transform(code, options).code;
  const reparsed = parseSync(options.filename ?? 'input.js', out);
  expect(reparsed.errors, `output does not parse:\n${out}`).toEqual([]);
  return out;
}

describe('edge cases from the design doc', () => {
  const cases: [name: string, input: string, output: string, options?: StripConsoleOptions][] = [
    ['statement', 'a();\nconsole.log(x);\nb();\n', 'a();\nb();\n'],
    ['expression position', 'a && console.log(x);', 'a && void 0;'],
    ['arrow body', 'const f = () => console.log(x);', 'const f = () => void 0;'],
    ['side-effect arguments', 'console.log(i++, f());', 'i++, f();'],
    ['side-effect arguments in expression', 'a && console.log(i++, x);', 'a && (i++, void 0);'],
    [
      'awaited argument',
      'async function g() {\n  console.log(await load());\n}',
      'async function g() {\n  await load();\n}',
    ],
    ['destructured alias', 'const { log } = console;\nlog(x);\nrun();\n', 'run();\n'],
    [
      'partly destructured alias',
      'const { log, warn } = console;\nlog(x);\nwarn(y);\n',
      'const { warn } = console;\nwarn(y);\n',
    ],
    ['member alias', 'const out = console.log;\nout(1);\n', ''],
    ['window.console', 'window.console.log(x);\nrun();', 'run();'],
    ['globalThis computed', "globalThis.console['log'](x);\nrun();", 'run();'],
    ['optional chaining', 'console?.log?.(x);\nrun();', 'run();'],
    ['optional chaining in expression', 'a || console.log?.(x);', 'a || void 0;'],
    ['wrapper logger not listed', 'logger.debug(x);', 'logger.debug(x);'],
    ['wrapper logger listed', 'logger.debug(x);\nrun();', 'run();', { loggers: ['logger.debug'] }],
    ['keep comment', '/* keep */ console.log(e);', '/* keep */ console.log(e);'],
    [
      'custom keep comment',
      '// @preserve\nconsole.log(e);',
      '// @preserve\nconsole.log(e);',
      { keepComment: '@preserve' },
    ],
    [
      'local variable named console',
      'function f(console) {\n  console.log(x);\n}',
      'function f(console) {\n  console.log(x);\n}',
    ],
    [
      'block-scoped console',
      '{\n  const console = makeLogger();\n  console.log(x);\n}\nconsole.log(y);\n',
      '{\n  const console = makeLogger();\n  console.log(x);\n}\n',
    ],
    ['sole statement in a branch', 'if (dev) console.log(x);', 'if (dev) ;'],
    [
      'method not in list',
      'console.warn(x);\nconsole.error(y);',
      'console.warn(x);\nconsole.error(y);',
    ],
    ['debugger', 'run();\ndebugger;\n', 'run();\n'],
    ['debugger kept when disabled', 'debugger;', 'debugger;', { debugger: false }],
    [
      'custom method list',
      'console.warn(x);\nconsole.log(y);',
      'console.log(y);',
      { methods: ['warn'] },
    ],
  ];

  for (const [name, input, output, options] of cases) {
    it(name, () => {
      expect(strip(input, options)).toBe(output);
    });
  }
});

describe('correctness', () => {
  it('keeps an alias that is used as a value', () => {
    const code = 'const { log } = console;\nlog(1);\nitems.forEach(log);\n';
    expect(strip(code)).toBe(code);
  });

  it('keeps an alias called with a keep comment', () => {
    const code = 'const { log } = console;\n/* keep */ log(1);\nlog(2);\n';
    expect(strip(code)).toBe(code);
  });

  it('removes nested calls inside kept arguments', () => {
    expect(strip('console.log(f(console.log(x)));')).toBe('f(void 0);');
  });

  it('drops pure arguments, including functions that log', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the input is source code containing a template
    expect(strip('console.log(() => console.log(1), "a", x.y, `t${z}`);\nrun();')).toBe('run();');
  });

  it('wraps an object literal so it stays an expression', () => {
    expect(strip('console.log({ a: f() });')).toBe('({ a: f() });');
  });

  it('wraps kept code that starts with a function or object', () => {
    expect(strip('console.log(function () { return 1; }(), x);')).toBe(
      '(function () { return 1; }());',
    );
    expect(strip('console.log({}.toString(), f());')).toBe('({}.toString(), f());');
  });

  it('keeps spread arguments as an array', () => {
    expect(strip('a()\nconsole.log(...xs)')).toBe('a()\n;[...xs];');
  });

  it('adds parentheses where void 0 is an object', () => {
    expect(strip('a(console.log(x).y);')).toBe('a((void 0).y);');
  });

  it('handles TypeScript', () => {
    const code = 'const n: number = 1;\nconsole.log(n as unknown as string);\nexport { n };\n';
    expect(strip(code, { filename: 'a.ts' })).toBe('const n: number = 1;\nexport { n };\n');
  });

  it('handles JSX', () => {
    expect(strip('const el = <div onClick={() => console.log(1)} />;', { filename: 'a.jsx' })).toBe(
      'const el = <div onClick={() => void 0} />;',
    );
  });

  it('handles non-ASCII text before a call', () => {
    expect(strip('const s = "héllo 👋";\nconsole.log(s);\nrun();')).toBe(
      'const s = "héllo 👋";\nrun();',
    );
  });

  it('respects a local window binding', () => {
    const code = 'function f(window) {\n  window.console.log(x);\n}';
    expect(strip(code)).toBe(code);
  });

  it('leaves switch cases valid', () => {
    expect(strip('switch (a) {\n  case 1:\n    console.log(a);\n    break;\n}')).toBe(
      'switch (a) {\n  case 1:\n    break;\n}',
    );
  });
});

describe('result', () => {
  it('reports removed calls with positions', () => {
    const { removed } = transform('run();\n  console.log(1);\ndebugger;\nconsole.info(2);');
    expect(removed).toEqual([
      { method: 'log', line: 2, column: 2 },
      { method: 'debugger', line: 3, column: 0 },
      { method: 'info', line: 4, column: 0 },
    ]);
  });

  it('returns the input untouched when there is nothing to remove', () => {
    const code = 'console.error(e);';
    expect(transform(code)).toEqual({ code, map: null, removed: [] });
  });

  it('generates a source map that maps kept code back to its line', () => {
    const { map } = transform('console.log(1);\nrun();', { filename: 'a.js' });
    expect(map?.sources).toEqual(['a.js']);
    // First segment: output line 1, column 0 comes from input line 2 (`AACA`).
    expect(map?.mappings.startsWith('AACA')).toBe(true);
  });

  it('skips the source map when disabled', () => {
    expect(transform('console.log(1);', { sourcemap: false }).map).toBeNull();
  });

  it('throws on invalid input', () => {
    expect(() => transform('console.log(', { filename: 'bad.js' })).toThrow(
      /failed to parse bad\.js/,
    );
  });

  it('keeps warn and error by default', () => {
    expect(DEFAULT_METHODS).toEqual(['log', 'debug', 'info', 'trace']);
  });
});
