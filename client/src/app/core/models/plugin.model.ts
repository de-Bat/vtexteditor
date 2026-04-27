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
  /** Hint: this plugin may pause execution to ask the user for input */
  requiresInteraction?: boolean;
}

export interface InputField {
  id: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'multi-select' | 'textarea';
  label: string;
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: Array<{ label: string; value: string }>;
  validation?: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
  };
}

export interface InputRequest {
  requestId: string;
  pluginId: string;
  title: string;
  content?: string;
  fields: InputField[];
  skippable: boolean;
  skipLabel?: string;
  submitLabel?: string;
}

export interface InputResponse {
  requestId: string;
  skipped: boolean;
  values: Record<string, unknown>;
}

export interface PipelineStep {
  pluginId: string;
  config: Record<string, unknown>;
  order: number;
}

export interface PluginStepOutput {
  stepIndex: number;
  pluginId: string;
  clips: import('./clip.model').Clip[];
  metadata: Record<string, unknown>;
  completedAt: string;
  wordCount: number;
}

export interface PipelineOutput {
  jobId: string;
  steps: PluginStepOutput[];
}
