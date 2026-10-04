export interface StripConsoleOptions {
  /** Console methods to remove. Defaults to log, debug, info and trace. */
  methods?: string[];
}

export interface RemovedCall {
  method: string;
  line: number;
  column: number;
}

export interface TransformResult {
  code: string;
  removed: RemovedCall[];
}

export const DEFAULT_METHODS: readonly string[] = ['log', 'debug', 'info', 'trace'];

/**
 * Remove console calls from `code`.
 *
 * Placeholder: returns the input unchanged until the AST-based core lands.
 */
export function transform(code: string, _options: StripConsoleOptions = {}): TransformResult {
  return { code, removed: [] };
}
