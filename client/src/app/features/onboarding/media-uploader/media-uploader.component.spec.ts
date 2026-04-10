import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { MediaUploaderComponent } from './media-uploader.component';
import { FileHashService } from '../../../core/services/file-hash.service';
import { of } from 'rxjs';

const makeFile = (name = 'video.mp4') =>
  new File(['content'], name, { type: 'video/mp4' });

/** Drain the microtask queue enough times for async/await chains to settle. */
const flushMicrotasks = async (times = 5) => {
  for (let i = 0; i < times; i++) await Promise.resolve();
};

describe('MediaUploaderComponent', () => {
  let httpMock: HttpTestingController;
  let fakeHashService: { computeHash: ReturnType<typeof vi.fn>; checkCache: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    fakeHashService = {
      computeHash: vi.fn().mockResolvedValue('abc123'),
      checkCache: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [MediaUploaderComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: FileHashService, useValue: fakeHashService },
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('calls from-cache endpoint on cache hit', async () => {
    fakeHashService.checkCache.mockReturnValue(of({ exists: true }));

    const fixture = TestBed.createComponent(MediaUploaderComponent);
    fixture.detectChanges();

    (fixture.componentInstance as any).upload(makeFile());
    await flushMicrotasks();

    const req = httpMock.expectOne('/api/media/from-cache');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ hash: 'abc123', originalName: 'video.mp4' });
    req.flush({ mediaId: 'm1', project: { id: 'p1' } });

    expect(fixture.componentInstance.uploading()).toBeFalsy();
  });

  it('falls back to upload on cache miss', async () => {
    fakeHashService.checkCache.mockReturnValue(of({ exists: false }));

    const fixture = TestBed.createComponent(MediaUploaderComponent);
    fixture.detectChanges();

    (fixture.componentInstance as any).upload(makeFile());
    await flushMicrotasks();

    const req = httpMock.expectOne('/api/media');
    expect(req.request.method).toBe('POST');
    req.flush({ mediaId: 'm1', project: { id: 'p1' } });

    expect(fixture.componentInstance.uploading()).toBeFalsy();
  });

  it('falls back to upload when hash computation fails', async () => {
    fakeHashService.computeHash.mockRejectedValue(new Error('crypto unavailable'));

    const fixture = TestBed.createComponent(MediaUploaderComponent);
    fixture.detectChanges();

    (fixture.componentInstance as any).upload(makeFile());
    await flushMicrotasks();

    const req = httpMock.expectOne('/api/media');
    req.flush({ mediaId: 'm1', project: { id: 'p1' } });
    expect(fixture.componentInstance.uploading()).toBeFalsy();
  });

  it('falls back to upload when from-cache returns error', async () => {
    fakeHashService.checkCache.mockReturnValue(of({ exists: true }));

    const fixture = TestBed.createComponent(MediaUploaderComponent);
    fixture.detectChanges();

    (fixture.componentInstance as any).upload(makeFile());
    await flushMicrotasks();

    // from-cache fails (server restart cleared cache)
    const fromCacheReq = httpMock.expectOne('/api/media/from-cache');
    fromCacheReq.flush({ error: 'File not in cache' }, { status: 404, statusText: 'Not Found' });

    await flushMicrotasks();

    // Should fall back to normal upload
    const uploadReq = httpMock.expectOne('/api/media');
    uploadReq.flush({ mediaId: 'm1', project: { id: 'p1' } });
    expect(fixture.componentInstance.uploading()).toBeFalsy();
  });
});
