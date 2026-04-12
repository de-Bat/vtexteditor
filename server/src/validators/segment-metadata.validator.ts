import { z } from 'zod';
import { MetadataType } from '../models/segment-metadata.model';

const BaseMetadataSchema = z.object({
  type: z.enum(['speaker', 'geo', 'timeRange', 'language', 'custom']),
  sourcePluginId: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
});

const SpeakerMetadataSchema = BaseMetadataSchema.extend({
  type: z.literal('speaker'),
  name: z.string().min(1),
  label: z.string().optional(),
});

const GeoMetadataSchema = BaseMetadataSchema.extend({
  type: z.literal('geo'),
  lat: z.number(),
  lng: z.number(),
  placeName: z.string().optional(),
});

const TimeRangeMetadataSchema = BaseMetadataSchema.extend({
  type: z.literal('timeRange'),
  from: z.number().min(0),
  to: z.number().min(0),
  label: z.string().optional(),
});

const LanguageMetadataSchema = BaseMetadataSchema.extend({
  type: z.literal('language'),
  code: z.string().length(2),
  name: z.string().optional(),
});

const CustomMetadataSchema = BaseMetadataSchema.extend({
  type: z.literal('custom'),
  key: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

export const MetadataEntrySchema = z.discriminatedUnion('type', [
  SpeakerMetadataSchema,
  GeoMetadataSchema,
  TimeRangeMetadataSchema,
  LanguageMetadataSchema,
  CustomMetadataSchema,
]);

export const MetadataMapSchema = z.record(
  z.string(), // sourcePluginId
  z.array(MetadataEntrySchema)
);

export function validateMetadataEntry(data: unknown) {
  const result = MetadataEntrySchema.safeParse(data);
  return result.success ? { valid: true, data: result.data } : { valid: false, error: result.error.message };
}

export function validateMetadataMap(data: unknown) {
  const result = MetadataMapSchema.safeParse(data);
  return result.success ? { valid: true, data: result.data } : { valid: false, error: result.error.message };
}
