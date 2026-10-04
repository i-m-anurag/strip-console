import { createUnplugin, type UnpluginInstance } from 'unplugin';
import { createFilter, type FilterPattern } from 'unplugin-utils';
import type { StripConsoleOptions } from '../core/options';
import { transform } from '../core/transform';

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
}

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
  const { include = DEFAULT_INCLUDE, exclude = DEFAULT_EXCLUDE, chunks = false, ...core } = options;
  const filter = createFilter(include, exclude);

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

  const renderChunk = chunks
    ? function (
        this: { warn: (message: string) => void },
        code: string,
        chunk: { fileName: string },
      ) {
        return strip(code, chunk.fileName, (message) => this.warn(message));
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
  };
});

export default unplugin;
