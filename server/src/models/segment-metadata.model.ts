export type MetadataType = 'speaker' | 'geo' | 'trail' | 'timeRange' | 'language' | 'dateInterval' | 'custom';

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

export interface TrailPoint {
  lat: number;
  lng: number;
  name?: string;
}

export interface TrailMetadata extends BaseMetadata {
  type: 'trail';
  points: TrailPoint[];
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

export interface DateIntervalMetadata extends BaseMetadata {
  type: 'dateInterval';
  label: string; // e.g. "1930s", "May 1945", "1990"
  startYear?: number;
  endYear?: number;
}

export interface CustomMetadata extends BaseMetadata {
  type: 'custom';
  key: string;
  value: string | number | boolean;
}

export type MetadataEntry =
  | SpeakerMetadata
  | GeoMetadata
  | TrailMetadata
  | TimeRangeMetadata
  | LanguageMetadata
  | DateIntervalMetadata
  | CustomMetadata;
