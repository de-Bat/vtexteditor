import { v4 as uuidv4 } from 'uuid';
import { Clip } from '../../models/clip.model';
import { Segment } from '../../models/segment.model';
import { StoryEvent } from './reconstruct2story.types';

interface PromptConfig {
  maxEvents: number;
  seedCategories?: string;
  language?: string;
}

/**
 * Builds the LLM prompt from source clips.
 *
 * Segments are listed as short sequential IDs (S001, S002, …) instead of raw
 * UUIDs. UUIDs are 36 characters long and error-prone for LLMs to reproduce
 * verbatim; short IDs eliminate that class of hallucination entirely.
 *
 * Returns the prompt string AND a map from short ID → compound key
 * (`clipId:segmentId`). Using a compound key instead of the raw segment UUID
 * prevents collisions when multiple clips share the same segment ID (which can
 * happen after a reconstruct2story commit propagates IDs across clips).
 */
export function buildPrompt(
  clips: Clip[],
  config: PromptConfig,
): { prompt: string; shortIdMap: Map<string, string> } {
  const allSegments = clips
    .flatMap(c => c.segments)
    .sort((a, b) => a.startTime - b.startTime);

  // Build short-ID → compound-key mapping.
  // Compound key format: `${seg.clipId}:${seg.id}`.
  // This stays unique even when the same seg.id appears in multiple clips.
  const shortIdMap = new Map<string, string>(); // shortId → clipId:segId
  allSegments.forEach((seg, i) => {
    const shortId = `S${String(i + 1).padStart(3, '0')}`;
    shortIdMap.set(shortId, `${seg.clipId}:${seg.id}`);
  });

  // Build prompt lines using the positional short ID directly (not via a
  // reverse map) so duplicate seg.ids never cause label collisions.
  const lines = allSegments
    .map((s, i) => {
      const shortId = `S${String(i + 1).padStart(3, '0')}`;
      let text = s.text.trim();
      
      // Label completely silent segments
      if (!text) text = '[Silence]';

      // Detect internal gaps between words (> 2s)
      const internalGaps: string[] = [];
      for (let j = 1; j < s.words.length; j++) {
        const gap = s.words[j].startTime - s.words[j - 1].endTime;
        if (gap > 2) {
          internalGaps.push(`(Pause ${gap.toFixed(1)}s)`);
        }
      }
      
      if (internalGaps.length > 0) {
        // We just append a note to the LLM; we don't try to interleave it
        // perfectly to avoid confusing the JSON parser if it looks like multiple segments.
        text += ` ${internalGaps.join(' ')}`;
      }

      return `[${shortId}] ${text}`;
    })
    .join('\n');

  const seedLine = config.seedCategories
    ? `\nThe interviewer suggested these possible life chapters: ${config.seedCategories}\n`
    : '';

  const langLine = config.language && config.language !== 'Auto-detect'
    ? `\nRespond with event titles in: ${config.language}\n`
    : `\nRespond with event titles in the same language as the transcription provided above.\n`;

  const prompt = `You are helping reconstruct a detailed life story from an interview transcript.

Below is the transcript, one segment per line, formatted as [ID] text:

${lines}
${seedLine}${langLine}
Instructions:
1. Group these segments into granular narrative events (maximum ${config.maxEvents} events).
2. Create a coherent storyline by grouping related sentences into the same granular event.
3. Use highly specific, granular events instead of broad ones. For example, instead of broad chapters like "Childhood", break it down into specific themes or events (e.g., "Family", "Village", "School", "Tradition", "Army", etc.).
4. You may reorder segments within an event to improve narrative flow if necessary.
5. Each segment may appear in at most one event.
6. INCLUDE ALL SEGMENTS. Do not edit the text, omit, or drop any segments. Keep silent sections or tangential moments; place them in the most fitting event to preserve the entire timeline.

Return ONLY a JSON array — no explanation, no markdown fences:
[
  { "title": "Event name", "segments": ["S001", "S002"] },
  ...
]`;

  return { prompt, shortIdMap };
}

/**
 * Parses the LLM response text into a list of events with validated segment IDs.
 * Strips markdown fences, converts short IDs back to real UUIDs via shortIdMap,
 * and validates the result against the known segment-ID set.
 */
