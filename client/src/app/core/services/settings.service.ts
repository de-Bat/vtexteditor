import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export type SettingKey = 'OPENAI_API_KEY' | 'WHISPER_BASE_URL' | 'GROQ_API_KEY';
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
    description: 'Override the OpenAI endpoint for a self-hosted Whisper server (e.g. http://localhost:9000/v1).',
    placeholder: 'http://localhost:9000/v1',
  },
  GROQ_API_KEY: {
    label: 'Groq API Key',
    description: 'Used by the Groq Whisper transcription plugin.',
    placeholder: 'gsk_…',
    secret: true,
  },
};

@Injectable({ providedIn: 'root' })
export class SettingsService {
  constructor(private api: ApiService) {}

  load(): Observable<AppSettings> {
    return this.api.get<AppSettings>('/settings');
  }

  save(settings: AppSettings): Observable<{ ok: boolean; settings: AppSettings }> {
    return this.api.put<{ ok: boolean; settings: AppSettings }>('/settings', settings);
  }
}
