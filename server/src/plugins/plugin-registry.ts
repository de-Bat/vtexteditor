import { Express } from 'express';
import { IPlugin } from './plugin.interface';
import { srtImportPlugin } from './transcription/srt-import.plugin';
import { whisperPlugin } from './transcription/whisper-openai.plugin';
import { groqWhisperPlugin } from './transcription/groq-whisper.plugin';
import { reconstruct2storyPlugin } from './narrative/reconstruct2story.plugin';
import { locationsPlugin } from './locations/locations.plugin';
import { timestampsPlugin } from './timestamps/timestamps.plugin';

class PluginRegistry {
  private plugins: Map<string, IPlugin> = new Map();

  constructor() {
    this.register(srtImportPlugin);
    this.register(whisperPlugin);
    this.register(groqWhisperPlugin);
    this.register(reconstruct2storyPlugin);
    this.register(locationsPlugin);
    this.register(timestampsPlugin);
  }

  register(plugin: IPlugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  /** Call after all plugins are registered and the Express app is ready. */
  registerRoutes(app: Express): void {
    for (const plugin of this.plugins.values()) {
      plugin.registerRoutes?.(app);
    }
  }

  getAll(): IPlugin[] {
    return Array.from(this.plugins.values());
  }

  getById(id: string): IPlugin | undefined {
    return this.plugins.get(id);
  }
}

export const pluginRegistry = new PluginRegistry();
