export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/** Convert seconds to SRT timecode: HH:MM:SS,mmm */
export function toSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return [
    String(h).padStart(2, '0'),
    String(m).padStart(2, '0'),
    String(s).padStart(2, '0'),
  ].join(':') + ',' + String(ms).padStart(3, '0');
}

/**
 * Parse an SRT file string into an array of segments.
 * Returns segments with estimated word-level timestamps.
 */
export interface SrtEntry {
  index: number;
  startTime: number;
  endTime: number;
  text: string;
}

export function parseSrt(content: string): SrtEntry[] {
  const blocks = content.trim().split(/\r?\n\r?\n/);
  return blocks
    .map((block) => {
      const lines = block.split(/\r?\n/);
      if (lines.length < 3) return null;
      const index = parseInt(lines[0].trim(), 10);
      const timeLine = lines[1].trim();
      const timeMatch = timeLine.match(
        /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/
      );
      if (!timeMatch) return null;
      const toSec = (h: string, m: string, s: string, ms: string) =>
        parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000;
      const startTime = toSec(timeMatch[1], timeMatch[2], timeMatch[3], timeMatch[4]);
      const endTime = toSec(timeMatch[5], timeMatch[6], timeMatch[7], timeMatch[8]);
      const text = lines.slice(2).join(' ').replace(/<[^>]+>/g, '').trim();
      return { index, startTime, endTime, text };
    })
    .filter((e): e is SrtEntry => e !== null);
}

/**
 * Given a segment's startTime, endTime, and text,
 * estimate per-word timestamps proportional to character length.
 */
export function estimateWordTimestamps(
  startTime: number,
  endTime: number,
  text: string
): Array<{ text: string; startTime: number; endTime: number }> {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const duration = endTime - startTime;
  const totalChars = words.reduce((sum, w) => sum + w.length, 0);

  const result: Array<{ text: string; startTime: number; endTime: number }> = [];
  let cursor = startTime;
  for (const word of words) {
    const wordDuration = totalChars > 0 ? (word.length / totalChars) * duration : duration / words.length;
    result.push({ text: word, startTime: cursor, endTime: cursor + wordDuration });
    cursor += wordDuration;
  }
  return result;
}
