import { Injectable, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { ApiService } from './api.service';

export type SettingKey =
  | 'OPENAI_API_KEY'
  | 'WHISPER_BASE_URL'
  | 'WHISPER_MODEL'
  | 'WHISPER_LANGUAGE'
  | 'SHOW_SILENCE_MARKERS'
  | 'GROQ_API_KEY'
  | 'DEFAULT_EDIT_MODE';

export type AppSettings = Partial<Record<SettingKey, string>>;

export const SETTING_META: Record<SettingKey, { label: string; description: string; placeholder: string; secret?: boolean }> = {
  OPENAI_API_KEY: {
    label: 'OpenAI API Key',
    description: 'Used by the Whisper (OpenAI-compatible) transcription plugin.',
    placeholder: 'sk-…',
    secret: true,
  },
  WHISPER_BASE_URL: {
    label: 'Whisper Base URL',
    description: 'Override the OpenAI endpoint for a self-hosted Whisper server (e.g. http://localhost:8000/v1).',
    placeholder: 'http://localhost:8000/v1',
  },
  WHISPER_MODEL: {
    label: 'Whisper Model',
    description: 'Default model for transcription (e.g. ivrit-ai/whisper-large-v3-turbo-ct2).',
    placeholder: 'ivrit-ai/whisper-large-v3-turbo-ct2',
  },
  WHISPER_LANGUAGE: {
    label: 'Whisper Language',
    description: 'ISO 639-1 language code (e.g. "he"). Leave blank for auto-detect.',
    placeholder: 'he',
  },
  SHOW_SILENCE_MARKERS: {
    label: 'Show Silence Markers',
    description: 'Show gap markers between transcript segments. Can be overridden per pipeline run.',
    placeholder: 'false',
  },
  GROQ_API_KEY: {
    label: 'Groq API Key',
    description: 'Used by the Groq Whisper transcription plugin.',
    placeholder: 'gsk_…',
    secret: true,
  },
  DEFAULT_EDIT_MODE: {
    label: 'Default Edit Mode',
    description: 'Live: changes apply immediately. Apply: changes are staged until you click Apply.',
    placeholder: 'live',
  },
};

@Injectable({ providedIn: 'root' })
export class SettingsService {
  readonly defaultEditMode = signal<'live' | 'apply'>('live');

  constructor(private api: ApiService) {}

  load(): Observable<AppSettings> {
    return this.api.get<AppSettings>('/settings').pipe(
      tap((s) => {
        const val = s['DEFAULT_EDIT_MODE'];
        if (val === 'live' || val === 'apply') this.defaultEditMode.set(val);
      })
    );
  }

  save(settings: AppSettings): Observable<{ ok: boolean; settings: AppSettings }> {
    return this.api.put<{ ok: boolean; settings: AppSettings }>('/settings', settings);
  }

  saveDefaultEditMode(mode: 'live' | 'apply'): void {
    this.defaultEditMode.set(mode);
    this.save({ DEFAULT_EDIT_MODE: mode }).subscribe({ error: console.error });
  }
}
