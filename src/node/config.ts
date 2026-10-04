import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateOptions } from '../core/validate';
import { FILE_SCHEMA, type FileOptions } from './files';

export interface CliConfig extends FileOptions {
  /** Directories to process when none are given on the command line. Default: `['dist']`. */
  dirs?: string[];
}

const CONFIG_FILES = [
  'strip-console.config.json',
  'strip-console.config.mjs',
  'strip-console.config.js',
];

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function loadFile(file: string): Promise<CliConfig> {
  if (file.endsWith('.json')) return (await readJson(file)) as CliConfig;
  const mod = await import(pathToFileURL(file).href);
  return (mod.default ?? mod) as CliConfig;
}

async function exists(file: string): Promise<boolean> {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load options from `--config <file>`, else the first `strip-console.config.{json,mjs,js}` in
 * `cwd`, else the `"stripConsole"` key of `cwd/package.json`. Returns `{}` when none exists.
 */
export async function loadConfig(cwd: string, explicit?: string): Promise<CliConfig> {
  const { config, source } = await findConfig(cwd, explicit);
  try {
    validateOptions(config, { ...FILE_SCHEMA, dirs: 'string[]' });
  } catch (error) {
    throw new TypeError(`${(error as Error).message} (in ${source})`);
  }
  return config;
}

async function findConfig(
  cwd: string,
  explicit?: string,
): Promise<{ config: CliConfig; source: string }> {
  if (explicit) return { config: await loadFile(resolve(cwd, explicit)), source: explicit };
  for (const name of CONFIG_FILES) {
    const file = join(cwd, name);
    if (await exists(file)) return { config: await loadFile(file), source: name };
  }
  const pkgFile = join(cwd, 'package.json');
  if (await exists(pkgFile)) {
    const pkg = (await readJson(pkgFile)) as { stripConsole?: CliConfig };
    if (pkg.stripConsole)
      return { config: pkg.stripConsole, source: 'package.json "stripConsole"' };
  }
  return { config: {}, source: 'defaults' };
}
