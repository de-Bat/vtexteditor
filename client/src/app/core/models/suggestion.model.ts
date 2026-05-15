export type SuggestionReason = 'filler-word' | 'silence' | 'low-confidence' | 'low-value-llm';
export type SuggestionSource = 'speech' | 'llm' | 'both';

export interface Suggestion {
  id: string;
  clipId: string;
  wordIds: string[];
  text: string;
  reason: SuggestionReason;
  reasonLabel: string;
  confidence: number;
  source: SuggestionSource;
  durationMs?: number;
}

export interface SuggestOptions {
  silenceThresholdMs?: number;
  fillerLangs?: string[];
  ollamaEnabled?: boolean;
  ollamaModel?: string;
}
