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
  /**
   * Maps configSchema property names to app setting keys.
   * The plugin list endpoint injects current setting values as schema defaults
   * so the client panel pre-fills fields without any client-side changes.
   */
  settingsMap?: Record<string, string>;
}

export interface PipelineStep {
  pluginId: string;
  config: Record<string, unknown>;
  order: number;
}
