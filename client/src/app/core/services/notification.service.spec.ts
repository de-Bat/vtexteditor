import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(NotificationService);
  });

  it('push() adds to history with timestamp', () => {
    service.push('success', 'hello');
    expect(service.history().length).toBe(1);
    expect(service.history()[0].text).toBe('hello');
    expect(service.history()[0].type).toBe('success');
    expect(service.history()[0].timestamp).toBeInstanceOf(Date);
  });

  it('push() does NOT auto-dismiss', () => {
    vi.useFakeTimers();
    try {
      service.push('info', 'stay');
      vi.advanceTimersByTime(10000);
      expect(service.history().length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('dismiss() removes by id', () => {
    service.push('error', 'err');
    const id = service.history()[0].id;
    service.dismiss(id);
    expect(service.history().length).toBe(0);
  });

  it('clearAll() empties history', () => {
    service.push('success', 'a');
    service.push('error', 'b');
    service.clearAll();
    expect(service.history().length).toBe(0);
  });

  it('messages() is alias for history()', () => {
    service.push('info', 'x');
    expect(service.messages()).toEqual(service.history());
  });
});
