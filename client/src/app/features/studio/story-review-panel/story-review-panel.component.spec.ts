import { TestBed } from '@angular/core/testing';
import { StoryReviewPanelComponent } from './story-review-panel.component';
import { StoryProposal } from '../../../core/models/story-proposal.model';
import { By } from '@angular/platform-browser';

const makeProposal = (): StoryProposal => ({
  projectId: 'proj-1',
  sourceClipIds: ['clip-src'],
  storyClipPrefix: 'Story',
  events: [
    {
      id: 'evt-1',
      title: 'Family',
      segments: [
        { segmentId: 'seg-1', clipId: 'clip-src', accepted: true },
        { segmentId: 'seg-2', clipId: 'clip-src', accepted: true },
      ],
    },
  ],
});

const SEGMENT_TEXTS: Record<string, string> = {
  'seg-1': 'My mother came from a village.',
  'seg-2': 'We had five siblings.',
};

describe('StoryReviewPanelComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StoryReviewPanelComponent],
    }).compileComponents();
  });

  it('renders one section per event', () => {
    const fixture = TestBed.createComponent(StoryReviewPanelComponent);
    fixture.componentRef.setInput('proposal', makeProposal());
    fixture.componentRef.setInput('segmentTexts', SEGMENT_TEXTS);
    fixture.detectChanges();

    const sections = fixture.debugElement.queryAll(By.css('.event-section'));
    expect(sections.length).toBe(1);
  });

  it('shows the event title', () => {
    const fixture = TestBed.createComponent(StoryReviewPanelComponent);
    fixture.componentRef.setInput('proposal', makeProposal());
    fixture.componentRef.setInput('segmentTexts', SEGMENT_TEXTS);
    fixture.detectChanges();

    const title = fixture.debugElement.query(By.css('.event-title'));
    expect(title.nativeElement.textContent).toContain('Family');
  });

  it('emits commit with current events on confirm click', () => {
    const fixture = TestBed.createComponent(StoryReviewPanelComponent);
    fixture.componentRef.setInput('proposal', makeProposal());
    fixture.componentRef.setInput('segmentTexts', SEGMENT_TEXTS);
    fixture.detectChanges();

    let emitted: StoryProposal['events'] | undefined;
    fixture.componentInstance.commit.subscribe((v: StoryProposal['events']) => (emitted = v));

    fixture.debugElement.query(By.css('[data-testid="btn-commit"]')).nativeElement.click();
    expect(emitted).toBeDefined();
    expect(emitted![0].title).toBe('Family');
  });

  it('emits discard on discard click', () => {
    const fixture = TestBed.createComponent(StoryReviewPanelComponent);
    fixture.componentRef.setInput('proposal', makeProposal());
    fixture.componentRef.setInput('segmentTexts', SEGMENT_TEXTS);
    fixture.detectChanges();

    let discarded = false;
    fixture.componentInstance.discard.subscribe(() => (discarded = true));

    fixture.debugElement.query(By.css('[data-testid="btn-discard"]')).nativeElement.click();
    expect(discarded).toBe(true);
  });

  it('toggling a segment flips accepted state', () => {
    const fixture = TestBed.createComponent(StoryReviewPanelComponent);
    fixture.componentRef.setInput('proposal', makeProposal());
    fixture.componentRef.setInput('segmentTexts', SEGMENT_TEXTS);
    fixture.detectChanges();

    const toggle = fixture.debugElement.query(By.css('.segment-toggle'));
    toggle.nativeElement.click();
    fixture.detectChanges();

    const segRow = fixture.debugElement.query(By.css('.segment-row'));
    expect(segRow.classes['rejected']).toBe(true);
  });
});
