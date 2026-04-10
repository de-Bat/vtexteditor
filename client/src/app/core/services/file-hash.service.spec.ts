import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { FileHashService } from './file-hash.service';

describe('FileHashService', () => {
  let service: FileHashService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(FileHashService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('computes SHA-256 hash of a file as a hex string', async () => {
    // 'hello' in UTF-8 bytes
    const bytes = new TextEncoder().encode('hello');
    const file = new File([bytes], 'hello.txt', { type: 'text/plain' });

    const hash = await service.computeHash(file);

    // SHA-256 of 'hello'
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('checkCache returns exists:true on cache hit', () => {
    let result: { exists: boolean } | undefined;
    service.checkCache('abc123').subscribe(r => (result = r));

    const req = httpMock.expectOne('/api/media/check/abc123');
    expect(req.request.method).toBe('GET');
    req.flush({ exists: true });

    expect(result).toEqual({ exists: true });
  });

  it('checkCache returns exists:false on cache miss', () => {
    let result: { exists: boolean } | undefined;
    service.checkCache('deadbeef').subscribe(r => (result = r));

    httpMock.expectOne('/api/media/check/deadbeef').flush({ exists: false });
    expect(result).toEqual({ exists: false });
  });
});
