/** The value types an option can take. */
export type OptionType = 'string' | 'boolean' | 'string[]' | 'pattern';

export type OptionSchema = Record<string, OptionType>;

export const CORE_SCHEMA: OptionSchema = {
  methods: 'string[]',
  loggers: 'string[]',
  keepComment: 'string',
  debugger: 'boolean',
  sourcemap: 'boolean',
  filename: 'string',
};

const DESCRIBE: Record<OptionType, string> = {
  string: 'a string',
  boolean: 'true or false',
  'string[]': 'an array of strings',
  pattern: 'a string, a RegExp, or an array of them',
};

function matches(type: OptionType, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'string[]':
      return Array.isArray(value) && value.every((v) => typeof v === 'string');
    case 'pattern': {
      const one = (v: unknown) => typeof v === 'string' || v instanceof RegExp;
      return value === null || one(value) || (Array.isArray(value) && value.every(one));
    }
  }
}

/** Edit distance, used to suggest the option a typo was meant to be. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j] ?? 0;
      const cost = a[i - 1]?.toLowerCase() === b[j - 1]?.toLowerCase() ? 0 : 1;
      row[j] = Math.min(current + 1, (row[j - 1] ?? 0) + 1, previous + cost);
      previous = current;
    }
  }
  return row[b.length] ?? 0;
}

/**
 * Throw a `TypeError` naming the first unknown option or the first option with a value of the
 * wrong type. `undefined` values are ignored, so callers can pass optional settings through.
 */
export function validateOptions(options: unknown, schema: OptionSchema): void {
  if (options === undefined) return;
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('strip-console: options must be an object');
  }
  for (const [key, value] of Object.entries(options)) {
    const type = schema[key];
    if (!type) {
      const known = Object.keys(schema);
      const guess = known.find((name) => distance(key, name) <= 2);
      throw new TypeError(
        `strip-console: unknown option "${key}".${guess ? ` Did you mean "${guess}"?` : ''} ` +
          `Valid options: ${known.join(', ')}.`,
      );
    }
    if (value !== undefined && !matches(type, value)) {
      throw new TypeError(`strip-console: option "${key}" must be ${DESCRIBE[type]}`);
    }
  }
}
