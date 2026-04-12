export type MetadataType = 'speaker' | 'geo' | 'timeRange' | 'language' | 'custom';

export interface BaseMetadata {
  type: MetadataType;
  sourcePluginId: string; // e.g. 'diarization-v1' or 'user'
  confidence?: number;    // 0.0 to 1.0
}

export interface SpeakerMetadata extends BaseMetadata {
  type: 'speaker';
  name: string;
  label?: string; // e.g. "Speaker A"
}

export interface GeoMetadata extends BaseMetadata {
  type: 'geo';
  lat: number;
  lng: number;
  placeName?: string;
}

export interface TimeRangeMetadata extends BaseMetadata {
  type: 'timeRange';
  from: number; // seconds
  to: number;   // seconds
  label?: string;
}

export interface LanguageMetadata extends BaseMetadata {
  type: 'language';
  code: string; // ISO 639-1
  name?: string;
}

export interface CustomMetadata extends BaseMetadata {
  type: 'custom';
  key: string;
  value: string | number | boolean;
}

export type SegmentMetadata =
  | SpeakerMetadata
  | GeoMetadata
  | TimeRangeMetadata
  | LanguageMetadata
  | CustomMetadata;
