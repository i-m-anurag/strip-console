import { describe, expect, it } from 'vitest';
import { DEFAULT_METHODS, transform } from '../src/index';

describe('transform', () => {
  it('returns the input unchanged for now', () => {
    const code = 'console.log("hi");';
    expect(transform(code)).toEqual({ code, removed: [] });
  });

  it('keeps warn and error by default', () => {
    expect(DEFAULT_METHODS).not.toContain('warn');
    expect(DEFAULT_METHODS).not.toContain('error');
  });
});
