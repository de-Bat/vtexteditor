import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { Project, ProjectSummary } from '../models/project.model';
import { config } from '../config';
import {
  getProjectDir,
  getProjectFilePath,
  ensureDir,
  writeJsonAtomic,
  readJson,
  fileExists,
  listProjectIds,
  removeDir,
} from '../utils/file.util';
import { pluginRegistry } from '../plugins/plugin-registry';
import { notebookService } from './notebook.service';


class ProjectService {
  private currentProjectId: string | null = null;

  getCurrentId(): string | null {
    return this.currentProjectId;
  }

  create(partial: { name: string; mediaPath: string; mediaType: 'video' | 'audio'; mediaInfo: import('../models/project.model').MediaInfo | null }): Project {
    const id = uuidv4();
    const now = new Date().toISOString();
    const project: Project = {
      ...partial,
      id,
      clips: [],
      pipelineConfig: [],
      editHistory: [],
      createdAt: now,
      updatedAt: now,
    };
    ensureDir(getProjectDir(id));
    writeJsonAtomic(getProjectFilePath(id), project);
    this.currentProjectId = id;
    return project;
  }

  get(id: string): Project | null {
    const fp = getProjectFilePath(id);
    if (!fileExists(fp)) return null;
    return readJson<Project>(fp);
  }

  getCurrent(): Project | null {
    if (!this.currentProjectId) return null;
    return this.get(this.currentProjectId);
  }

  update(id: string, data: Partial<Project>): Project | null {
    const existing = this.get(id);
    if (!existing) return null;
    const updated: Project = {
      ...existing,
      ...data,
      id,
      updatedAt: new Date().toISOString(),
    };
    writeJsonAtomic(getProjectFilePath(id), updated);
    return updated;
  }

  setCurrentId(id: string): void {
    this.currentProjectId = id;
  }

  list(): ProjectSummary[] {
    const ids = listProjectIds();
    const summaries: ProjectSummary[] = [];
    for (const id of ids) {
      const fp = getProjectFilePath(id);
      if (!fileExists(fp)) continue;
      try {
        const project = readJson<Project>(fp);
        const clipCount = project.clips.length;
        const segmentCount = project.clips.reduce((s, c) => s + c.segments.length, 0);
        const wordCount = project.clips.reduce(
          (s, c) => s + c.segments.reduce((ss, seg) => ss + seg.words.length, 0), 0
        );
        const transcriptionStep = project.pipelineConfig.find(step => {
          const plugin = pluginRegistry.getById(step.pluginId);
          return plugin?.type === 'transcription';
        });
        const notebooks = notebookService.list(id).map((nb) => ({
          id: nb.id,
          name: nb.name,
          updatedAt: nb.updatedAt,
        }));
        summaries.push({
          id: project.id,
          name: project.name,
          mediaPath: project.mediaPath,
          mediaType: project.mediaType,
          mediaInfo: project.mediaInfo,
          pipelineConfig: project.pipelineConfig,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          clipCount,
          segmentCount,
          wordCount,
          hasTranscription: clipCount > 0 && !!transcriptionStep,
          transcriptionPlugin: transcriptionStep?.pluginId ?? null,
          notebooks,
        });
      } catch {
        // skip corrupt project files
      }
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  open(id: string): Project | null {
    const project = this.get(id);
    if (!project) return null;
    this.currentProjectId = id;
    return project;
  }

  delete(id: string): boolean {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return false;
    
    const project = this.get(id);
    if (!project) return false;

    // Cleanup media file if not used by other projects
    const mediaPath = project.mediaPath;
    if (mediaPath) {
      const allProjects = this.list();
      const isUsedElsewhere = allProjects.some(p => p.id !== id && p.mediaPath === mediaPath);
      
      if (!isUsedElsewhere) {
        const absoluteMediaPath = path.resolve(mediaPath);
        const absoluteUploadsDir = path.resolve(config.storage.uploads);
        
        if (absoluteMediaPath.startsWith(absoluteUploadsDir) && fs.existsSync(mediaPath)) {
          try {
            fs.unlinkSync(mediaPath);
          } catch (err) {
            console.error(`[ProjectService] Failed to delete media file ${mediaPath}:`, err);
          }
        }
      }
    }

    const dir = getProjectDir(id);
    if (!fileExists(dir)) return false;
    removeDir(dir);
    if (this.currentProjectId === id) this.currentProjectId = null;
    return true;
  }
}

export const projectService = new ProjectService();
