import type { RolldownPlugin } from 'unplugin';
import { type PluginOptions, unplugin } from './plugin/index';

const plugin: (options?: PluginOptions) => RolldownPlugin = unplugin.rolldown;
export default plugin;
