import fs from 'fs';
import path from 'path';
import Groq from 'groq-sdk';
import { IPlugin } from '../plugin.interface';
import { PipelineContext } from '../../models/pipeline-context.model';
import { Clip } from '../../models/clip.model';
import { Segment } from '../../models/segment.model';
import { Word } from '../../models/word.model';
import { v4 as uuidv4 } from 'uuid';
import { extractAudioTrack, makeTempAudioPath } from '../../utils/ffmpeg.util';
import { chunkAndTranscribe, RawSegment } from '../../utils/chunked-transcription.util';
import { settingsService } from '../../services/settings.service';

interface GroqConfig {
  apiKey?: string;
  model?: string;
  language?: string;
  clipName?: string;
  segmentBySpeech?: boolean;
  showSilenceMarkers?: boolean;
  chunkDurationSecs?: number;
  maxConcurrent?: number;
  reuseIfCached?: boolean;
}

interface GroqWord {
  word: string;
  start: number;
  end: number;
}

interface GroqSegment {
  start: number;
  end: number;
  text: string;
  words?: GroqWord[];
}

export const groqWhisperPlugin: IPlugin = {
  id: 'groq-whisper',
  name: 'Groq Whisper',
  description: 'Fast transcription via Groq inference API using whisper-large-v3-turbo.',
  type: 'transcription',
  hasUI: false,
  settingsMap: {
    segmentBySpeech:     'SEGMENT_BY_SPEECH',
    showSilenceMarkers:  'SHOW_SILENCE_MARKERS',
  },
  configSchema: {
      type: 'object',
      properties: {
        apiKey: {
          type: 'string',
          title: 'Groq API Key',
          description: 'Your Groq API key (or set GROQ_API_KEY env var)',
        },
        model: {
          type: 'string',
          title: 'Model',
          enum: ['whisper-large-v3', 'whisper-large-v3-turbo', 'distil-whisper-large-v3-en'],
          default: 'whisper-large-v3-turbo',
        },
        language: {
          type: 'string',
          title: 'Language Code',
          description: 'ISO 639-1 code, e.g. "en". Leave blank for auto-detect.',
          default: '',
        },
        segmentBySpeech: {
          type: 'boolean',
          title: 'Segment by Speech',
          description: 'Split transcript into segments based on natural speech pauses. When off, merges everything into a single segment.',
          default: true,
        },
        showSilenceMarkers: {
          type: 'boolean',
          title: 'Tag Silence Segments',
          description: 'Mark silence gaps between speech segments in the transcript viewer.',
          default: false,
        },
        clipName: {
          type: 'string',
          title: 'Clip Name',
          default: 'Groq Transcription',
        },
        chunkDurationSecs: {
          type: 'number',
          title: 'Chunk Duration (seconds)',
          description: 'Audio is split into chunks of this length and transcribed in parallel. Reduce for faster results on long recordings.',
          default: 300,
        },
        maxConcurrent: {
          type: 'number',
          title: 'Max Parallel Chunks',
          description: 'Maximum number of simultaneous Groq API calls. Lower this if you hit rate limits.',
          default: 3,
        },
        reuseIfCached: {
          type: 'boolean',
          title: 'Reuse cached transcription',
          description: 'Skip the API call if this media was already transcribed with the same plugin, model, and language.',
          default: true,
        },
      },
      required: [],
  },

  async execute(ctx: PipelineContext): Promise<PipelineContext> {
    const cfg = (ctx.metadata['groq-whisper'] ?? {}) as GroqConfig;

    const tag = '[groq-whisper]';
    const reuseIfCached = cfg.reuseIfCached !== false; // default true
    const model = cfg.model ?? 'whisper-large-v3-turbo';
    const language = (cfg.language ?? '').trim();
    const cacheKey = `groq-whisper:${ctx.mediaHash}:${model}:${language}`;

    if (reuseIfCached && ctx.cache.has(cacheKey)) {
      console.log(`${tag} cache HIT  key=${cacheKey.slice(0, 48)}… — skipping transcription`);
      const cached = ctx.cache.get<RawSegment[]>(cacheKey)!;
      return buildClip(cached, cfg, ctx);
    }
    console.log(reuseIfCached
      ? `${tag} cache MISS  key=${cacheKey.slice(0, 48)}… — transcribing`
      : `${tag} reuseIfCached=false — transcribing (cache will be updated)`);

    const apiKey = cfg.apiKey ?? process.env['GROQ_API_KEY'] ?? settingsService.get('GROQ_API_KEY');
    if (!apiKey) throw new Error('Groq API key required. Set GROQ_API_KEY env var, configure it in App Settings, or provide apiKey in the pipeline config.');

    const groq = new Groq({ apiKey });

    if (!fs.existsSync(ctx.mediaPath)) throw new Error(`Media file not found: ${ctx.mediaPath}`);

    // For video files, strip the video track first — sending only the audio
    // channel is faster, cheaper, and avoids API file-size limits.
    let audioPath = ctx.mediaPath;
    let tempCreated = false;
    if (ctx.mediaInfo.videoCodec) {
      const tempPath = makeTempAudioPath(uuidv4());
      await extractAudioTrack(ctx.mediaPath, tempPath);
      audioPath = tempPath;
      tempCreated = true;
    }

    // Local function: transcribe one WAV chunk via Groq
    const transcribeChunk = async (chunkPath: string): Promise<RawSegment[]> => {
      const fileStream = fs.createReadStream(chunkPath) as unknown as File;
      const transcription = await groq.audio.transcriptions.create({
        file: fileStream,
        model: model as 'whisper-large-v3' | 'whisper-large-v3-turbo' | 'distil-whisper-large-v3-en',
        response_format: 'verbose_json',
        timestamp_granularities: ['word', 'segment'],
        ...(language ? { language } : {}),
      });
      const raw = transcription as unknown as { segments?: GroqSegment[] };
      return (raw.segments ?? []).map((seg) => ({
        start: seg.start,
        end: seg.end,
        text: seg.text.trim(),
        words: seg.words?.map((w) => ({ word: w.word, start: w.start, end: w.end })),
      }));
    };

    const chunkDurationSecs = typeof cfg.chunkDurationSecs === 'number' ? cfg.chunkDurationSecs : 300;
    const maxConcurrent = typeof cfg.maxConcurrent === 'number' ? cfg.maxConcurrent : 3;

    let rawSegments: RawSegment[];
    try {
      rawSegments = await chunkAndTranscribe(
        audioPath,
        transcribeChunk,
        { chunkDurationSecs, maxConcurrent },
        ctx.mediaInfo?.duration,
        (p) => ctx.reportProgress?.(`Transcribing chunks...`, p),
      );
    } finally {
      if (tempCreated && fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    }

    if (!rawSegments.length) {
      throw new Error(`${tag} Transcription returned no segments. Verify the Groq API key and model name.`);
    }

    console.log(`${tag} cache WRITE  key=${cacheKey.slice(0, 48)}…  segments: ${rawSegments.length}`);
    ctx.cache.set(cacheKey, rawSegments);

    return buildClip(rawSegments, cfg, ctx);
  },
};

function buildClip(rawSegments: RawSegment[], cfg: GroqConfig, ctx: PipelineContext): PipelineContext {
  const coerceBool = (v: unknown, fallback: boolean) =>
    v === true || String(v).toLowerCase() === 'true' ? true
      : v === false || String(v).toLowerCase() === 'false' ? false
      : fallback;

  const segmentBySpeech = coerceBool(cfg.segmentBySpeech, true);
  const showSilenceMarkers = coerceBool(cfg.showSilenceMarkers, false);
  const clipId = uuidv4();
  const clipName = cfg.clipName ?? 'Groq Transcription';

  const segments: Segment[] = rawSegments.map((raw) => {
    const segId = uuidv4();
    let words: Word[];
    if (raw.words?.length) {
      words = raw.words.map((w) => ({
        id: uuidv4(),
        segmentId: segId,
        text: w.word.trim(),
        startTime: w.start,
        endTime: w.end,
        isRemoved: false,
      }));
    } else {
      words = estimateWords(segId, raw.text, raw.start, raw.end);
    }
    return {
      id: segId,
      clipId,
      startTime: raw.start,
      endTime: raw.end,
      text: raw.text,
      words,
      tags: [],
    };
  });

  const finalSegments = segmentBySpeech ? segments : mergeSegments(clipId, segments);

  const clip: Clip = {
    id: clipId,
    projectId: ctx.projectId,
    name: clipName,
    startTime: finalSegments[0]?.startTime ?? 0,
    endTime: finalSegments[finalSegments.length - 1]?.endTime ?? (ctx.mediaInfo?.duration ?? 0),
    segments: finalSegments,
    showSilenceMarkers,
  };

  return { ...ctx, clips: [...ctx.clips, clip] };
}

/** Merge all segments into a single segment with combined words. */
function mergeSegments(clipId: string, segments: Segment[]): Segment[] {
  if (segments.length <= 1) return segments;
  const segId = uuidv4();
  const allWords = segments.flatMap(s =>
    s.words.map(w => ({ ...w, segmentId: segId })),
  );
  return [{
    id: segId,
    clipId,
    startTime: segments[0].startTime,
    endTime: segments[segments.length - 1].endTime,
    text: segments.map(s => s.text).join(' '),
    words: allWords,
    tags: [],
  }];
}

function estimateWords(segId: string, text: string, start: number, end: number): Word[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  const duration = end - start;
  const totalChars = tokens.reduce((s, t) => s + t.length, 0) || 1;
  let cursor = start;

  return tokens.map((token) => {
    const wordDuration = (token.length / totalChars) * duration;
    const w: Word = {
      id: uuidv4(),
      segmentId: segId,
      text: token,
      startTime: cursor,
      endTime: cursor + wordDuration,
      isRemoved: false,
    };
    cursor += wordDuration;
    return w;
  });
}
