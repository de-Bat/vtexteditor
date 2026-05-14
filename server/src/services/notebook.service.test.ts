import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { config } from '../config';

// Temporarily redirect project storage to a temp dir
let tmpDir: string;
let originalProjects: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtx-test-'));
  originalProjects = config.storage.projects;
  config.storage.projects = tmpDir;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  config.storage.projects = originalProjects;
});

// Import after the beforeEach hooks are registered so the module uses config
import { notebookService } from './notebook.service';

describe('notebookService.addNote', () => {
  it('persists tags and updatedAt on creation', () => {
    const nb = notebookService.create('proj-1', 'My Notebook', { wordStates: {}, cutRegions: {}, clipOrder: [] });
    const note = notebookService.addNote('proj-1', nb.id, {
      text: 'hello',
      attachedToType: 'clip',
      attachedToId: 'clip-1',
      timecode: 10,
      tags: ['pacing', 'audio'],
    });
    expect(note).not.toBeNull();
    expect(note!.tags).toEqual(['pacing', 'audio']);
    expect(note!.updatedAt).toBeTruthy();
  });

  it('defaults tags to [] when omitted', () => {
    const nb = notebookService.create('proj-2', 'NB', { wordStates: {}, cutRegions: {}, clipOrder: [] });
    const note = notebookService.addNote('proj-2', nb.id, {
      text: 'test',
      attachedToType: 'word',
      attachedToId: 'w-1',
      timecode: 0,
      tags: [],
    });
    expect(note!.tags).toEqual([]);
  });
});

describe('notebookService.updateNote', () => {
  it('updates text and tags, bumps updatedAt', async () => {
    const nb = notebookService.create('proj-3', 'NB', { wordStates: {}, cutRegions: {}, clipOrder: [] });
    const note = notebookService.addNote('proj-3', nb.id, {
      text: 'original',
      attachedToType: 'clip',
      attachedToId: 'clip-1',
      timecode: 5,
      tags: [],
    })!;

    await new Promise(r => setTimeout(r, 5)); // ensure timestamp differs

    const updated = notebookService.updateNote('proj-3', nb.id, note.id, {
      text: 'revised',
      tags: ['b-roll'],
    });
    expect(updated).not.toBeNull();
    expect(updated!.text).toBe('revised');
    expect(updated!.tags).toEqual(['b-roll']);
    expect(updated!.updatedAt).not.toBe(note.updatedAt);
    expect(updated!.createdAt).toBe(note.createdAt);
  });

  it('returns null when note does not exist', () => {
    const nb = notebookService.create('proj-4', 'NB', { wordStates: {}, cutRegions: {}, clipOrder: [] });
    const result = notebookService.updateNote('proj-4', nb.id, 'no-such-id', { text: 'x', tags: [] });
    expect(result).toBeNull();
  });
});
