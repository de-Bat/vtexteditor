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
 * Segments are listed chronologically as [SEGMENT_ID] text.
 */
export function buildPrompt(clips: Clip[], config: PromptConfig): string {
  const lines = clips
    .flatMap(c => c.segments)
    .sort((a, b) => a.startTime - b.startTime)
    .map(s => `[${s.id}] ${s.text}`)
    .join('\n');

  const seedLine = config.seedCategories
    ? `\nThe interviewer suggested these possible life chapters: ${config.seedCategories}\n`
    : '';

  const langLine = config.language
    ? `\nRespond with event titles in: ${config.language}\n`
    : '';

  return `You are helping reconstruct a life story from an interview transcript.

Below is the transcript, one segment per line, formatted as [SEGMENT_ID] text:

${lines}
${seedLine}${langLine}
Group these segments into meaningful life events (maximum ${config.maxEvents} events).
Each event should tell a coherent chapter of the interviewee's life story.
You may reorder segments within an event to improve narrative flow.
Each segment may appear in at most one event.
Omit segments that do not fit any chapter.

Return ONLY a JSON array — no explanation, no markdown fences:
[
  { "title": "Event name", "segments": ["segment-id-1", "segment-id-2"] },
  ...
]`;
}

/**
 * Parses the LLM response text into a list of events with validated segment IDs.
 * Strips markdown fences, validates segment IDs against the known set.
 */
export function parseEvents(
  responseText: string,
  validSegmentIds: Set<string>,
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
      segments: (e.segments as unknown[]).filter(
        (id): id is string => typeof id === 'string' && validSegmentIds.has(id),
      ),
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
