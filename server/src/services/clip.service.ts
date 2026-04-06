import { Clip } from '../models/clip.model';
import { Word } from '../models/word.model';
import { projectService } from './project.service';

class ClipService {
  getAll(): Clip[] {
    const project = projectService.getCurrent();
    return project?.clips ?? [];
  }

  getById(id: string): Clip | undefined {
    return this.getAll().find((c) => c.id === id);
  }

  updateWordStates(clipId: string, wordUpdates: Array<{ id: string; isRemoved: boolean }>): Clip | null {
    const project = projectService.getCurrent();
    if (!project) return null;

    const clipIndex = project.clips.findIndex((c) => c.id === clipId);
    if (clipIndex === -1) return null;

    const clip = project.clips[clipIndex];
    const updatedSegments = clip.segments.map((seg) => ({
      ...seg,
      words: seg.words.map((w) => {
        const update = wordUpdates.find((u) => u.id === w.id);
        return update ? { ...w, isRemoved: update.isRemoved } : w;
      }),
    }));
    const updatedClip = { ...clip, segments: updatedSegments };

    const updatedClips = [...project.clips];
    updatedClips[clipIndex] = updatedClip;
    projectService.update(project.id, { clips: updatedClips });

    return updatedClip;
  }
}

export const clipService = new ClipService();
