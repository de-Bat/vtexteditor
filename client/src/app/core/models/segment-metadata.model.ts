export type MetadataType = 'speaker' | 'geo' | 'timeRange' | 'language' | 'custom';

export interface BaseMetadata {
  type: MetadataType;
  sourcePluginId: string;
  confidence?: number;
}

export interface SpeakerMetadata extends BaseMetadata {
  type: 'speaker';
  name: string;
  label?: string;
}

export interface GeoMetadata extends BaseMetadata {
  type: 'geo';
  lat: number;
  lng: number;
  placeName?: string;
}

export interface TimeRangeMetadata extends BaseMetadata {
  type: 'timeRange';
  from: number;
  to: number;
  label?: string;
}

export interface LanguageMetadata extends BaseMetadata {
  type: 'language';
  code: string;
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
