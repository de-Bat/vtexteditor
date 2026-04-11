import { Express, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { IPlugin } from '../plugin.interface';
import { PipelineContext } from '../../models/pipeline-context.model';
import { StoryProposal, StoryEvent, PROPOSAL_KEY } from './reconstruct2story.types';
import { buildPrompt, parseEvents, buildCommitClips } from './reconstruct2story.helpers';
import { callCopilotStudio } from './copilot.client';
import { projectService } from '../../services/project.service';

interface Reconstruct2StoryConfig {
  model?: string;
  seedCategories?: string;
  language?: string;
  maxEvents?: number;
  storyClipPrefix?: string;
  timeoutSecs?: number;
}

export const reconstruct2storyPlugin: IPlugin = {
  id: 'reconstruct2story',
  name: 'Reconstruct to Story',
  description:
    "Groups interview transcript segments into life-event chapters using an LLM. Produces a story narrative told in the interviewee's voice.",
  type: 'narrative',
  hasUI: true,
  configSchema: {
    type: 'object',
    properties: {
      model: {
        type: 'string',
        title: 'Copilot Model',
        description: 'GitHub Copilot model to use, e.g. "gpt-4.1" or "claude-sonnet-4".',
        default: 'gpt-4.1',
      },
      seedCategories: {
        type: 'string',
        title: 'Seed Categories (optional)',
        description: 'Comma-separated life-chapter hints, e.g. "family, school, army"',
        default: '',
      },
      language: {
        type: 'string',
        title: 'Title Language',
        description: 'Language for generated event titles.',
        default: 'Auto-detect',
        enum: ['Auto-detect', 'English', 'Hebrew', 'Spanish', 'French', 'German', 'Russian', 'Arabic', 'Portuguese'],
      },
      maxEvents: {
        type: 'number',
        title: 'Max Events',
        description: 'Maximum number of life chapters the LLM may propose.',
        default: 10,
      },
      storyClipPrefix: {
        type: 'string',
        title: 'Clip Name Prefix',
        description: 'Prefix for generated clip names, e.g. "Story" → "Story: Family"',
        default: 'Story',
      },
      timeoutSecs: {
        type: 'number',
        title: 'LLM Timeout (seconds)',
        description: 'How long to wait for the Copilot response. Increase for very long transcripts.',
        default: 300,
      },
    },
    required: [],
  },

  async execute(ctx: PipelineContext): Promise<PipelineContext> {
    const cfg = (ctx.metadata['reconstruct2story'] ?? {}) as Reconstruct2StoryConfig;

    if (ctx.clips.length === 0) {
      throw new Error('reconstruct2story: no clips found. Run a transcription plugin first.');
    }

    const maxEvents = cfg.maxEvents ?? 10;
    const prefix = cfg.storyClipPrefix ?? 'Story';
    const timeoutMs = (cfg.timeoutSecs ?? 300) * 1000;

    const totalSegments = ctx.clips.reduce((n, c) => n + c.segments.length, 0);
    const uniqueSegmentIds = new Set(ctx.clips.flatMap(c => c.segments.map(s => s.id)));
    console.log(`[reconstruct2story] clips=${ctx.clips.length}  segments=${totalSegments}  uniqueSegIds=${uniqueSegmentIds.size}  maxEvents=${maxEvents}  model=${cfg.model ?? 'gpt-4.1'}`);

    if (uniqueSegmentIds.size < 2) {
      throw new Error(
        `reconstruct2story requires at least 2 distinct transcript segments but found ${uniqueSegmentIds.size}. ` +
        `The transcript appears to be a single merged block. ` +
        `Re-run the transcription plugin with "Segment by Speech" enabled, then try again.`,
      );
    }

    const { prompt, shortIdMap } = buildPrompt(ctx.clips, {
      maxEvents,
      seedCategories: cfg.seedCategories,
      language: cfg.language,
    });

    let outputBuffer = '';
    const responseText = await callCopilotStudio(prompt, cfg.model, timeoutMs, (chunk) => {
      outputBuffer += chunk;
      // Heuristic: move from 0 to 95% as we stream, then 100% when done.
      // Since we don't know total length, we'll just report message for now or a slow crawl.
      ctx.reportProgress?.(outputBuffer);
    });

    // Use compound keys (clipId:segId) so segments are unique even when
    // multiple clips share the same segment UUID (can happen after a commit).
    const validSegmentKeys = new Set(
      ctx.clips.flatMap(c => c.segments.map(s => `${c.id}:${s.id}`)),
    );

    const parsedEvents = parseEvents(responseText, validSegmentKeys, shortIdMap);

    const events: StoryEvent[] = parsedEvents.map(e => ({
      id: uuidv4(),
      title: e.title,
      segments: e.segments.map(compoundKey => {
        // compoundKey format: "clipId:segId"
        const colonIdx = compoundKey.indexOf(':');
        const clipId = compoundKey.slice(0, colonIdx);
        const segId = compoundKey.slice(colonIdx + 1);
        return { segmentId: segId, clipId, accepted: true };
      }),
    }));

    const proposal: StoryProposal = {
      projectId: ctx.projectId,
      sourceClipIds: ctx.clips.map(c => c.id),
      storyClipPrefix: prefix,
      events,
    };

    const project = projectService.get(ctx.projectId);
    if (!project) {
      throw new Error(`reconstruct2story: project ${ctx.projectId} not found; cannot persist proposal.`);
    }
    projectService.update(ctx.projectId, {
      metadata: { ...(project.metadata ?? {}), [PROPOSAL_KEY]: proposal },
    });

    // Return context unchanged — clips are replaced only after user review
    return ctx;
  },

  registerRoutes(app: Express): void {
    const base = '/api/plugins/reconstruct2story';

    app.get(`${base}/proposal/:projectId`, (req: Request, res: Response) => {
      const project = projectService.get(req.params['projectId'] as string);
      if (!project) return void res.status(404).json({ error: 'Project not found' });

      const proposal = project.metadata?.[PROPOSAL_KEY] as StoryProposal | undefined;
      if (!proposal) return void res.status(404).json({ error: 'No pending proposal' });

      res.json(proposal);
    });

    app.delete(`${base}/proposal/:projectId`, (req: Request, res: Response) => {
      const project = projectService.get(req.params['projectId'] as string);
      if (!project) return void res.status(404).json({ error: 'Project not found' });

      const newMeta = { ...(project.metadata ?? {}) };
      delete newMeta[PROPOSAL_KEY];
      projectService.update(req.params['projectId'] as string, { metadata: newMeta });

      res.json({ ok: true });
    });

    app.post(`${base}/commit/:projectId`, (req: Request, res: Response) => {
      const project = projectService.get(req.params['projectId'] as string);
      if (!project) return void res.status(404).json({ error: 'Project not found' });

      const proposal = project.metadata?.[PROPOSAL_KEY] as StoryProposal | undefined;
      if (!proposal) return void res.status(404).json({ error: 'No pending proposal' });

      const { events } = req.body as { events: StoryEvent[] };
      if (!Array.isArray(events)) {
        return void res.status(400).json({ error: 'Request body must include events array' });
      }
      const malformed = events.some(
        e => typeof e?.id !== 'string' || !Array.isArray(e?.segments),
      );
      if (malformed) {
        return void res.status(400).json({ error: 'Each event must have a string id and a segments array' });
      }

      const sourceClips = project.clips.filter(c =>
        proposal.sourceClipIds.includes(c.id),
      );

      const storyClips = buildCommitClips(
        project.id,
        events,
        sourceClips,
        proposal.storyClipPrefix,
      );

      const otherClips = project.clips.filter(
        c => !proposal.sourceClipIds.includes(c.id),
      );

      const newMeta = { ...(project.metadata ?? {}) };
      delete newMeta[PROPOSAL_KEY];

      projectService.update(project.id, {
        clips: [...otherClips, ...storyClips],
        metadata: newMeta,
      });

      res.json({ clipCount: storyClips.length });
    });
  },
};
