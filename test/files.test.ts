import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MagicString } from 'magic-string';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditFiles, stripFiles } from '../src/index';
import { loadConfig } from '../src/node/config';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'strip-console-files-'));
  await cp(resolve(__dirname, 'fixtures/app'), join(dir, 'dist'), { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('auditFiles', () => {
  it('reports remaining calls without changing files', async () => {
    const before = await readFile(join(dir, 'dist/index.js'), 'utf8');
    const result = await auditFiles([join(dir, 'dist')]);
    expect(result.scanned).toBe(2);
    expect(
      result.files.map((f) => [f.file.split('/').at(-1), f.removed.map((r) => r.method)]),
    ).toEqual([
      ['index.js', ['log']],
      ['util.js', ['debug']],
    ]);
    expect(await readFile(join(dir, 'dist/index.js'), 'utf8')).toBe(before);
  });

  it('reports files that fail to parse', async () => {
    await writeFile(join(dir, 'dist/broken.js'), 'console.log(');
    const result = await auditFiles([join(dir, 'dist')]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.file).toMatch(/broken\.js$/);
  });

  it('skips node_modules by default', async () => {
    await mkdir(join(dir, 'dist/node_modules/dep'), { recursive: true });
    await writeFile(join(dir, 'dist/node_modules/dep/index.js'), 'console.log(1);');
    const result = await auditFiles([join(dir, 'dist')]);
    expect(result.scanned).toBe(2);
  });
});

describe('stripFiles', () => {
  it('rewrites files in place and a later audit is clean', async () => {
    const result = await stripFiles([join(dir, 'dist')]);
    expect(result.files).toHaveLength(2);
    const code = await readFile(join(dir, 'dist/index.js'), 'utf8');
    expect(code).not.toContain('main called');
    expect(code).toContain('errors stay');
    expect((await auditFiles([join(dir, 'dist')])).files).toEqual([]);
  });

  it('leaves files alone in a dry run', async () => {
    const before = await readFile(join(dir, 'dist/index.js'), 'utf8');
    const result = await stripFiles([join(dir, 'dist')], { dryRun: true });
    expect(result.files).toHaveLength(2);
    expect(await readFile(join(dir, 'dist/index.js'), 'utf8')).toBe(before);
  });

  it('updates an existing source map so it still points at the original source', async () => {
    // A "build" that prefixes a banner line, with a map back to src/app.js.
    const original = 'run();\nconsole.log("x");\nfinish();\n';
    const built = new MagicString(original).prepend('// banner\n');
    const out = join(dir, 'dist/app.js');
    await writeFile(out, `${built.toString()}//# sourceMappingURL=app.js.map\n`);
    const map = built.generateMap({
      source: '../src/app.js',
      file: 'app.js',
      hires: true,
      includeContent: true,
    });
    await writeFile(`${out}.map`, map.toString());

    await stripFiles([join(dir, 'dist')]);

    const code = await readFile(out, 'utf8');
    expect(code).toBe('// banner\nrun();\nfinish();\n//# sourceMappingURL=app.js.map\n');
    const merged = JSON.parse(await readFile(`${out}.map`, 'utf8'));
    expect(merged.sources).toEqual(['../src/app.js']);
    expect(merged.file).toBe('app.js');
    // VLQ segments per output line: [column, source, line delta, column]. Output line 2 (`run();`)
    // maps to original line 1; output line 3 (`finish();`) is 2 lines further, original line 3.
    const lines: string[] = merged.mappings.split(';');
    expect(lines[0]).toBe('');
    expect(lines[1]?.startsWith('AAAA')).toBe(true);
    expect(lines[2]?.startsWith('AAE')).toBe(true);
  });
});

describe('loadConfig', () => {
  it('reads strip-console.config.json', async () => {
    await writeFile(join(dir, 'strip-console.config.json'), JSON.stringify({ methods: ['warn'] }));
    expect(await loadConfig(dir)).toEqual({ methods: ['warn'] });
  });

  it('reads the stripConsole key in package.json', async () => {
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ stripConsole: { dirs: ['build'] } }),
    );
    expect(await loadConfig(dir)).toEqual({ dirs: ['build'] });
  });

  it('reads an explicit .mjs config', async () => {
    await writeFile(join(dir, 'custom.mjs'), 'export default { loggers: ["logger.debug"] };');
    expect(await loadConfig(dir, 'custom.mjs')).toEqual({ loggers: ['logger.debug'] });
  });

  it('returns an empty config when none exists', async () => {
    expect(await loadConfig(dir)).toEqual({});
  });
});
