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

  const prompt = `You are reconstructing a life story from interview transcript segments.

INPUT FORMAT:
Each line is a segment:
[ID] text

${lines}
${seedLine}${langLine}

--------------------------------
HARD CONSTRAINTS (MUST FOLLOW)
--------------------------------
- Use ONLY the provided segment IDs (e.g., S001, S002)
- DO NOT invent, modify, merge, or split segments
- DO NOT create new IDs
- Each segment ID may appear AT MOST ONCE
- You MAY omit irrelevant segments
- DO NOT reuse a segment in multiple events

--------------------------------
OBJECTIVE
--------------------------------
Group segments into distinct life events and present them as a coherent first-person narrative.

--------------------------------
EVENT RULES
--------------------------------
- Maximum ${config.maxEvents} events
- Each event = ONE specific moment, experience, or theme
- Prefer meaningful, coherent events over excessive fragmentation
- Segments in an event may come from anywhere in the input
- Maintain logical and narrative coherence

--------------------------------
EVENT GROUPING (ANTI-OVER-SPLITTING)
--------------------------------
- DO NOT over-divide events that belong to the same broader experience
- If multiple segments describe different parts of a continuous or related experience,
  group them into a SINGLE event
- Example: early school memories + later school experiences → ONE event (e.g., "School Experience")
- Only split into separate events when there is a clear shift in context, time, or life phase

--------------------------------
EVENT DURATION (SOFT CONSTRAINT)
--------------------------------
- Each event should typically represent ~10–15 minutes of real time
- Prefer shorter, tightly scoped moments over long, continuous stretches
- If an event clearly spans a longer period and cannot be meaningfully split,
  you MAY keep it as a single event
- Do NOT force artificial splits if it would break coherence or meaning

--------------------------------
SEGMENT HANDLING
--------------------------------
- You MAY reorder segments within an event
- Preserve original meaning and wording
- Only perform LIGHT CLEANUP:
  - Remove filler words (um, uh, like, you know, etc.)
  - Remove stutters and repetitions
  - Remove [Silence] or pause markers unless meaningful
- DO NOT paraphrase, summarize, or rewrite content

--------------------------------
TITLES
--------------------------------
- 2–6 words
- Specific and descriptive (avoid vague phrases like "Early Life")
${config.language && config.language !== 'Auto-detect'
      ? `- Titles MUST be in ${config.language}`
      : `- Titles MUST match the transcript language`
    }

--------------------------------
OUTPUT FORMAT (STRICT)
--------------------------------
Return ONLY a valid JSON array.

Each item MUST be:
{
  "title": "string",
  "segments": [
    { "id": "S001", "text": "string" }
  ]
}

--------------------------------
FORMAT RULES (ZERO TOLERANCE)
--------------------------------
- NO markdown
- NO explanations
- NO extra text
- NO additional fields
- NO missing fields
- NO trailing commas
- Keys MUST be exactly: "title", "segments", "id", "text"

--------------------------------
FINAL VALIDATION (REQUIRED)
--------------------------------
Before finishing, ensure:
- Output is valid JSON
- Top-level is an array
- Each event has "title" and "segments"
- Each segment has ONLY "id" and "text"
- No duplicate segment IDs
- All IDs exist in the input

Now produce the result.
`;

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
): Array<{ title: string; segments: Array<{ id: string; text?: string }> }> {
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
        .map(item => {
          if (typeof item === 'string') return { id: item, text: undefined };
          if (typeof item === 'object' && item !== null) {
            const obj = item as Record<string, unknown>;
            if (typeof obj['id'] === 'string') {
              return { id: obj['id'], text: typeof obj['text'] === 'string' ? obj['text'] : undefined };
            }
          }
          return null;
        })
        .filter((item): item is { id: string; text: string | undefined } => item !== null)
        // Resolve short IDs (S001 …) back to real UUIDs when map is provided.
        .map(item => ({
          ...item,
          id: shortIdMap?.get(item.id) ?? item.id,
        }))
        .filter(item => validSegmentIds.has(item.id)),
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
        const newSeg = { ...sourceSeg, id: uuidv4(), clipId: event.id };
        const trimmedSeg = ref.text ? applyTrimming(newSeg, ref.text) : newSeg;
        return {
          sourceId: sourceSeg.id,
          newSeg: trimmedSeg,
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
      // Use the actual (possibly trimmed) startTime/endTime of the first/last segment
      startTime: acceptedSegments[0].startTime,
      endTime: acceptedSegments[acceptedSegments.length - 1].endTime,
      segments: acceptedSegments,
      cutRegions,
      showSilenceMarkers: true,
    });
  }

  return result;
}

/**
 * Matches targetText against original segment words. Marks missing words as
 * isRemoved: true and tightens segment boundaries to first/last kept words.
 */
function applyTrimming(seg: Segment, targetText: string): Segment {
  const normalize = (t: string) => t.toLowerCase().replace(/[.,!?;:()\[\]"]/g, '').trim();
  const targetWords = targetText.split(/\s+/).map(normalize).filter(Boolean);
  if (targetWords.length === 0) return seg;

  const originalWords = seg.words;
  if (originalWords.length === 0) return seg;

  const updatedWords = originalWords.map(w => ({ ...w, isRemoved: true }));
  let firstKeptIdx = -1;
  let lastKeptIdx = -1;
  let targetIdx = 0;

  // Greedy match: find target words in order within the original sequence.
  // This preserves audio sync and prevents nonsensical jumping.
  for (let i = 0; i < updatedWords.length; i++) {
    const wNorm = normalize(updatedWords[i].text);
    if (!wNorm) continue; // Skip silence/punctuation-only tokens if any

    if (targetIdx < targetWords.length && wNorm === targetWords[targetIdx]) {
      updatedWords[i].isRemoved = false;
      if (firstKeptIdx === -1) firstKeptIdx = i;
      lastKeptIdx = i;
      targetIdx++;
    }
  }

  if (firstKeptIdx !== -1) {
    seg.words = updatedWords;
    seg.startTime = updatedWords[firstKeptIdx].startTime;
    seg.endTime = updatedWords[lastKeptIdx].endTime;
    seg.text = targetText;
  }

  return seg;
}
