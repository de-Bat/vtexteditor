import { v4 as uuidv4 } from 'uuid';
import { PipelineContext } from '../models/pipeline-context.model';
import { MediaInfo } from '../models/project.model';
import { pluginRegistry } from '../plugins/plugin-registry';
import { projectService } from './project.service';
import { sseService } from './sse.service';
import { pipelineCacheService } from './pipeline-cache.service';
import { computeMediaHash } from '../utils/media-hash.util';

const TAG = '[pipeline]';

interface PipelineStartParams {
  projectId: string;
  mediaPath: string;
  mediaInfo: MediaInfo;
  steps: Array<{ pluginId: string; config: Record<string, unknown>; order: number }>;
  metadata: Record<string, unknown>;
}

class PipelineService {
  /** Start an async pipeline execution. Returns a job ID immediately. */
  async start(params: PipelineStartParams): Promise<string> {
    const jobId = uuidv4();

    // Run the pipeline asynchronously
    setImmediate(() => this.run(jobId, params).catch((err) => {
      console.error(`${TAG} Unhandled error:`, err);
      sseService.broadcast({
        type: 'pipeline:error',
        data: { jobId, error: String(err) },
      });
    }));

    return jobId;
  }

  private async run(jobId: string, params: PipelineStartParams): Promise<void> {
    const sortedSteps = [...params.steps].sort((a, b) => a.order - b.order);
    const totalSteps = sortedSteps.length;

    console.log(`${TAG} computing media hash for ${params.mediaPath}`);
    const mediaHash = await computeMediaHash(params.mediaPath);
    console.log(`${TAG} mediaHash: ${mediaHash.slice(0, 12)}…  path: ${params.mediaPath}`);

    let ctx: PipelineContext = {
      projectId: params.projectId,
      mediaPath: params.mediaPath,
      mediaInfo: params.mediaInfo,
      mediaHash,
      clips: [],
      metadata: params.metadata,
      cache: pipelineCacheService,
      // Initially no progress reporter until we start the loop
      reportProgress: () => {},
    };

    for (let i = 0; i < sortedSteps.length; i++) {
      const step = sortedSteps[i];
      const plugin = pluginRegistry.getById(step.pluginId);
      if (!plugin) {
        throw new Error(`Plugin not found: ${step.pluginId}`);
      }

      // Update the progress reporter for the current step to capture 'i'
      ctx.reportProgress = (message: string, subProgress?: number) => {
        const currentStep = i + 1;
        const pluginObj = pluginRegistry.getById(sortedSteps[i].pluginId);
        
        const baseProgress = (i / totalSteps);
        const stepProgress = ((subProgress ?? 0) / 100) * (1 / totalSteps);
        const totalProgress = Math.round((baseProgress + stepProgress) * 100);

        sseService.broadcast({
          type: 'pipeline:progress',
          data: {
            jobId,
            step: currentStep,
            totalSteps,
            pluginId: sortedSteps[i].pluginId,
            pluginName: pluginObj?.name ?? 'Unknown',
            progress: totalProgress,
            message,
          },
        });
      };

      // Merge step config into metadata under plugin ID key
      ctx = { ...ctx, metadata: { ...ctx.metadata, [step.pluginId]: step.config } };

      sseService.broadcast({
        type: 'pipeline:progress',
        data: {
          jobId,
          step: i + 1,
          totalSteps,
          pluginId: step.pluginId,
          pluginName: plugin.name,
          progress: Math.round((i / totalSteps) * 100),
        },
      });

      ctx = await plugin.execute(ctx);

      sseService.broadcast({
        type: 'pipeline:progress',
        data: {
          jobId,
          step: i + 1,
          totalSteps,
          pluginId: step.pluginId,
          pluginName: plugin.name,
          progress: Math.round(((i + 1) / totalSteps) * 100),
        },
      });
    }

    // Persist clips into the project
    const project = projectService.get(params.projectId);
    if (project) {
      projectService.update(params.projectId, { clips: ctx.clips });
    }

    sseService.broadcast({
      type: 'pipeline:complete',
      data: { jobId, clipCount: ctx.clips.length },
    });
  }
}

export const pipelineService = new PipelineService();
