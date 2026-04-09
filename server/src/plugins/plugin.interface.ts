import { Express } from 'express';
import { PipelineContext } from '../models/pipeline-context.model';
import { PluginMeta } from '../models/plugin.model';

export interface IPlugin extends PluginMeta {
  execute(input: PipelineContext): Promise<PipelineContext>;
  /** Optional: called once at server startup to register plugin-owned routes. */
  registerRoutes?(app: Express): void;
}
