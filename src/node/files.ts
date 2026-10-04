import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import remapping from '@jridgewell/remapping';
import { glob } from 'tinyglobby';
import type { StripConsoleOptions } from '../core/options';
import { type RemovedCall, transform } from '../core/transform';

export interface FileOptions extends Omit<StripConsoleOptions, 'filename' | 'sourcemap'> {
  /** Glob patterns, relative to each directory. Default: all `.js`, `.mjs` and `.cjs` files. */
  include?: string[];
  /** Glob patterns to skip. Default: `node_modules`. */
  exclude?: string[];
}

export interface FileReport {
  file: string;
  removed: RemovedCall[];
}

export interface FileError {
  file: string;
  message: string;
}

export interface FilesResult {
  /** Files processed, including those with nothing to remove. */
  scanned: number;
  /** Files that contained calls to remove (or that still contain them, for an audit). */
  files: FileReport[];
  /** Files that could not be parsed or read. */
  errors: FileError[];
}

const DEFAULT_INCLUDE = ['**/*.{js,mjs,cjs}'];
const DEFAULT_EXCLUDE = ['**/node_modules/**'];

async function listFiles(dirs: string[], options: FileOptions): Promise<string[]> {
  const found = new Set<string>();
  for (const dir of dirs) {
    const cwd = resolve(dir);
    const matches = await glob(options.include ?? DEFAULT_INCLUDE, {
      cwd,
      ignore: options.exclude ?? DEFAULT_EXCLUDE,
      absolute: true,
      onlyFiles: true,
    });
    for (const file of matches) found.add(file);
  }
  return [...found].sort();
}

function coreOptions(options: FileOptions): StripConsoleOptions {
  const { include: _include, exclude: _exclude, ...core } = options;
  return core;
}

/** Report console calls that would be removed, without changing any file. */
export async function auditFiles(dirs: string[], options: FileOptions = {}): Promise<FilesResult> {
  const result: FilesResult = { scanned: 0, files: [], errors: [] };
  for (const file of await listFiles(dirs, options)) {
    result.scanned++;
    try {
      const code = await readFile(file, 'utf8');
      const { removed } = transform(code, {
        ...coreOptions(options),
        filename: file,
        sourcemap: false,
      });
      if (removed.length > 0) result.files.push({ file, removed });
    } catch (error) {
      result.errors.push({ file, message: (error as Error).message });
    }
  }
  return result;
}

/**
 * Remove console calls from files in place. A `<file>.map` next to a rewritten file is updated
 * so it still maps back to the original sources.
 */
export async function stripFiles(
  dirs: string[],
  options: FileOptions & { dryRun?: boolean } = {},
): Promise<FilesResult> {
  const { dryRun = false, ...rest } = options;
  const result: FilesResult = { scanned: 0, files: [], errors: [] };
  for (const file of await listFiles(dirs, rest)) {
    result.scanned++;
    try {
      const code = await readFile(file, 'utf8');
      // The bare file name keeps the map's sources relative, matching the map that sits beside it.
      const out = transform(code, {
        ...coreOptions(rest),
        filename: basename(file),
        sourcemap: true,
      });
      if (out.removed.length === 0) continue;
      result.files.push({ file, removed: out.removed });
      if (dryRun) continue;
      await writeFile(file, out.code);
      if (out.map) await updateSourceMap(file, out.map.toString());
    } catch (error) {
      result.errors.push({ file, message: (error as Error).message });
    }
  }
  return result;
}

/** Chain our edit map onto an existing `<file>.map`, so the result still points at the original sources. */
async function updateSourceMap(file: string, editMap: string): Promise<void> {
  const mapFile = `${file}.map`;
  let previous: string;
  try {
    previous = await readFile(mapFile, 'utf8');
  } catch {
    return; // no map to keep in sync
  }
  const name = basename(file);
  let chained = false;
  const merged = remapping(editMap, (source) => {
    // Only the edited file itself gets the previous map; its own sources are the originals.
    if (chained || source !== name) return null;
    chained = true;
    return previous;
  });
  merged.file = JSON.parse(previous).file ?? name;
  await writeFile(mapFile, merged.toString());
}
