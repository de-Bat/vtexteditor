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
