import fs from 'fs';
import path from 'path';

const SETTINGS_PATH = path.resolve(__dirname, '..', '..', '..', 'storage', 'settings.json');

/** Keys the server recognises for AI provider credentials / endpoints. */
export const KNOWN_SETTING_KEYS = [
  'OPENAI_API_KEY',
  'WHISPER_BASE_URL',
  'WHISPER_MODEL',
  'WHISPER_LANGUAGE',
  'SHOW_SILENCE_MARKERS',
  'GROQ_API_KEY',
] as const;

/** Keys whose values must never be returned to callers in plain text. */
const SECRET_KEYS = new Set<string>(['OPENAI_API_KEY', 'GROQ_API_KEY']);

export type SettingKey = (typeof KNOWN_SETTING_KEYS)[number];
export type AppSettings = Partial<Record<SettingKey, string>>;

class SettingsService {
  private store: Record<string, string> = {};
  private loaded = false;

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (fs.existsSync(SETTINGS_PATH)) {
        const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
        this.store = JSON.parse(raw) as Record<string, string>;
      }
    } catch {
      this.store = {};
    }
  }

  /** Return a single setting value, or undefined if not set. */
  get(key: string): string | undefined {
    this.load();
    return this.store[key] || undefined;
  }

  /** Return all persisted settings. */
  getAll(): AppSettings {
    this.load();
    return { ...this.store } as AppSettings;
  }

  /**
   * Return settings with secret key values masked (e.g. "***ab12").
   * Use this for any response that is sent to a client.
   */
  getRedacted(): AppSettings {
    this.load();
    const result: Record<string, string> = { ...this.store };
    for (const key of SECRET_KEYS) {
      if (result[key]) {
        result[key] = '***' + result[key].slice(-4);
      }
    }
    return result as AppSettings;
  }

  /**
   * Merge `updates` into the store and persist.
   * Passing an empty string for a key removes it from the store.
   */
  set(updates: Record<string, string>): void {
    this.load();
    for (const [k, v] of Object.entries(updates)) {
      if (v === '') {
        delete this.store[k];
      } else {
        this.store[k] = v;
      }
    }
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(this.store, null, 2), 'utf-8');
  }
}

export const settingsService = new SettingsService();
