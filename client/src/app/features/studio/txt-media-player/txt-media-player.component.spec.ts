import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';
import { Clip } from '../../../core/models/clip.model';
import { Project } from '../../../core/models/project.model';
import { ClipService } from '../../../core/services/clip.service';
import { ProjectService } from '../../../core/services/project.service';
import { EditHistoryService } from './edit-history.service';
import { MediaPlayerService } from './media-player.service';
import { SegmentTimelineComponent } from './segment-timeline.component';
import { TxtMediaPlayerComponent } from './txt-media-player.component';

describe('TxtMediaPlayerComponent', () => {
  let fixture: ComponentFixture<TxtMediaPlayerComponent>;
  let mediaPlayerService: MediaPlayerServiceMock;

  beforeEach(async () => {
    mediaPlayerService = new MediaPlayerServiceMock();

    await TestBed.configureTestingModule({
      imports: [TxtMediaPlayerComponent],
      providers: [
        { provide: ClipService, useValue: new ClipServiceMock() },
        { provide: ProjectService, useValue: new ProjectServiceMock() },
        { provide: MediaPlayerService, useValue: mediaPlayerService },
        EditHistoryService,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TxtMediaPlayerComponent);
    fixture.componentRef.setInput('clip', createClip());
    fixture.detectChanges();
  });

  it('seeks media when timeline emits seek request', () => {
    const timelineDebugEl = fixture.debugElement.query(By.directive(SegmentTimelineComponent));
    const timeline = timelineDebugEl.componentInstance as SegmentTimelineComponent;

    timeline.seekRequested.emit(42);

    expect(mediaPlayerService.seekCalls).toEqual([42]);
  });

  it('selects a contiguous range when shift-clicking after anchor selection', () => {
    const component = fixture.componentInstance;
    const words = component.clip().segments[0].words;

    component.onWordClick(words[1], { shiftKey: false } as MouseEvent);
    component.onWordClick(words[3], { shiftKey: true } as MouseEvent);

    expect(component.selectedWordIds()).toEqual(['w2', 'w3', 'w4']);
    expect(mediaPlayerService.seekCalls).toEqual([words[1].startTime]);
  });

  it('keeps selection range stable for reverse shift-click selection', () => {
    const component = fixture.componentInstance;
    const words = component.clip().segments[0].words;

    component.onWordClick(words[3], { shiftKey: false } as MouseEvent);
    component.onWordClick(words[1], { shiftKey: true } as MouseEvent);

    expect(component.selectedWordIds()).toEqual(['w2', 'w3', 'w4']);
    expect(component.selectionAnchorWordId()).toBe(words[3].id);
  });
});

class ClipServiceMock {
  readonly updateWordStatesCalls: Array<{ clipId: string; states: { id: string; isRemoved: boolean }[] }> = [];

  updateWordStates(clipId: string, states: { id: string; isRemoved: boolean }[]) {
    this.updateWordStatesCalls.push({ clipId, states });
    return of(createClip());
  }
}

class ProjectServiceMock {
  project = signal<Project | null>({ mediaType: 'video' } as Project);
}

class MediaPlayerServiceMock {
  readonly isPlaying = signal(false);
  readonly currentTime = signal(0);
  readonly duration = signal(100);
  readonly playbackRate = signal(1);
  readonly volume = signal(1);
  readonly seekCalls: number[] = [];

  attachElement(): void {}
  detachElement(): void {}
  play(): Promise<void> {
    return Promise.resolve();
  }
  pause(): void {}
  seek(time: number): void {
    this.seekCalls.push(time);
  }
  setRate(): void {}
  setVolume(): void {}
}

function createClip(): Clip {
  return {
    id: 'clip-1',
    projectId: 'project-1',
    name: 'Clip',
    startTime: 0,
    endTime: 12,
    cutRegions: [],
    segments: [
      {
        id: 'seg-1',
        clipId: 'clip-1',
        startTime: 0,
        endTime: 12,
        text: 'one two three four',
        tags: [],
        words: [
          { id: 'w1', segmentId: 'seg-1', text: 'one', startTime: 0, endTime: 1, isRemoved: false },
          { id: 'w2', segmentId: 'seg-1', text: 'two', startTime: 1, endTime: 2, isRemoved: false },
          { id: 'w3', segmentId: 'seg-1', text: 'three', startTime: 2, endTime: 3, isRemoved: false },
          { id: 'w4', segmentId: 'seg-1', text: 'four', startTime: 3, endTime: 4, isRemoved: false },
        ],
      },
    ],
  };
}
