import { MetadataProduction } from './segment-metadata.model';

export type PluginType =
  | 'transcription'
  | 'diarization'
  | 'detection'
  | 'narrative'
  | 'translation';

export interface PluginMeta {
  id: string;
  name: string;
  description: string;
  type: PluginType;
  /** JSON Schema object describing plugin configuration options */
  configSchema: Record<string, unknown>;
  /** Whether this plugin ships an Angular UI component */
  hasUI: boolean;
  settingsMap?: Record<string, string>;
  produces?: MetadataProduction[];
}

export interface PipelineStep {
  pluginId: string;
  config: Record<string, unknown>;
  order: number;
}
