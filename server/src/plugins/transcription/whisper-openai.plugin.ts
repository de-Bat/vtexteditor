import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { IPlugin } from '../plugin.interface';
import { PipelineContext } from '../../models/pipeline-context.model';
import { Clip } from '../../models/clip.model';
import { Segment } from '../../models/segment.model';
import { Word } from '../../models/word.model';
import { v4 as uuidv4 } from 'uuid';
import { extractAudioTrack, makeTempAudioPath } from '../../utils/ffmpeg.util';
import { chunkAndTranscribe, RawSegment } from '../../utils/chunked-transcription.util';
import { settingsService } from '../../services/settings.service';

interface WhisperConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  language?: string;
  segmentBySpeech?: boolean;
  showSilenceMarkers?: boolean;
  clipName?: string;
  chunkDurationSecs?: number;
  maxConcurrent?: number;
  reuseIfCached?: boolean;
}

interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

interface WhisperSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  words?: WhisperWord[];
}

interface WhisperResponse {
  segments?: WhisperSegment[];
  text?: string;
  duration?: number;
}

export const whisperPlugin: IPlugin = {
  id: 'whisper-openai',
  name: 'Whisper (OpenAI-compatible API)',
  description: 'Transcribe audio/video using OpenAI Whisper API or any self-hosted OpenAI-compatible server (whisper.cpp, faster-whisper-server, LocalAI, etc.) with word-level timestamps.',
  type: 'transcription',
  hasUI: false,
  settingsMap: {
    model:               'WHISPER_MODEL',
    baseURL:             'WHISPER_BASE_URL',
    language:            'WHISPER_LANGUAGE',
    segmentBySpeech:     'SEGMENT_BY_SPEECH',
    showSilenceMarkers:  'SHOW_SILENCE_MARKERS',
  },
  configSchema: {
      type: 'object',
      properties: {
        apiKey: {
          type: 'string',
          title: 'API Key',
          description: 'Required for the OpenAI endpoint. Leave blank when using a self-hosted server (baseURL set in App Settings or below).',
        },
        baseURL: {
          type: 'string',
          title: 'Base URL (self-hosted)',
          description: 'e.g. http://localhost:8080/v1 — when set, the API key is not required.',
          default: '',
        },
        model: {
          type: 'string',
          title: 'Model',
          description: 'Model name. Use "whisper-1" for OpenAI. Self-hosted servers may use "large-v3", "base", "ggml-base", etc.',
          examples: ['whisper-1', 'large-v3', 'base', 'small'],
          default: 'whisper-1',
        },
        language: {
          type: 'string',
          title: 'Language Code',
          description: 'ISO 639-1 language code, e.g. "en". Leave blank for auto-detect.',
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
          default: 'Whisper Transcription',
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
          description: 'Maximum number of simultaneous API calls. Lower this if you hit rate limits.',
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
    const tag = '[whisper-openai]';
    const cfg = (ctx.metadata['whisper-openai'] ?? {}) as WhisperConfig;
    const apiKey = cfg.apiKey ?? process.env['OPENAI_API_KEY'] ?? settingsService.get('OPENAI_API_KEY');
    const baseURL = cfg.baseURL?.trim() || process.env['WHISPER_BASE_URL'] || settingsService.get('WHISPER_BASE_URL');
    const model = cfg.model?.trim() || settingsService.get('WHISPER_MODEL') || 'whisper-1';
    const language = cfg.language?.trim() || settingsService.get('WHISPER_LANGUAGE') || '';

    const reuseIfCached = cfg.reuseIfCached !== false; // default true
    const cacheKey = `whisper-openai:${ctx.mediaHash}:${model}:${language}`;

    if (reuseIfCached && ctx.cache.has(cacheKey)) {
      console.log(`${tag} cache HIT  key=${cacheKey.slice(0, 48)}… — skipping transcription`);
      const cached = ctx.cache.get<RawSegment[]>(cacheKey)!;
      return buildClip(cached, cfg, ctx);
    }
    console.log(reuseIfCached
      ? `${tag} cache MISS  key=${cacheKey.slice(0, 48)}… — transcribing`
      : `${tag} reuseIfCached=false — transcribing (cache will be updated)`);

    // Self-hosted servers do not need an API key.
    // Only require one when targeting the official OpenAI endpoint.
    if (!baseURL && !apiKey) {
      throw new Error(
        'API key required for the OpenAI endpoint. ' +
        'Set OPENAI_API_KEY env var, configure it in App Settings, or provide it in the pipeline config. ' +
        'No key is needed when a self-hosted Base URL is configured.',
      );
    }

    const resolvedBaseURL = baseURL ? normalizeBaseURL(baseURL) : '(OpenAI default)';
    console.log(`${tag} endpoint: ${resolvedBaseURL}`);
    console.log(`${tag} model: ${model}  language: ${language || 'auto'}`);
    console.log(`${tag} apiKey: ${apiKey ? '(set)' : '(none — self-hosted)'}`);

    const clientOpts: ConstructorParameters<typeof OpenAI>[0] = {
      apiKey: apiKey ?? 'self-hosted',
      ...(baseURL ? { baseURL: normalizeBaseURL(baseURL) } : {}),
    };
    const client = new OpenAI(clientOpts);

    if (!fs.existsSync(ctx.mediaPath)) throw new Error(`Media file not found: ${ctx.mediaPath}`);

    // For video files, strip the video track first — sending only the audio
    // channel is faster, cheaper, and avoids API file-size limits.
    let audioPath = ctx.mediaPath;
    let tempCreated = false;
    if (ctx.mediaInfo.videoCodec) {
      console.log(`${tag} video detected (codec: ${ctx.mediaInfo.videoCodec}) — extracting audio track`);
      const tempPath = makeTempAudioPath(uuidv4());
      await extractAudioTrack(ctx.mediaPath, tempPath);
      audioPath = tempPath;
      tempCreated = true;
      console.log(`${tag} audio extracted → ${audioPath}`);
    } else {
      console.log(`${tag} audio-only file — sending directly: ${path.basename(audioPath)}`);
    }

    const fileStat = fs.statSync(audioPath);
    console.log(`${tag} audio file: ${path.basename(audioPath)}  size: ${(fileStat.size / 1024).toFixed(1)} KB`);

    // Local function: transcribe one chunk via the OpenAI-compatible API.
    // Tries with timestamp_granularities first; retries without if server rejects it.
    const transcribeChunk = async (chunkPath: string): Promise<RawSegment[]> => {
      let response: WhisperResponse;
      try {
        const fileStream = fs.createReadStream(chunkPath);
        response = await (client.audio.transcriptions.create as Function)({
          file: fileStream,
          model,
          response_format: 'verbose_json',
          timestamp_granularities: ['word', 'segment'],
          temperature: 0,
          ...(language ? { language } : {}),
        }) as WhisperResponse;
      } catch (firstErr: unknown) {
        const status = (firstErr as { status?: number }).status;
        console.warn(`${tag} first attempt failed (status=${status}) — retrying without timestamp_granularities`);
        // 404/400/422 → server exists but doesn't support timestamp_granularities.
        if (status === 404 || status === 400 || status === 422) {
          const retryStream = fs.createReadStream(chunkPath);
          response = await (client.audio.transcriptions.create as Function)({
            file: retryStream,
            model,
            response_format: 'verbose_json',
            temperature: 0,
            ...(language ? { language } : {}),
          }) as WhisperResponse;
        } else {
          throw firstErr;
        }
      }
      return (response.segments ?? []).map((seg) => ({
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
        (progress, completed, total, active) => {
          const pending = total - completed - active;
          const status = `Transcribing chunks (${completed}/${total}) — ${active} active, ${pending} pending…`;
          ctx.reportProgress?.(status, progress);
        }
      );
    } finally {
      if (tempCreated && fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
        console.log(`${tag} temp audio file removed`);
      }
    }

    if (!rawSegments.length) {
      throw new Error(
        `${tag} Transcription returned no segments. ` +
        'Verify that the server is reachable and the model name is correct.',
      );
    }

    const wordCount = rawSegments.reduce((n, s) => n + (s.words?.length ?? 0), 0);
    console.log(`${tag} transcription complete — segments: ${rawSegments.length}  words: ${wordCount}`);

    console.log(`${tag} cache WRITE  key=${cacheKey.slice(0, 48)}…  segments: ${rawSegments.length}`);
    ctx.cache.set(cacheKey, rawSegments);

    return buildClip(rawSegments, cfg, ctx);
  },
};

function buildClip(rawSegments: RawSegment[], cfg: WhisperConfig, ctx: PipelineContext): PipelineContext {
  const clipId = uuidv4();
  const clipName = cfg.clipName ?? 'Whisper Transcription';
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

  const coerceBool = (v: unknown, fallback: boolean) =>
    v === true || String(v).toLowerCase() === 'true' ? true
      : v === false || String(v).toLowerCase() === 'false' ? false
      : fallback;

  const segmentBySpeech = coerceBool(cfg.segmentBySpeech, true);
  const showSilenceMarkers = coerceBool(cfg.showSilenceMarkers, false);
  const finalSegments = segmentBySpeech ? segments : mergeSegments(clipId, segments);

  const clip: Clip = {
    id: clipId,
    projectId: ctx.projectId,
    name: clipName,
    startTime: finalSegments[0]?.startTime ?? 0,
    endTime: finalSegments[finalSegments.length - 1]?.endTime ?? (ctx.mediaInfo?.duration ?? 0),
    segments: finalSegments,
    cutRegions: [],
    showSilenceMarkers,
  };

  const totalWords = finalSegments.reduce((n, s) => n + s.words.length, 0);
  console.log(
    `[whisper-openai] clip built — "${clipName}"  segments: ${finalSegments.length}  words: ${totalWords}` +
    `  segmentBySpeech: ${segmentBySpeech}  showSilenceMarkers: ${showSilenceMarkers}`,
  );

  return { ...ctx, clips: [...ctx.clips, clip] };
}

/**
 * Ensure the baseURL always ends with a path so the OpenAI SDK constructs
 * the correct transcription endpoint:
 *   http://localhost:9000       → http://localhost:9000/v1
 *   http://localhost:9000/      → http://localhost:9000/v1
 *   http://localhost:9000/v1    → http://localhost:9000/v1  (unchanged)
 *   http://localhost:9000/api   → http://localhost:9000/api (custom path, unchanged)
 */
function normalizeBaseURL(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname === '/' || parsed.pathname === '') {
      return trimmed + '/v1';
    }
  } catch { /* invalid URL — pass through and let the SDK error naturally */ }
  return trimmed;
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
