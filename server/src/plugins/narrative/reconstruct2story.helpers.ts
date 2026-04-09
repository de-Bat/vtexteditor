import { Clip } from '../../models/clip.model';

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
