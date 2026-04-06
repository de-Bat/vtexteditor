import { IPlugin } from './plugin.interface';
import { srtImportPlugin } from './transcription/srt-import.plugin';
import { whisperPlugin } from './transcription/whisper-openai.plugin';
import { groqWhisperPlugin } from './transcription/groq-whisper.plugin';

/** Central registry of all available plugins */
class PluginRegistry {
  private plugins: Map<string, IPlugin> = new Map();

  constructor() {
    this.register(srtImportPlugin);
    this.register(whisperPlugin);
    this.register(groqWhisperPlugin);
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
