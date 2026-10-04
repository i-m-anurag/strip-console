import { relative } from 'node:path';
import { cac } from 'cac';
import pkg from '../package.json' with { type: 'json' };
import { type CliConfig, loadConfig } from './node/config';
import { auditFiles, type FilesResult, stripFiles } from './node/files';

interface Flags {
  methods?: string | string[];
  loggers?: string | string[];
  keepComment?: string;
  debugger?: boolean;
  include?: string | string[];
  exclude?: string | string[];
  config?: string;
  dryRun?: boolean;
  json?: boolean;
}

/** `--methods log,debug` and `--methods log --methods debug` both become `['log', 'debug']`. */
function list(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return (Array.isArray(value) ? value : [value])
    .flatMap((v) => String(v).split(','))
    .filter(Boolean);
}

async function resolveOptions(dirs: string[], flags: Flags) {
  const { dirs: configDirs, ...config }: CliConfig = await loadConfig(process.cwd(), flags.config);
  return {
    dirs: dirs.length > 0 ? dirs : (configDirs ?? ['dist']),
    options: {
      ...config,
      methods: list(flags.methods) ?? config.methods,
      loggers: list(flags.loggers) ?? config.loggers,
      keepComment: flags.keepComment ?? config.keepComment,
      // cac defaults --no-debugger to true, so only an explicit false overrides the config.
      debugger: flags.debugger === false ? false : config.debugger,
      include: list(flags.include) ?? config.include,
      exclude: list(flags.exclude) ?? config.exclude,
    },
  };
}

function rel(file: string): string {
  return relative(process.cwd(), file) || file;
}

function count(result: FilesResult): number {
  return result.files.reduce((sum, f) => sum + f.removed.length, 0);
}

function printJson(result: FilesResult): void {
  const files = result.files.map((f) => ({ ...f, file: rel(f.file) }));
  const errors = result.errors.map((e) => ({ ...e, file: rel(e.file) }));
  console.log(
    JSON.stringify({ scanned: result.scanned, calls: count(result), files, errors }, null, 2),
  );
}

function printErrors(result: FilesResult): void {
  for (const e of result.errors) console.error(`error  ${rel(e.file)}: ${e.message}`);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

const cli = cac('strip-console');

function withOptions<T extends ReturnType<typeof cli.command>>(command: T): T {
  return command
    .option('--methods <list>', 'Console methods to remove (default: log,debug,info,trace)')
    .option('--loggers <list>', 'Extra callees to remove, e.g. logger.debug')
    .option('--keep-comment <text>', 'Comment text that keeps the next call (default: keep)')
    .option('--no-debugger', 'Keep debugger statements')
    .option('--include <glob>', 'Files to process (default: **/*.{js,mjs,cjs})')
    .option('--exclude <glob>', 'Files to skip (default: **/node_modules/**)')
    .option(
      '--config <file>',
      'Config file (default: strip-console.config.* or package.json "stripConsole")',
    )
    .option('--json', 'Print a machine-readable report') as T;
}

withOptions(
  cli.command(
    'audit [...dirs]',
    'Report console calls without changing files; exits 1 if any remain',
  ),
)
  .example('strip-console audit dist/')
  .action(async (dirs: string[], flags: Flags) => {
    const { dirs: targets, options } = await resolveOptions(dirs, flags);
    const result = await auditFiles(targets, options);
    if (flags.json) {
      printJson(result);
    } else {
      for (const f of result.files) {
        for (const call of f.removed) {
          const what = call.method === 'debugger' ? 'debugger' : `console.${call.method}`;
          console.log(`${rel(f.file)}:${call.line}:${call.column + 1}  ${what}`);
        }
      }
      printErrors(result);
      console.log(
        count(result) === 0
          ? `No console calls found in ${plural(result.scanned, 'file')}.`
          : `Found ${plural(count(result), 'console call')} in ${plural(result.files.length, 'file')}.`,
      );
    }
    if (count(result) > 0 || result.errors.length > 0) process.exitCode = 1;
  });

withOptions(
  cli.command('[...dirs]', 'Remove console calls from files in place (default dir: dist)'),
)
  .option('--dry-run', 'Report what would be removed without writing files')
  .example('strip-console dist/')
  .action(async (dirs: string[], flags: Flags) => {
    const { dirs: targets, options } = await resolveOptions(dirs, flags);
    const result = await stripFiles(targets, { ...options, dryRun: flags.dryRun });
    if (flags.json) {
      printJson(result);
    } else {
      printErrors(result);
      const verb = flags.dryRun ? 'Would remove' : 'Removed';
      console.log(
        `${verb} ${plural(count(result), 'console call')} from ${plural(result.files.length, 'file')} ` +
          `(${plural(result.scanned, 'file')} scanned).`,
      );
    }
    if (result.errors.length > 0) process.exitCode = 1;
  });

cli.help();
cli.version(pkg.version);
cli.parse(process.argv, { run: false });
Promise.resolve(cli.runMatchedCommand()).catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 2;
});