export function parseEvents(
  responseText: string,
  validSegmentIds: Set<string>,
  shortIdMap?: Map<string, string>,
): Array<{ title: string; segments: string[] }> {
  const cleaned = responseText.replace(/```(?:json)?|```/g, '').trim();
  const raw = JSON.parse(cleaned) as unknown;
  if (!Array.isArray(raw)) throw new Error('LLM response is not a JSON array');

  return (raw as unknown[])
    .filter(
      (e): e is { title: string; segments: unknown[] } =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as Record<string, unknown>)['title'] === 'string' &&
        Array.isArray((e as Record<string, unknown>)['segments']),
    )
    .map(e => ({
      title: e.title,
      segments: (e.segments as unknown[])
        .filter((id): id is string => typeof id === 'string')
        // Resolve short IDs (S001 …) back to real UUIDs when map is provided.
        // Falls back to the raw ID so callers that pass real UUIDs still work.
        .map(id => shortIdMap?.get(id) ?? id)
        .filter(id => validSegmentIds.has(id)),
    }))
    .filter(e => e.segments.length > 0);
}

/**
 * Converts approved StoryEvents into Clip objects, copying verbatim Segment data
 * from the source clips. Drops events with zero accepted segments.
 */
export function buildCommitClips(
  projectId: string,
  events: StoryEvent[],
  sourceClips: Clip[],
  prefix: string,
): Clip[] {
  const segmentMap = new Map<string, Segment>();
  for (const clip of sourceClips) {
    for (const seg of clip.segments) {
      segmentMap.set(seg.id, seg);
    }
  }

  const result: Clip[] = [];

  // Build a flat, ordered list of all source segments to detect omitted gaps
  const allSourceSegments = sourceClips
    .flatMap(c => c.segments)
    .sort((a, b) => a.startTime - b.startTime);
  
  const sourceSegmentIndexMap = new Map<string, number>();
  allSourceSegments.forEach((s, i) => sourceSegmentIndexMap.set(s.id, i));

  for (const event of events) {
    const eventSegments = event.segments
      .filter(ref => ref.accepted)
      .map(ref => {
        const sourceSeg = segmentMap.get(ref.segmentId);
        if (!sourceSeg) return null;
        return {
          sourceId: sourceSeg.id,
          newSeg: { ...sourceSeg, id: uuidv4(), clipId: event.id },
        };
      })
      .filter((s): s is { sourceId: string; newSeg: Segment } => s !== null);

    if (eventSegments.length === 0) continue;

    const acceptedSegments = eventSegments.map(e => e.newSeg);
    const cutRegions: any[] = [];

    // Gap-to-Cut Processing: If segments in the story were separated by omitted
    // content in the source, we mark the gap as a CUT to ensure it's skipped.
    for (let i = 0; i < eventSegments.length - 1; i++) {
      const curSourceId = eventSegments[i].sourceId;
      const nextSourceId = eventSegments[i + 1].sourceId;
      const curIdx = sourceSegmentIndexMap.get(curSourceId)!;
      const nextIdx = sourceSegmentIndexMap.get(nextSourceId)!;

      // If they were not consecutive in the original project, mark as cut.
      if (nextIdx > curIdx + 1) {
        const curSeg = acceptedSegments[i];
        const nextSeg = acceptedSegments[i + 1];
        if (nextSeg.startTime > curSeg.endTime + 0.05) {
          cutRegions.push({
            id: uuidv4(),
            wordIds: [],
            startTime: curSeg.endTime,
            endTime: nextSeg.startTime,
            effectType: 'hard-cut',
            effectTypeOverridden: false,
            effectDuration: 200,
            durationFixed: false,
          });
        }
      }
    }

    result.push({
      id: event.id,
      projectId,
      name: `${prefix}: ${event.title}`,
      startTime: acceptedSegments[0].startTime,
      endTime: acceptedSegments[acceptedSegments.length - 1].endTime,
      segments: acceptedSegments,
      cutRegions,
      showSilenceMarkers: true,
    });
  }

  return result;
}
