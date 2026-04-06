import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Project } from '../models/project.model';
import {
  getProjectDir,
  getProjectFilePath,
  ensureDir,
  writeJsonAtomic,
  readJson,
  fileExists,
} from '../utils/file.util';

const CURRENT_PROJECT_ID_FILE = path.join(
  require('../config').config.storage.projects,
  'current.txt'
);

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
}

export const projectService = new ProjectService();
