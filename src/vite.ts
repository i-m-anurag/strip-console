import type { VitePlugin } from 'unplugin';
import { type PluginOptions, unplugin } from './plugin/index';

const plugin: (options?: PluginOptions) => VitePlugin = unplugin.vite;
export default plugin;
