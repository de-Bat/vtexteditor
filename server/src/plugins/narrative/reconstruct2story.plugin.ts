import { Express, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { IPlugin } from '../plugin.interface';
import { PipelineContext } from '../../models/pipeline-context.model';
import { StoryProposal, StoryEvent, PROPOSAL_KEY } from './reconstruct2story.types';
import { buildPrompt, parseEvents, buildCommitClips } from './reconstruct2story.helpers';
import { callCopilotStudio } from './copilot.client';
import { projectService } from '../../services/project.service';

interface Reconstruct2StoryConfig {
  copilotEndpoint: string;
  seedCategories?: string;
  language?: string;
  maxEvents?: number;
  storyClipPrefix?: string;
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
      copilotEndpoint: {
        type: 'string',
        title: 'Copilot Studio Direct Line Endpoint',
        description:
          "Base URL of your Copilot Studio bot's Direct Line endpoint, e.g. https://directline.botframework.com/v3/directline",
      },
      seedCategories: {
        type: 'string',
        title: 'Seed Categories (optional)',
        description: 'Comma-separated life-chapter hints, e.g. "family, school, army"',
        default: '',
      },
      language: {
        type: 'string',
        title: 'Event Title Language (optional)',
        description: 'Language for generated event titles, e.g. "Hebrew". Defaults to auto-detect.',
        default: '',
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
    },
    required: ['copilotEndpoint'],
  },

  async execute(ctx: PipelineContext): Promise<PipelineContext> {
    const cfg = (ctx.metadata['reconstruct2story'] ?? {}) as Reconstruct2StoryConfig;

    if (!cfg.copilotEndpoint) {
      throw new Error('reconstruct2story: copilotEndpoint is required in plugin config.');
    }

    if (ctx.clips.length === 0) {
      throw new Error('reconstruct2story: no clips found. Run a transcription plugin first.');
    }

    const maxEvents = cfg.maxEvents ?? 10;
    const prefix = cfg.storyClipPrefix ?? 'Story';

    const prompt = buildPrompt(ctx.clips, {
      maxEvents,
      seedCategories: cfg.seedCategories,
      language: cfg.language,
    });

    const responseText = await callCopilotStudio(cfg.copilotEndpoint, prompt);

    const validSegmentIds = new Set(
      ctx.clips.flatMap(c => c.segments.map(s => s.id)),
    );

    const parsedEvents = parseEvents(responseText, validSegmentIds);

    const events: StoryEvent[] = parsedEvents.map(e => ({
      id: uuidv4(),
      title: e.title,
      segments: e.segments.map(segId => {
        const clip = ctx.clips.find(c => c.segments.some(s => s.id === segId))!;
        return { segmentId: segId, clipId: clip.id, accepted: true };
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
