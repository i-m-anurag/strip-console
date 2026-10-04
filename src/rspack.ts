import type { RspackPluginInstance } from 'unplugin';
import { type PluginOptions, unplugin } from './plugin/index';

const plugin: (options?: PluginOptions) => RspackPluginInstance = unplugin.rspack;
export default plugin;
