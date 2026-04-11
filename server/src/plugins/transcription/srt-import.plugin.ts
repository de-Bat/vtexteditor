import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { IPlugin } from '../plugin.interface';
import { PipelineContext } from '../../models/pipeline-context.model';
import { Clip } from '../../models/clip.model';
import { Segment } from '../../models/segment.model';
import { Word } from '../../models/word.model';
import { parseSrt, estimateWordTimestamps } from '../../utils/time.util';

export const srtImportPlugin: IPlugin = {
  id: 'srt-import',
  name: 'SRT Import',
  description: 'Import an SRT subtitle file as clip transcription with estimated word timestamps.',
  type: 'transcription',
  hasUI: false,
  configSchema: {
    type: 'object',
    properties: {
      srtPath: {
        type: 'string',
        title: 'SRT File Path',
        description: 'Absolute path to the .srt file on the server',
      },
      clipName: {
        type: 'string',
        title: 'Clip Name',
        default: 'Imported Clip',
      },
    },
    required: ['srtPath'],
  },

  async execute(ctx: PipelineContext): Promise<PipelineContext> {
    const config = ctx.metadata['srt-import'] as { srtPath: string; clipName?: string };
    if (!config?.srtPath) throw new Error('srt-import: srtPath is required');

    const srtContent = fs.readFileSync(config.srtPath, 'utf8');
    const entries = parseSrt(srtContent);
    if (!entries.length) throw new Error('srt-import: No entries found in SRT file');

    const clipId = uuidv4();
    const clipStart = entries[0].startTime;
    const clipEnd = entries[entries.length - 1].endTime;

    // Merge all SRT entries into a single segment
    const segmentId = uuidv4();
    const allWords: Word[] = entries.flatMap((entry) => {
      const wordTimings = estimateWordTimestamps(entry.startTime, entry.endTime, entry.text);
      return wordTimings.map((w) => ({
        id: uuidv4(),
        segmentId,
        text: w.text,
        startTime: w.startTime,
        endTime: w.endTime,
        isRemoved: false,
      }));
    });

    const segments: Segment[] = [{
      id: segmentId,
      clipId,
      startTime: clipStart,
      endTime: clipEnd,
      text: entries.map((e) => e.text).join(' '),
      words: allWords,
      tags: [],
    }];

    const clip: Clip = {
      id: clipId,
      projectId: ctx.projectId,
      name: config.clipName ?? 'Imported Clip',
      startTime: clipStart,
      endTime: clipEnd,
      segments,
      cutRegions: [],
    };

    return { ...ctx, clips: [...ctx.clips, clip] };
  },
};
