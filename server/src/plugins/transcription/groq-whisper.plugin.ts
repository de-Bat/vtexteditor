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
import { settingsService } from '../../services/settings.service';

interface GroqConfig {
  apiKey?: string;
  model?: string;
  language?: string;
  clipName?: string;
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
        clipName: {
          type: 'string',
          title: 'Clip Name',
          default: 'Groq Transcription',
        },
      },
      required: [],
  },

  async execute(ctx: PipelineContext): Promise<PipelineContext> {
    const cfg = (ctx.metadata['groq-whisper'] ?? {}) as GroqConfig;
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

    let transcription;
    try {
      const fileStream = fs.createReadStream(audioPath) as unknown as File;

      // Groq transcription with word-level timestamps
      transcription = await groq.audio.transcriptions.create({
      file: fileStream,
      model: (cfg.model ?? 'whisper-large-v3-turbo') as 'whisper-large-v3' | 'whisper-large-v3-turbo' | 'distil-whisper-large-v3-en',
      response_format: 'verbose_json',
        timestamp_granularities: ['word', 'segment'],
        ...(cfg.language ? { language: cfg.language } : {}),
      });
    } finally {
      if (tempCreated && fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    }

    const raw = transcription as unknown as { segments?: GroqSegment[]; text?: string };
    const clipId = uuidv4();
    const clipName = cfg.clipName ?? 'Groq Transcription';
    const segments: Segment[] = [];

    if (raw.segments?.length) {
      for (const seg of raw.segments) {
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
