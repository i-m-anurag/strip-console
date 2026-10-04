import type { RollupPlugin } from 'unplugin';
import { type PluginOptions, unplugin } from './plugin/index';

const plugin: (options?: PluginOptions) => RollupPlugin = unplugin.rollup;
export default plugin;
