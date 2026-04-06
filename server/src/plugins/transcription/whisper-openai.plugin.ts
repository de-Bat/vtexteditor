import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { IPlugin } from '../plugin.interface';
import { PipelineContext } from '../../models/pipeline-context.model';
import { Clip } from '../../models/clip.model';
import { Segment } from '../../models/segment.model';
import { Word } from '../../models/word.model';
import { v4 as uuidv4 } from 'uuid';

interface WhisperConfig {
  apiKey?: string;
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
  name: 'Whisper (OpenAI API)',
  description: 'Transcribe audio/video using OpenAI Whisper API with word-level timestamps.',
  type: 'transcription',
  hasUI: false,
  configSchema: {
      type: 'object',
      properties: {
        apiKey: {
          type: 'string',
          title: 'OpenAI API Key',
          description: 'Your OpenAI API key (or set OPENAI_API_KEY env var)',
        },
        model: {
          type: 'string',
          title: 'Model',
          enum: ['whisper-1'],
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
    const apiKey = cfg.apiKey ?? process.env['OPENAI_API_KEY'];
    if (!apiKey) throw new Error('OpenAI API key required. Set OPENAI_API_KEY or provide apiKey in config.');

    const client = new OpenAI({ apiKey });

    const audioPath = ctx.mediaPath;
    if (!fs.existsSync(audioPath)) throw new Error(`Media file not found: ${audioPath}`);

    const fileStream = fs.createReadStream(audioPath);
    const ext = path.extname(audioPath).slice(1) || 'mp4';

    // Call Whisper with verbose_json response format for word timestamps
    const response = await (client.audio.transcriptions.create as Function)({
      file: fileStream,
      model: cfg.model ?? 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
      ...(cfg.language ? { language: cfg.language } : {}),
    }) as WhisperResponse;

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
