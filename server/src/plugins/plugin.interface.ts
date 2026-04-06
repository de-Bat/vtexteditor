import { PipelineContext } from '../models/pipeline-context.model';
import { PluginMeta } from '../models/plugin.model';

export interface IPlugin extends PluginMeta {
  execute(input: PipelineContext): Promise<PipelineContext>;
}
