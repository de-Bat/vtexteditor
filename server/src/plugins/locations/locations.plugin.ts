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

    const total = allSegments.length;
    let completed = 0;
    let totalLocations = 0;
    let segmentsWithLocations = 0;

    for (let i = 0; i < total; i += batchSize) {
      const batch = allSegments.slice(i, i + batchSize).filter(s => !processedSegIds.has(s.id));
      if (batch.length === 0) continue;

      const active = batch.length;
      const pending = total - completed - active;

      batch.forEach(s => processedSegIds.add(s.id));

      const progressMsg = `Detecting locations (${completed}/[blue:${total}]) — [green:${active}] active, [orange:${pending}] pending…`;
      const progressPercent = Math.round((completed / total) * 100);
      ctx.reportProgress?.(progressMsg, progressPercent);
      
      const prompt = buildExtractionPrompt(batch);
      
      try {
        const responseText = await callCopilotStudio(prompt, model);
        const results = parseResults(responseText);
        const batchLocs = applyResults(batch, results, minConfidence);
        totalLocations += batchLocs.count;
        segmentsWithLocations += batchLocs.segmentsCount;
      } catch (err) {
        console.error(`[locations] Error processing batch starting at ${i}:`, err);
        // Continue to next batch
      }
      completed += active;
    }

    // After adding locations to segments, add trail to each clip
    ctx.reportProgress?.('Generating travel trails for clips…', 95);
    let clipsWithTrails = 0;
    for (const clip of allClips) {
      if (addTrailToClip(clip)) {
        clipsWithTrails++;
      }
    }

    console.log(`[locations] Complete. Found ${totalLocations} locations across ${segmentsWithLocations} segments. Generated trails for ${clipsWithTrails} clips.`);
    ctx.reportProgress?.('Locations processing complete.', 100);
    return ctx;
  },
};

/**
 * Builds the LLM prompt for location extraction.
 */
export function buildExtractionPrompt(segments: Segment[]): string {
  const transcript = segments.map(s => `[${s.id}] ${s.text}`).join('\n');
  return `Identify specific geographical locations (cities, countries, specific neighborhoods, landmarks, or precise addresses) mentioned in the following transcript segments.

IMPORTANT RULES:
1. Do NOT identify general or generic places like "synagogue", "church", "store", "school", "park", "forest", or "house" UNLESS they are part of a specific proper name (e.g. "St. Patrick's Cathedral" is OK, but "the cathedral" is NOT).
2. Use the context of the conversation to identify the most specific location possible.
3. For each location, provide approximate lat/lng coordinates.

For each segment, list every specific location found. For each location, provide:
- name: The name of the place.
- lat: Approximate latitude.
- lng: Approximate longitude.
- confidence: Your confidence score (0.0 to 1.0) that this is a specific location mention and the coordinates are correct.

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
 * Returns counts of locations and segments updated.
 */
export function applyResults(segments: Segment[], results: Record<string, any[]>, minConfidence: number): { count: number, segmentsCount: number } {
  let count = 0;
  let segmentsCount = 0;
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
      seg.metadata[PLUGIN_ID] = [...(seg.metadata[PLUGIN_ID] ?? []), ...geoEntries];
      count += geoEntries.length;
      segmentsCount++;
    }
  }
  return { count, segmentsCount };
}

/**
 * Consolidates all locations in a clip into a chronological TrailMetadata.
 * Returns true if a trail was added.
 */
export function addTrailToClip(clip: Clip): boolean {
  const points: TrailPoint[] = [];
  const seenNames = new Set<string>();

  // Segments are typically chronological in the clip
  for (const seg of clip.segments) {
    const locations = (seg.metadata?.[PLUGIN_ID] ?? []) as GeoMetadata[];
    for (const loc of locations) {
      const name = loc.placeName?.toLowerCase().trim();
      if (name && !seenNames.has(name)) {
        points.push({
          lat: loc.lat,
          lng: loc.lng,
          name: loc.placeName,
        });
        seenNames.add(name);
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
    return true;
  }
  return false;
}
