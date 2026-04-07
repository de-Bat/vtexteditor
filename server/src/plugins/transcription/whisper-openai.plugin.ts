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
import { settingsService } from '../../services/settings.service';

interface WhisperConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  language?: string;
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
        clipName: {
          type: 'string',
          title: 'Clip Name',
          default: 'Whisper Transcription',
        },
      },
      required: [],
  },

  async execute(ctx: PipelineContext): Promise<PipelineContext> {
    const cfg = (ctx.metadata['whisper-openai'] ?? {}) as WhisperConfig & { clipName?: string };
    const apiKey = cfg.apiKey ?? process.env['OPENAI_API_KEY'] ?? settingsService.get('OPENAI_API_KEY');
    const baseURL = cfg.baseURL?.trim() || process.env['WHISPER_BASE_URL'] || settingsService.get('WHISPER_BASE_URL');

    // Self-hosted servers do not need an API key.
    // Only require one when targeting the official OpenAI endpoint.
    if (!baseURL && !apiKey) {
      throw new Error(
        'API key required for the OpenAI endpoint. ' +
        'Set OPENAI_API_KEY env var, configure it in App Settings, or provide it in the pipeline config. ' +
        'No key is needed when a self-hosted Base URL is configured.',
      );
    }

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
      const tempPath = makeTempAudioPath(uuidv4());
      await extractAudioTrack(ctx.mediaPath, tempPath);
      audioPath = tempPath;
      tempCreated = true;
    }

    let response: WhisperResponse;
    try {
      const fileStream = fs.createReadStream(audioPath);
      const ext = path.extname(audioPath).slice(1) || 'wav';
      void ext; // used implicitly by the stream

      // First attempt: verbose_json with word+segment granularities (full timestamps)
      try {
        response = await (client.audio.transcriptions.create as Function)({
          file: fileStream,
          model: cfg.model ?? 'whisper-1',
          response_format: 'verbose_json',
          timestamp_granularities: ['word', 'segment'],
          ...(cfg.language ? { language: cfg.language } : {}),
        }) as WhisperResponse;
      } catch (firstErr: unknown) {
        const status = (firstErr as { status?: number }).status;
        // 404/400/422 → server exists but doesn't support timestamp_granularities.
        // Retry without that parameter (segments only, words estimated later).
        if (status === 404 || status === 400 || status === 422) {
          const retryStream = fs.createReadStream(audioPath);
          response = await (client.audio.transcriptions.create as Function)({
            file: retryStream,
            model: cfg.model ?? 'whisper-1',
            response_format: 'verbose_json',
            ...(cfg.language ? { language: cfg.language } : {}),
          }) as WhisperResponse;
        } else {
          throw firstErr;
        }
      }
    } finally {
      if (tempCreated && fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    }

    // Build Clip from Whisper response
    const clipId = uuidv4();
    const clipName = cfg.clipName ?? 'Whisper Transcription';
    const segments: Segment[] = [];

    if (response.segments?.length) {
      for (const seg of response.segments) {
        const segId = uuidv4();
        let words: Word[];

        if (seg.words?.length) {
          words = seg.words.map((w) => ({
            id: uuidv4(),
            segmentId: segId,
            text: w.word.trim(),
            startTime: w.start,
            endTime: w.end,
            isRemoved: false,
          }));
        } else {
          // Estimate from segment text
          words = estimateWords(segId, seg.text.trim(), seg.start, seg.end);
        }

        segments.push({
          id: segId,
          clipId,
          startTime: seg.start,
          endTime: seg.end,
          text: seg.text.trim(),
          words,
          tags: [],
        });
      }
    }

    const clip: Clip = {
      id: clipId,
      projectId: ctx.projectId,
      name: clipName,
      startTime: segments[0]?.startTime ?? 0,
      endTime: segments[segments.length - 1]?.endTime ?? (ctx.mediaInfo?.duration ?? 0),
      segments,
    };

    return { ...ctx, clips: [...ctx.clips, clip] };
  },
};

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
