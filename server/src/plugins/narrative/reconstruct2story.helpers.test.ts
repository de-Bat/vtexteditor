import { describe, it, expect } from 'vitest';
import { buildPrompt } from './reconstruct2story.helpers';
import { Clip } from '../../models/clip.model';

const makeClip = (segments: { id: string; text: string }[]): Clip => ({
  id: 'clip-1',
  projectId: 'proj-1',
  name: 'Test',
  startTime: 0,
  endTime: 60,
  segments: segments.map((s, i) => ({
    id: s.id,
    clipId: 'clip-1',
    startTime: i * 10,
    endTime: i * 10 + 10,
    text: s.text,
    words: [],
    tags: [],
  })),
});

describe('buildPrompt', () => {
  it('includes each segment formatted as [ID] text', () => {
    const clip = makeClip([
      { id: 'seg-1', text: 'My mother came from a village.' },
      { id: 'seg-2', text: 'We had five siblings.' },
    ]);
    const prompt = buildPrompt([clip], { maxEvents: 10 });
    expect(prompt).toContain('[seg-1] My mother came from a village.');
    expect(prompt).toContain('[seg-2] We had five siblings.');
  });

  it('includes seed categories when provided', () => {
    const clip = makeClip([{ id: 'seg-1', text: 'Hello.' }]);
    const prompt = buildPrompt([clip], { maxEvents: 5, seedCategories: 'family, school' });
    expect(prompt).toContain('family, school');
  });

  it('includes maxEvents cap in the prompt', () => {
    const clip = makeClip([{ id: 'seg-1', text: 'Hello.' }]);
    const prompt = buildPrompt([clip], { maxEvents: 7 });
    expect(prompt).toContain('7');
  });

  it('instructs the LLM to return only JSON', () => {
    const clip = makeClip([{ id: 'seg-1', text: 'Hello.' }]);
    const prompt = buildPrompt([clip], { maxEvents: 10 });
    expect(prompt).toContain('Return ONLY a JSON array');
  });
});
