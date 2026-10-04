import type { WebpackPluginInstance } from 'unplugin';
import { type PluginOptions, unplugin } from './plugin/index';

const plugin: (options?: PluginOptions) => WebpackPluginInstance = unplugin.webpack;
export default plugin;
