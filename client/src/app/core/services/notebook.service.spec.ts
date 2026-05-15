import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { NotebookService } from './notebook.service';
import { ClipService } from './clip.service';
import { Notebook, Note } from '../models/notebook.model';
import { Clip } from '../models/clip.model';

const MOCK_CLIP: Clip = {
  id: 'clip-1',
  projectId: 'proj-1',
  name: 'Clip 1',
  startTime: 0,
  endTime: 10,
  cutRegions: [],
  segments: [
    {
      id: 'seg-1',
      clipId: 'clip-1',
      startTime: 0,
      endTime: 10,
      text: 'hello world',
      tags: [],
      words: [
        { id: 'w-1', segmentId: 'seg-1', text: 'hello', startTime: 0, endTime: 1, isRemoved: false },
        { id: 'w-2', segmentId: 'seg-1', text: 'world', startTime: 1, endTime: 2, isRemoved: true },
      ],
    },
  ],
};

const MOCK_NOTEBOOK: Notebook = {
  id: 'nb-1',
  projectId: 'proj-1',
  name: 'Draft',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  snapshot: {
    wordStates: { 'w-1': { isRemoved: false, isPendingCut: false }, 'w-2': { isRemoved: true, isPendingCut: false } },
    cutRegions: { 'clip-1': [] },
    clipOrder: ['clip-1'],
  },
};

describe('NotebookService', () => {
  let service: NotebookService;
  let clipService: ClipService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(NotebookService);
    clipService = TestBed.inject(ClipService);
    httpMock = TestBed.inject(HttpTestingController);
    clipService.clips.set([MOCK_CLIP]);
  });

  afterEach(() => httpMock.verify());

  it('loadAll sets notebooks signal and activates first', () => {
    service.loadAll('proj-1').subscribe();
    httpMock.expectOne('/api/projects/proj-1/notebooks').flush([MOCK_NOTEBOOK]);
    httpMock.expectOne('/api/notebooks/nb-1/notes').flush([]);

    expect(service.notebooks()).toHaveLength(1);
    expect(service.active()?.id).toBe('nb-1');
    expect(service.isDirty()).toBe(false);
  });

  it('create posts snapshot and activates new notebook', () => {
    // Seed notebooks so _requireProjectId() can find projectId
    service.notebooks.set([MOCK_NOTEBOOK]);

    let result: Notebook | undefined;
    service.create('My Notebook').subscribe((nb) => (result = nb));

    const req = httpMock.expectOne('/api/projects/proj-1/notebooks');
    expect(req.request.method).toBe('POST');
    expect(req.request.body.name).toBe('My Notebook');
    expect(req.request.body.snapshot.clipOrder).toEqual(['clip-1']);
    req.flush({ ...MOCK_NOTEBOOK, id: 'nb-2', name: 'My Notebook' });

    expect(result?.name).toBe('My Notebook');
    expect(service.active()?.id).toBe('nb-2');
    expect(service.isDirty()).toBe(false);
  });

  it('save puts current snapshot and clears isDirty', () => {
    service.notebooks.set([MOCK_NOTEBOOK]);
    service.active.set(MOCK_NOTEBOOK);
    service.isDirty.set(true);

    service.save().subscribe();

    const req = httpMock.expectOne('/api/notebooks/nb-1');
    expect(req.request.method).toBe('PUT');
    req.flush({ ...MOCK_NOTEBOOK, updatedAt: '2026-01-02T00:00:00Z' });

    expect(service.isDirty()).toBe(false);
  });

  it('rename updates notebook name in list and active', () => {
    service.notebooks.set([MOCK_NOTEBOOK]);
    service.active.set(MOCK_NOTEBOOK);

    service.rename('nb-1', 'Final Cut').subscribe();

    const req = httpMock.expectOne('/api/notebooks/nb-1');
    expect(req.request.body.name).toBe('Final Cut');
    req.flush({ ...MOCK_NOTEBOOK, name: 'Final Cut' });

    expect(service.notebooks()[0].name).toBe('Final Cut');
    expect(service.active()?.name).toBe('Final Cut');
  });

  it('delete removes notebook and activates next', () => {
    const nb2: Notebook = { ...MOCK_NOTEBOOK, id: 'nb-2', name: 'Other' };
    service.notebooks.set([MOCK_NOTEBOOK, nb2]);
    service.active.set(MOCK_NOTEBOOK);

    service.delete('nb-1').subscribe();
    httpMock.expectOne('/api/notebooks/nb-1').flush(null);
    // loadNotes fires for next notebook
    httpMock.expectOne('/api/notebooks/nb-2/notes').flush([]);

    expect(service.notebooks()).toHaveLength(1);
    expect(service.active()?.id).toBe('nb-2');
  });

  it('addNote posts and appends to notes signal', () => {
    service.active.set(MOCK_NOTEBOOK);
    const payload = { text: 'Check this', attachedToType: 'word' as const, attachedToId: 'w-1', timecode: 1.5, tags: [] };

    service.addNote(payload).subscribe();

    const req = httpMock.expectOne('/api/notebooks/nb-1/notes');
    expect(req.request.method).toBe('POST');
    const created: Note = { ...payload, id: 'note-1', notebookId: 'nb-1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', tags: [] };
    req.flush(created);

    expect(service.notes()).toHaveLength(1);
    expect(service.notes()[0].id).toBe('note-1');
  });

  it('deleteNote removes from notes signal', () => {
    const note: Note = { id: 'note-1', notebookId: 'nb-1', text: 'x', attachedToType: 'word', attachedToId: 'w-1', timecode: 0, createdAt: '', updatedAt: '', tags: [] };
    service.active.set(MOCK_NOTEBOOK);
    service.notes.set([note]);

    service.deleteNote('note-1').subscribe();
    httpMock.expectOne('/api/notebooks/nb-1/notes/note-1').flush(null);

    expect(service.notes()).toHaveLength(0);
  });

  it('_captureSnapshot records isRemoved and cutRegions', () => {
    service.notebooks.set([MOCK_NOTEBOOK]);
    service.active.set(MOCK_NOTEBOOK);
    service.isDirty.set(false);

    // Trigger save to capture snapshot
    service.save().subscribe();
    const req = httpMock.expectOne('/api/notebooks/nb-1');
    const body = req.request.body;

    expect(body.snapshot.wordStates['w-1'].isRemoved).toBe(false);
    expect(body.snapshot.wordStates['w-2'].isRemoved).toBe(true);
    expect(body.snapshot.clipOrder).toEqual(['clip-1']);
    req.flush(MOCK_NOTEBOOK);
  });
});
