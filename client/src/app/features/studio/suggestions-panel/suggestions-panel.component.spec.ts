import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { vi } from 'vitest';
import { SuggestionsPanelComponent } from './suggestions-panel.component';
import { SuggestionService } from '../suggestions/suggestion.service';
import { Suggestion } from '../../../core/models/suggestion.model';

const MOCK_SUGGESTION: Suggestion = {
  id: 'sug1', clipId: 'clip1', wordIds: ['w1'], text: 'um',
  reason: 'filler-word', reasonLabel: 'Filler word',
  confidence: 0.9, source: 'speech',
};

describe('SuggestionsPanelComponent', () => {
  let fixture: ComponentFixture<SuggestionsPanelComponent>;
  let service: SuggestionService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SuggestionsPanelComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations()],
    }).compileComponents();
    fixture = TestBed.createComponent(SuggestionsPanelComponent);
    service = TestBed.inject(SuggestionService);
    fixture.detectChanges();
  });

  it('shows empty state when no suggestions', () => {
    service['_suggestions'].set([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No suggestions yet');
  });

  it('renders a card for each suggestion', () => {
    service['_suggestions'].set([MOCK_SUGGESTION]);
    fixture.detectChanges();
    const cards = fixture.nativeElement.querySelectorAll('.suggestion-card');
    expect(cards.length).toBe(1);
  });

  it('emits focusSuggestion with first wordId when card is clicked', () => {
    service['_suggestions'].set([MOCK_SUGGESTION]);
    fixture.detectChanges();
    let emitted: string | undefined;
    fixture.componentInstance.focusSuggestion.subscribe((id: string) => emitted = id);
    fixture.nativeElement.querySelector('.suggestion-card').click();
    expect(emitted).toBe('w1');
  });

  it('calls service.accept when accept button clicked', () => {
    service['_suggestions'].set([MOCK_SUGGESTION]);
    fixture.detectChanges();
    const spy = vi.spyOn(service, 'accept');
    fixture.nativeElement.querySelector('.btn-accept').click();
    expect(spy).toHaveBeenCalledWith('sug1');
  });

  it('calls service.reject when reject button clicked', () => {
    service['_suggestions'].set([MOCK_SUGGESTION]);
    fixture.detectChanges();
    const spy = vi.spyOn(service, 'reject');
    fixture.nativeElement.querySelector('.btn-reject').click();
    expect(spy).toHaveBeenCalledWith('sug1');
  });

  it('calls service.acceptHighConfidence when "Accept High Confidence" clicked', () => {
    service['_suggestions'].set([MOCK_SUGGESTION]);
    fixture.detectChanges();
    const spy = vi.spyOn(service, 'acceptHighConfidence');
    fixture.nativeElement.querySelector('.btn-accept-high').click();
    expect(spy).toHaveBeenCalledWith(0.8);
  });
});
