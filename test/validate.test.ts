import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { transform } from '../src/core/transform';
import { loadConfig } from '../src/node/config';
import { auditFiles, stripFiles } from '../src/node/files';
import stripVite from '../src/vite';

describe('option validation', () => {
  it('suggests the option a typo meant', () => {
    expect(() => transform('x', { method: ['log'] } as never)).toThrow(
      /unknown option "method". Did you mean "methods"\?/,
    );
  });

  it('lists the valid options when nothing is close', () => {
    expect(() => transform('x', { colour: true } as never)).toThrow(/Valid options: methods,/);
  });

  it('rejects values of the wrong type', () => {
    expect(() => transform('x', { methods: 'log' } as never)).toThrow(
      'strip-console: option "methods" must be an array of strings',
    );
    expect(() => transform('x', { debugger: 'no' } as never)).toThrow(/must be true or false/);
  });

  it('ignores undefined values', () => {
    expect(transform('console.log(1)', { methods: undefined }).code).toBe('');
  });

  it('checks plugin options, including include and exclude patterns', () => {
    expect(() => stripVite({ chunk: true } as never)).toThrow(/Did you mean "chunks"\?/);
    expect(() => stripVite({ include: 3 } as never)).toThrow(
      /"include" must be a string, a RegExp/,
    );
    expect(() => stripVite({ include: [/\.js$/, 'src/**'], exclude: null })).not.toThrow();
    expect(() => stripVite({ filename: 'a.js' } as never)).toThrow(/unknown option "filename"/);
  });

  it('checks the file API options', async () => {
    await expect(auditFiles([], { includes: ['*.js'] } as never)).rejects.toThrow(
      /Did you mean "include"\?/,
    );
    await expect(stripFiles([], { dryRun: 'yes' } as never)).rejects.toThrow(/"dryRun" must be/);
    await expect(stripFiles([], { dryRun: true })).resolves.toMatchObject({ scanned: 0 });
  });

  it('names the config file that has a bad option', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strip-console-'));
    try {
      await writeFile(join(dir, 'strip-console.config.json'), JSON.stringify({ dir: ['out'] }));
      await expect(loadConfig(dir)).rejects.toThrow(
        /unknown option "dir". Did you mean "dirs"\?.*\(in strip-console.config.json\)/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
