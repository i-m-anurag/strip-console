import type { EsbuildPlugin } from 'unplugin';
import { type PluginOptions, unplugin } from './plugin/index';

const plugin: (options?: PluginOptions) => EsbuildPlugin = unplugin.esbuild;
export default plugin;
