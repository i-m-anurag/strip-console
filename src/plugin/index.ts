import remapping from '@jridgewell/remapping';
import { createUnplugin, type UnpluginInstance } from 'unplugin';
import { createFilter, type FilterPattern } from 'unplugin-utils';
import { createRuntimeGuard, prependGuard } from '../core/guard';
import type { StripConsoleOptions } from '../core/options';
import { transform } from '../core/transform';
import { CORE_SCHEMA, type OptionSchema, validateOptions } from '../core/validate';

export interface PluginOptions extends Omit<StripConsoleOptions, 'filename'> {
  /** Files to process. Default: JS, TS, JSX, TSX, Vue, Svelte and Astro modules. */
  include?: FilterPattern;
  /** Files to skip. Default: `node_modules`. */
  exclude?: FilterPattern;
  /**
   * Also process the final output chunks, which catches console calls in `node_modules` and in
   * compiled framework files. Vite, Rollup and Rolldown only. Default: `false`.
   */
  chunks?: boolean;
  /**
   * Add a small script to each entry chunk that turns the listed `methods` into no-ops at runtime,
   * catching calls static analysis cannot see such as `console[name]()`. It also silences calls
   * kept with a `keep` comment. Default: `false`.
   */
  runtimeGuard?: boolean;
}

const { filename: _filename, ...PLUGIN_CORE } = CORE_SCHEMA;
const PLUGIN_SCHEMA: OptionSchema = {
  ...PLUGIN_CORE,
  include: 'pattern',
  exclude: 'pattern',
  chunks: 'boolean',
  runtimeGuard: 'boolean',
};

const DEFAULT_INCLUDE = [/\.[cm]?[jt]sx?$/, /\.(vue|svelte|astro)$/];
const DEFAULT_EXCLUDE = [/[\\/]node_modules[\\/]/];

/** Module id without its query string, e.g. `App.vue?vue&type=script` -> `App.vue`. */
function cleanId(id: string): string {
  return id.replace(/[?#].*$/, '');
}

/** File name that tells the parser which syntax to expect. */
function parserFilename(file: string): string {
  if (/\.[cm]?tsx?$/.test(file)) return file.replace(/\.[cm](ts)$/, '.$1');
  if (/\.jsx$/.test(file)) return file;
  // .js, .mjs, .cjs and compiled framework modules: parse as JSX so either syntax is accepted.
  return `${file}.jsx`;
}

export const unplugin: UnpluginInstance<PluginOptions | undefined, false> = createUnplugin<
  PluginOptions | undefined,
  false
>((options: PluginOptions = {}) => {
  validateOptions(options, PLUGIN_SCHEMA);
  const {
    include = DEFAULT_INCLUDE,
    exclude = DEFAULT_EXCLUDE,
    chunks = false,
    runtimeGuard = false,
    ...core
  } = options;
  const filter = createFilter(include, exclude);
  const guard = runtimeGuard ? createRuntimeGuard(core.methods) : undefined;

  const strip = (code: string, file: string, warn: (message: string) => void) => {
    try {
      const result = transform(code, { ...core, filename: parserFilename(file) });
      if (result.removed.length === 0) return null;
      return { code: result.code, map: result.map?.toString() ?? null };
    } catch (error) {
      warn(`skipped ${file}: ${(error as Error).message}`);
      return null;
    }
  };

  const renderChunk =
    chunks || guard
      ? function (
          this: { warn: (message: string) => void },
          code: string,
          chunk: { fileName: string; isEntry: boolean },
        ) {
          const stripped = chunks
            ? strip(code, chunk.fileName, (message) => this.warn(message))
            : null;
          if (!guard || !chunk.isEntry) return stripped;
          const guarded = prependGuard(stripped?.code ?? code, guard, chunk.fileName);
          if (!stripped?.map) return { code: guarded.code, map: guarded.map.toString() };
          // Chain the guard's map onto the strip map so both edits trace back to the original.
          const map = remapping([guarded.map.toString(), stripped.map], () => null);
          return { code: guarded.code, map: map.toString() };
        }
      : undefined;

  return {
    name: 'strip-console',
    enforce: 'post',
    transformInclude(id) {
      return filter(cleanId(id));
    },
    transform(code, id) {
      return strip(code, cleanId(id), (message) => this.warn(message));
    },
    vite: { apply: 'build', renderChunk },
    rollup: { renderChunk },
    rolldown: { renderChunk },
    webpack(compiler) {
      if (guard) {
        new compiler.webpack.BannerPlugin({ banner: guard, raw: true, entryOnly: true }).apply(
          compiler,
        );
      }
    },
    rspack(compiler) {
      if (guard) {
        new compiler.rspack.BannerPlugin({ banner: guard, raw: true, entryOnly: true }).apply(
          compiler,
        );
      }
    },
    esbuild: {
      config(build) {
        if (guard) build.banner = { ...build.banner, js: guard + (build.banner?.js ?? '') };
      },
    },
  };
});

export default unplugin;
