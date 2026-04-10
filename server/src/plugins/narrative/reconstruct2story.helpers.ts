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
 * Returns the prompt string AND a map from short ID → real segment UUID so
 * the caller can reverse-map the LLM response back to real IDs.
 */
export function buildPrompt(
  clips: Clip[],
  config: PromptConfig,
): { prompt: string; shortIdMap: Map<string, string> } {
  const allSegments = clips
    .flatMap(c => c.segments)
    .sort((a, b) => a.startTime - b.startTime);

  // Build short-ID ↔ real-UUID mapping
  const shortIdMap = new Map<string, string>(); // shortId → realId
  const toShort = new Map<string, string>();     // realId  → shortId
  allSegments.forEach((seg, i) => {
    const shortId = `S${String(i + 1).padStart(3, '0')}`;
    shortIdMap.set(shortId, seg.id);
    toShort.set(seg.id, shortId);
  });

  const lines = allSegments
    .map(s => `[${toShort.get(s.id)}] ${s.text}`)
    .join('\n');

  const seedLine = config.seedCategories
    ? `\nThe interviewer suggested these possible life chapters: ${config.seedCategories}\n`
    : '';

  const langLine = config.language
    ? `\nRespond with event titles in: ${config.language}\n`
    : '';

  const prompt = `You are helping reconstruct a life story from an interview transcript.

Below is the transcript, one segment per line, formatted as [ID] text:

${lines}
${seedLine}${langLine}
Group these segments into meaningful life events (maximum ${config.maxEvents} events).
Each event should tell a coherent chapter of the interviewee's life story.
You may reorder segments within an event to improve narrative flow.
Each segment may appear in at most one event.
Omit segments that do not fit any chapter.

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

  for (const event of events) {
    const acceptedSegments: Segment[] = event.segments
      .filter(ref => ref.accepted)
      .map(ref => {
        const seg = segmentMap.get(ref.segmentId);
        if (!seg) return null;
        return { ...seg, clipId: event.id };
      })
      .filter((s): s is Segment => s !== null);

    if (acceptedSegments.length === 0) continue;

    result.push({
      id: event.id,
      projectId,
      name: `${prefix}: ${event.title}`,
      startTime: acceptedSegments[0].startTime,
      endTime: acceptedSegments[acceptedSegments.length - 1].endTime,
      segments: acceptedSegments,
    });
  }

  return result;
}
