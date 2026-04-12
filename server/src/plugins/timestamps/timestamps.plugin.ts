import { IPlugin } from '../plugin.interface';
import { PipelineContext } from '../../models/pipeline-context.model';
import { DateIntervalMetadata } from '../../models/segment-metadata.model';
import { callCopilotStudio } from '../narrative/copilot.client';
import { Clip } from '../../models/clip.model';
import { Segment } from '../../models/segment.model';

interface TimestampsConfig {
  model?: string;
  batchSize?: number;
}

const PLUGIN_ID = 'timestamps';

/**
 * Extraction plugin that identifies temporal references (specific dates, months, years, decades) in the transcript.
 * Adds DateIntervalMetadata to segments and consolidates them for the clip.
 */
export const timestampsPlugin: IPlugin = {
  id: PLUGIN_ID,
  name: 'Temporal Timestamps',
  description: 'Identifies temporal references like years, months, and decades in transcript segments.',
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
        default: 40,
      },
    },
  },

  async execute(ctx: PipelineContext): Promise<PipelineContext> {
    const cfg = (ctx.metadata[PLUGIN_ID] ?? {}) as TimestampsConfig;
    const model = cfg.model ?? 'gpt-4.1';
    const batchSize = cfg.batchSize ?? 40;

    const allClips = ctx.clips;
    const allSegments: Segment[] = allClips.flatMap(c => c.segments);

    if (allSegments.length === 0) {
      console.log(`[timestamps] No segments to process.`);
      return ctx;
    }

    console.log(`[timestamps] processing ${allSegments.length} segments in batches of ${batchSize}`);

    const processedSegIds = new Set<string>();

    for (let i = 0; i < allSegments.length; i += batchSize) {
      const batch = allSegments.slice(i, i + batchSize).filter(s => !processedSegIds.has(s.id));
      if (batch.length === 0) continue;

      batch.forEach(s => processedSegIds.add(s.id));

      const progressMsg = `Analyzing timestamps in segments ${i + 1} to ${Math.min(i + batchSize, allSegments.length)}…`;
      const progressPercent = Math.round((i / allSegments.length) * 100);
      ctx.reportProgress?.(progressMsg, progressPercent);
      
      const prompt = buildExtractionPrompt(batch);
      
      try {
        const responseText = await callCopilotStudio(prompt, model);
        const results = parseResults(responseText);
        applyResults(batch, results);
      } catch (err) {
        console.error(`[timestamps] Error processing batch starting at ${i}:`, err);
      }
    }

    // After adding timestamps to segments, aggregate for each clip
    ctx.reportProgress?.('Consolidating temporal intervals for clips…', 95);
    for (const clip of allClips) {
      addIntervalToClip(clip);
    }

    ctx.reportProgress?.('Timestamps processing complete.', 100);
    return ctx;
  },
};

/**
 * Builds the LLM prompt for temporal extraction.
 */
export function buildExtractionPrompt(segments: Segment[]): string {
  const transcript = segments.map(s => `[${s.id}] ${s.text}`).join('\n');
  return `Identify temporal references (specific years, months, decades like "the 30s", or specific dates) mentioned in the following transcript segments.
For each segment, list every temporal reference found. For each reference, provide:
- label: The text representation (e.g., "1935", "January 1944", "the 30s", "1950-1960").
- startYear: The earliest year mentioned or implied by the reference (as a number).
- endYear: The latest year mentioned or implied (as a number). If it's a single year, startYear and endYear should be the same.

Segments:
${transcript}

IMPORTANT: Return ONLY a valid JSON object mapping segment IDs to an array of temporal objects. 
If a segment has no temporal references, return an empty array for its ID.
Format:
{
  "uuid-1": [
    { "label": "1935", "startYear": 1935, "endYear": 1935 }
  ],
  "uuid-2": [
    { "label": "the 30s", "startYear": 1930, "endYear": 1939 }
  ],
  "uuid-3": []
}`;
}

/**
 * Parses the JSON results from the LLM response.
 */
export function parseResults(response: string): Record<string, any[]> {
  const cleaned = response.replace(/```json/g, '').replace(/```/g, '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON object found in LLM response');
  }
  return JSON.parse(jsonMatch[0]);
}

/**
 * Updates segments with DateIntervalMetadata based on LLM results.
 */
export function applyResults(segments: Segment[], results: Record<string, any[]>) {
  for (const seg of segments) {
    const rawIntervals = results[seg.id] ?? [];
    if (!Array.isArray(rawIntervals)) continue;

    const intervalEntries: DateIntervalMetadata[] = rawIntervals
      .filter(ti => ti.label)
      .map(ti => ({
        type: 'dateInterval',
        sourcePluginId: PLUGIN_ID,
        label: ti.label,
        startYear: typeof ti.startYear === 'number' ? ti.startYear : undefined,
        endYear: typeof ti.endYear === 'number' ? ti.endYear : undefined,
      }));

    if (intervalEntries.length > 0) {
      if (!seg.metadata) seg.metadata = {};
      seg.metadata[PLUGIN_ID] = [...(seg.metadata[PLUGIN_ID] ?? []), ...intervalEntries];
    }
  }
}

/**
 * Aggregates all temporal intervals in a clip into a single consolidated interval.
 */
export function addIntervalToClip(clip: Clip) {
  let minYear: number | undefined;
  let maxYear: number | undefined;
  const labels: string[] = [];
  const seenLabels = new Set<string>();

  for (const seg of clip.segments) {
    const intervals = (seg.metadata?.[PLUGIN_ID] ?? []) as DateIntervalMetadata[];
    for (const inv of intervals) {
      if (inv.startYear !== undefined) {
        minYear = minYear === undefined ? inv.startYear : Math.min(minYear, inv.startYear);
      }
      if (inv.endYear !== undefined) {
        maxYear = maxYear === undefined ? inv.endYear : Math.max(maxYear, inv.endYear);
      }
      if (!seenLabels.has(inv.label)) {
        labels.push(inv.label);
        seenLabels.add(inv.label);
      }
    }
  }

  if (labels.length > 0) {
    let finalLabel = '';
    if (minYear !== undefined && maxYear !== undefined) {
      finalLabel = minYear === maxYear ? `${minYear}` : `${minYear} - ${maxYear}`;
    } else {
      finalLabel = labels.join(', ');
    }

    const clipInterval: DateIntervalMetadata = {
      type: 'dateInterval',
      sourcePluginId: PLUGIN_ID,
      label: finalLabel,
      startYear: minYear,
      endYear: maxYear,
    };

    if (!clip.metadata) clip.metadata = {};
    clip.metadata[PLUGIN_ID] = [clipInterval];
  }
}
