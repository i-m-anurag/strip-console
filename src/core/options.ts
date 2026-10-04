export interface StripConsoleOptions {
  /** Console methods to remove. Default: `['log', 'debug', 'info', 'trace']`. */
  methods?: string[];
  /** Extra callees to remove, written as dotted paths such as `'logger.debug'`. Default: `[]`. */
  loggers?: string[];
  /** Text of a comment that preserves the call right after it, e.g. `/* keep *\/`. Default: `'keep'`. */
  keepComment?: string;
  /** Also remove `debugger` statements. Default: `true`. */
  debugger?: boolean;
  /** Generate a source map. Default: `true`. */
  sourcemap?: boolean;
  /** File name, used to pick the parser language (js, jsx, ts, tsx) and in the source map. */
  filename?: string;
}

export interface ResolvedOptions {
  methods: Set<string>;
  loggers: string[][];
  keepComment: string;
  debugger: boolean;
  sourcemap: boolean;
  filename: string;
}

export const DEFAULT_METHODS: readonly string[] = ['log', 'debug', 'info', 'trace'];

export function resolveOptions(options: StripConsoleOptions = {}): ResolvedOptions {
  return {
    methods: new Set(options.methods ?? DEFAULT_METHODS),
    loggers: (options.loggers ?? []).map((path) => path.split('.')),
    keepComment: options.keepComment ?? 'keep',
    debugger: options.debugger ?? true,
    sourcemap: options.sourcemap ?? true,
    filename: options.filename ?? 'input.js',
  };
}
