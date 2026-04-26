import { Clip } from '../models/clip.model';
import { Word } from '../models/word.model';
import { MetadataEntry } from '../models/segment-metadata.model';
import { projectService } from './project.service';

function normalizeEffectType(t: string): string {
  if (t === 'hard-cut') return 'clear-cut';
  if (t === 'fade') return 'fade-in';
  return t;
}

function normalizeCutRegion(r: Record<string, unknown>): Record<string, unknown> {
  return { ...r, effectType: normalizeEffectType(String(r['effectType'] ?? '')) };
}

class ClipService {
  getAll(projectId?: string): Clip[] {
    if (projectId) {
      const project = projectService.get(projectId);
      return (project?.clips ?? []).map(this.normalizeClip);
    }
    const project = projectService.getCurrent();
    return (project?.clips ?? []).map(this.normalizeClip);
  }

  getById(id: string): Clip | undefined {
    return this.getAll().find((c) => c.id === id);
  }

  private normalizeClip = (clip: Clip): Clip => ({
    ...clip,
    cutRegions: clip.cutRegions.map(r => ({ ...r, effectType: normalizeEffectType(r.effectType as string) as import('../models/clip.model').EffectType })),
  });

  updateCutRegions(clipId: string, cutRegions: import('../models/clip.model').CutRegion[]): Clip | null {
    const project = projectService.getCurrent();
    if (!project) return null;

    const clipIndex = project.clips.findIndex((c) => c.id === clipId);
    if (clipIndex === -1) return null;

    const clip = project.clips[clipIndex];

    // Normalize legacy effect names + strip client-only pending fields
    const normalized = (cutRegions as unknown as Record<string, unknown>[]).map(r => {
      const { pending, pendingKind, pendingTargetId, resolvedEffectType, ...clean } = normalizeCutRegion(r) as Record<string, unknown>;
      return clean;
    }) as import('../models/clip.model').CutRegion[];

    // Sync isRemoved on all words from the normalized cutRegions
    const removedIds = new Set(normalized.flatMap((r) => r.wordIds));
    const updatedSegments = clip.segments.map((seg) => ({
      ...seg,
      words: seg.words.map((w) => ({ ...w, isRemoved: removedIds.has(w.id) })),
    }));

    const updatedClip: Clip = { ...clip, cutRegions: normalized, segments: updatedSegments };
    const updatedClips = [...project.clips];
    updatedClips[clipIndex] = updatedClip;
    projectService.update(project.id, { clips: updatedClips });

    return updatedClip;
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

  updateSegmentMetadata(
    projectId: string, clipId: string, segmentId: string, 
    metadata: Record<string, MetadataEntry[]>
  ): import('../models/segment.model').Segment | null {
    const project = projectService.get(projectId);
    if (!project) return null;

    const clipIndex = project.clips.findIndex(c => c.id === clipId);
    if (clipIndex === -1) return null;
    const clip = project.clips[clipIndex];

    const segmentIndex = clip.segments.findIndex(s => s.id === segmentId);
    if (segmentIndex === -1) return null;
    const segment = clip.segments[segmentIndex];

    const updatedSegment = { ...segment, metadata };
    const updatedSegments = [...clip.segments];
    updatedSegments[segmentIndex] = updatedSegment;

    const updatedClip = { ...clip, segments: updatedSegments };
    const updatedClips = [...project.clips];
    updatedClips[clipIndex] = updatedClip;

    projectService.update(projectId, { clips: updatedClips });
    return updatedSegment;
  }

  patchSegmentMetadata(
    projectId: string, clipId: string, segmentId: string, 
    sourcePluginId: string, entries: MetadataEntry[]
  ): import('../models/segment.model').Segment | null {
    const project = projectService.get(projectId);
    if (!project) return null;

    const clipIndex = project.clips.findIndex(c => c.id === clipId);
    if (clipIndex === -1) return null;
    const clip = project.clips[clipIndex];

    const segmentIndex = clip.segments.findIndex(s => s.id === segmentId);
    if (segmentIndex === -1) return null;
    const segment = clip.segments[segmentIndex];

    const currentMetadata = segment.metadata ?? {};
    const updatedMetadata = { ...currentMetadata, [sourcePluginId]: entries };

    const updatedSegment = { ...segment, metadata: updatedMetadata };
    const updatedSegments = [...clip.segments];
    updatedSegments[segmentIndex] = updatedSegment;

    const updatedClip = { ...clip, segments: updatedSegments };
    const updatedClips = [...project.clips];
    updatedClips[clipIndex] = updatedClip;

    projectService.update(projectId, { clips: updatedClips });
    return updatedSegment;
  }

  updateClipMetadata(
    projectId: string, clipId: string, 
    metadata: Record<string, MetadataEntry[]>
  ): Clip | null {
    const project = projectService.get(projectId);
    if (!project) return null;

    const clipIndex = project.clips.findIndex(c => c.id === clipId);
    if (clipIndex === -1) return null;
    const clip = project.clips[clipIndex];

    const updatedClip = { ...clip, metadata };
    const updatedClips = [...project.clips];
    updatedClips[clipIndex] = updatedClip;

    projectService.update(projectId, { clips: updatedClips });
    return updatedClip;
  }

  patchClipMetadata(
    projectId: string, clipId: string, 
    sourcePluginId: string, entries: MetadataEntry[]
  ): Clip | null {
    const project = projectService.get(projectId);
    if (!project) return null;

    const clipIndex = project.clips.findIndex(c => c.id === clipId);
    if (clipIndex === -1) return null;
    const clip = project.clips[clipIndex];

    const currentMetadata = clip.metadata ?? {};
    const updatedMetadata = { ...currentMetadata, [sourcePluginId]: entries };

    const updatedClip = { ...clip, metadata: updatedMetadata };
    const updatedClips = [...project.clips];
    updatedClips[clipIndex] = updatedClip;

    projectService.update(projectId, { clips: updatedClips });
    return updatedClip;
  }
}

export const clipService = new ClipService();
