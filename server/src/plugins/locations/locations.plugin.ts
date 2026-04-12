import { IPlugin } from '../plugin.interface';
import { PipelineContext } from '../../models/pipeline-context.model';
import { GeoMetadata, TrailMetadata, TrailPoint } from '../../models/segment-metadata.model';
import { callCopilotStudio } from '../narrative/copilot.client';
import { Clip } from '../../models/clip.model';
import { Segment } from '../../models/segment.model';

interface LocationsConfig {
  model?: string;
  batchSize?: number;
  minConfidence?: number;
}

const PLUGIN_ID = 'locations';

/**
 * Extraction plugin that identifies geographical mentions in the transcript.
 * Adds GeoMetadata to segments and a TrailMetadata to clips.
 */
export const locationsPlugin: IPlugin = {
  id: PLUGIN_ID,
  name: 'Geographical Locations',
  description: 'Identifies geographical locations mentioned in segments and creates a travel trail for the clip.',
  type: 'detection',
  hasUI: false,
  configSchema: {
    type: 'object',
    properties: {
      model: {
        type: 'string',
        title: 'Model',
        default: 'gpt-4.1',
      },
      batchSize: {
        type: 'number',
        title: 'Batch Size',
        description: 'Number of segments to process in a single LLM call.',
        default: 40,
      },
      minConfidence: {
        type: 'number',
        title: 'Min Confidence',
        description: 'Minimum confidence score (0-1) to include a location.',
        default: 0.5,
      },
    },
  },

  async execute(ctx: PipelineContext): Promise<PipelineContext> {
    const cfg = (ctx.metadata[PLUGIN_ID] ?? {}) as LocationsConfig;
    const model = cfg.model ?? 'gpt-4.1';
    const batchSize = cfg.batchSize ?? 40;
    const minConfidence = cfg.minConfidence ?? 0.5;

    const allClips = ctx.clips;
    const allSegments: Segment[] = allClips.flatMap(c => c.segments);

    if (allSegments.length === 0) {
      console.log(`[locations] No segments to process.`);
      return ctx;
    }

    console.log(`[locations] processing ${allSegments.length} segments in batches of ${batchSize}`);

    // Track segments we've processed to avoid duplicate work if clips overlap segments
    // (though usually they don't in a standard pipeline)
    const processedSegIds = new Set<string>();

    for (let i = 0; i < allSegments.length; i += batchSize) {
      const batch = allSegments.slice(i, i + batchSize).filter(s => !processedSegIds.has(s.id));
      if (batch.length === 0) continue;

      batch.forEach(s => processedSegIds.add(s.id));

      const progressMsg = `Analyzing locations in segments ${i + 1} to ${Math.min(i + batchSize, allSegments.length)}…`;
      const progressPercent = Math.round((i / allSegments.length) * 100);
      ctx.reportProgress?.(progressMsg, progressPercent);
      
      const prompt = buildExtractionPrompt(batch);
      
      try {
        const responseText = await callCopilotStudio(prompt, model);
        const results = parseResults(responseText);
        applyResults(batch, results, minConfidence);
      } catch (err) {
        console.error(`[locations] Error processing batch starting at ${i}:`, err);
        // Continue to next batch
      }
    }

    // After adding locations to segments, add trail to each clip
    ctx.reportProgress?.('Generating travel trails for clips…', 95);
    for (const clip of allClips) {
      addTrailToClip(clip);
    }

    ctx.reportProgress?.('Locations processing complete.', 100);
    return ctx;
  },
};

/**
 * Builds the LLM prompt for location extraction.
 */
export function buildExtractionPrompt(segments: Segment[]): string {
  const transcript = segments.map(s => `[${s.id}] ${s.text}`).join('\n');
  return `Identify geographical locations (cities, countries, landmarks, specific addresses, etc.) mentioned in the following transcript segments.
For each segment, list every location found. For each location, provide:
- name: The name of the place.
- lat: Approximate latitude.
- lng: Approximate longitude.
- confidence: Your confidence score (0.0 to 1.0) that this is a location mention and the coordinates are correct.

Segments:
${transcript}

IMPORTANT: Return ONLY a valid JSON object mapping segment IDs to an array of location objects. 
If a segment has no locations, return an empty array for its ID.
Format:
{
  "uuid-1": [
    { "name": "Paris", "lat": 48.8566, "lng": 2.3522, "confidence": 0.98 }
  ],
  "uuid-2": []
}`;
}

/**
 * Parses the JSON results from the LLM response.
 */
export function parseResults(response: string): Record<string, any[]> {
  // Clean up potential markdown formatting
  const cleaned = response.replace(/```json/g, '').replace(/```/g, '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON object found in LLM response');
  }
  return JSON.parse(jsonMatch[0]);
}

/**
 * Updates segments with GeoMetadata based on LLM results.
 */
export function applyResults(segments: Segment[], results: Record<string, any[]>, minConfidence: number) {
  for (const seg of segments) {
    const rawLocations = results[seg.id] ?? [];
    if (!Array.isArray(rawLocations)) continue;

    const geoEntries: GeoMetadata[] = rawLocations
      .filter(loc => typeof loc.confidence === 'number' && loc.confidence >= minConfidence)
      .filter(loc => typeof loc.lat === 'number' && typeof loc.lng === 'number' && loc.name)
      .map(loc => ({
        type: 'geo',
        sourcePluginId: PLUGIN_ID,
        confidence: loc.confidence,
        lat: loc.lat,
        lng: loc.lng,
        placeName: loc.name,
      }));

    if (geoEntries.length > 0) {
      if (!seg.metadata) seg.metadata = {};
      // Append if other plugins already added metadata, or replace if we want exclusivity
      seg.metadata[PLUGIN_ID] = [...(seg.metadata[PLUGIN_ID] ?? []), ...geoEntries];
    }
  }
}

/**
 * Consolidates all locations in a clip into a chronological TrailMetadata.
 */
export function addTrailToClip(clip: Clip) {
  const points: TrailPoint[] = [];
  const seenNames = new Set<string>();

  // Segments are typically chronological in the clip
  for (const seg of clip.segments) {
    const locations = (seg.metadata?.[PLUGIN_ID] ?? []) as GeoMetadata[];
    for (const loc of locations) {
      if (!seenNames.has(loc.placeName || '')) {
        points.push({
          lat: loc.lat,
          lng: loc.lng,
          name: loc.placeName,
        });
        if (loc.placeName) seenNames.add(loc.placeName);
      }
    }
  }

  if (points.length > 0) {
    const trailEntry: TrailMetadata = {
      type: 'trail',
      sourcePluginId: PLUGIN_ID,
      points,
    };
    if (!clip.metadata) clip.metadata = {};
    clip.metadata[PLUGIN_ID] = [trailEntry];
  }
}
