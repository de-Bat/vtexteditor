import { IPlugin } from './plugin.interface';
import { srtImportPlugin } from './transcription/srt-import.plugin';

/** Central registry of all available plugins */
class PluginRegistry {
  private plugins: Map<string, IPlugin> = new Map();

  constructor() {
    this.register(srtImportPlugin);
    // Additional plugins registered here as they are implemented
  }

  register(plugin: IPlugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  getAll(): IPlugin[] {
    return Array.from(this.plugins.values());
  }

  getById(id: string): IPlugin | undefined {
    return this.plugins.get(id);
  }
}

export const pluginRegistry = new PluginRegistry();
