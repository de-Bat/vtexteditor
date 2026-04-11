import { Clip } from '../models/clip.model';
import { Word } from '../models/word.model';
import { projectService } from './project.service';

class ClipService {
  getAll(projectId?: string): Clip[] {
    if (projectId) {
      const project = projectService.get(projectId);
      return project?.clips ?? [];
    }
    const project = projectService.getCurrent();
    return project?.clips ?? [];
  }

  getById(id: string): Clip | undefined {
    return this.getAll().find((c) => c.id === id);
  }

  updateWordStates(clipId: string, wordUpdates: Array<{ id: string; isRemoved?: boolean; text?: string }>): Clip | null {
    const project = projectService.getCurrent();
    if (!project) return null;

    const clipIndex = project.clips.findIndex((c) => c.id === clipId);
    if (clipIndex === -1) return null;

    const clip = project.clips[clipIndex];
    const updatedSegments = clip.segments.map((seg) => ({
      ...seg,
      words: seg.words.map((w) => {
        const update = wordUpdates.find((u) => u.id === w.id);
        if (update) {
          const nextWord = { ...w };
          if (update.isRemoved !== undefined) nextWord.isRemoved = update.isRemoved;
          if (update.text !== undefined) nextWord.text = update.text;
          return nextWord;
        }
        return w;
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
