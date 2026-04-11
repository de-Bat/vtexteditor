import { describe, it, expect } from 'vitest';
import { buildPrompt, parseEvents, buildCommitClips } from './reconstruct2story.helpers';
import { Clip } from '../../models/clip.model';
import { StoryEvent } from './reconstruct2story.types';
import { Segment } from '../../models/segment.model';

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

describe('parseEvents', () => {
  const validIds = new Set(['seg-1', 'seg-2', 'seg-3']);

  it('parses valid JSON array from LLM response', () => {
    const raw = JSON.stringify([
      { title: 'Family', segments: ['seg-1', 'seg-2'] },
    ]);
    const result = parseEvents(raw, validIds);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Family');
    expect(result[0].segments).toEqual(['seg-1', 'seg-2']);
  });

  it('strips markdown code fences', () => {
    const raw = '```json\n[{ "title": "School", "segments": ["seg-3"] }]\n```';
    const result = parseEvents(raw, validIds);
    expect(result[0].title).toBe('School');
  });

  it('silently discards segment IDs not in validIds', () => {
    const raw = JSON.stringify([
      { title: 'Family', segments: ['seg-1', 'seg-UNKNOWN'] },
    ]);
    const result = parseEvents(raw, validIds);
    expect(result[0].segments).toEqual(['seg-1']);
  });

  it('drops events with no valid segments', () => {
    const raw = JSON.stringify([
      { title: 'Ghost', segments: ['seg-UNKNOWN'] },
    ]);
    const result = parseEvents(raw, validIds);
    expect(result).toHaveLength(0);
  });

  it('throws on non-array JSON', () => {
    expect(() => parseEvents('{ "title": "x" }', validIds)).toThrow();
  });
});

describe('buildCommitClips', () => {
  const makeSegment = (id: string, clipId: string, start: number): Segment => ({
    id,
    clipId,
    startTime: start,
    endTime: start + 5,
    text: `Text of ${id}`,
    words: [],
    tags: [],
  });

  const sourceClips = [
    {
      id: 'clip-src',
      projectId: 'proj-1',
      name: 'Transcription',
      startTime: 0,
      endTime: 30,
      segments: [
        makeSegment('seg-1', 'clip-src', 0),
        makeSegment('seg-2', 'clip-src', 10),
        makeSegment('seg-3', 'clip-src', 20),
      ],
    },
  ];

  it('creates one clip per event with accepted segments only', () => {
    const events: StoryEvent[] = [
      {
        id: 'evt-1',
        title: 'Family',
        segments: [
          { segmentId: 'seg-1', clipId: 'clip-src', accepted: true },
          { segmentId: 'seg-2', clipId: 'clip-src', accepted: false },
        ],
      },
    ];
    const clips = buildCommitClips('proj-1', events, sourceClips, 'Story');
    expect(clips).toHaveLength(1);
    expect(clips[0].name).toBe('Story: Family');
    expect(clips[0].segments).toHaveLength(1);
    expect(clips[0].segments[0].id).toBe('seg-1');
  });

  it('drops events with zero accepted segments', () => {
    const events: StoryEvent[] = [
      {
        id: 'evt-1',
        title: 'Empty',
        segments: [{ segmentId: 'seg-1', clipId: 'clip-src', accepted: false }],
      },
    ];
    const clips = buildCommitClips('proj-1', events, sourceClips, 'Story');
    expect(clips).toHaveLength(0);
  });

  it('rewrites segment.clipId to the event id', () => {
    const events: StoryEvent[] = [
      {
        id: 'evt-2',
        title: 'School',
        segments: [{ segmentId: 'seg-3', clipId: 'clip-src', accepted: true }],
      },
    ];
    const clips = buildCommitClips('proj-1', events, sourceClips, 'Story');
    expect(clips[0].segments[0].clipId).toBe('evt-2');
  });

  it('sets clip startTime/endTime from first/last accepted segment', () => {
    const events: StoryEvent[] = [
      {
        id: 'evt-1',
        title: 'Life',
        segments: [
          { segmentId: 'seg-1', clipId: 'clip-src', accepted: true },
          { segmentId: 'seg-3', clipId: 'clip-src', accepted: true },
        ],
      },
    ];
    const clips = buildCommitClips('proj-1', events, sourceClips, 'Story');
    expect(clips[0].startTime).toBe(0);   // seg-1.startTime
    expect(clips[0].endTime).toBe(25);    // seg-3.endTime (20 + 5)
  });
});

describe('buildPrompt', () => {
  it('includes each segment formatted as [ID] text', () => {
    const clip = makeClip([
      { id: 'seg-1', text: 'My mother came from a village.' },
      { id: 'seg-2', text: 'We had five siblings.' },
    ]);
    const { prompt } = buildPrompt([clip], { maxEvents: 10 });
    expect(prompt).toContain('[S001] My mother came from a village.');
    expect(prompt).toContain('[S002] We had five siblings.');
  });

  it('includes seed categories when provided', () => {
    const clip = makeClip([{ id: 'seg-1', text: 'Hello.' }]);
    const { prompt } = buildPrompt([clip], { maxEvents: 5, seedCategories: 'family, school' });
    expect(prompt).toContain('family, school');
  });

  it('includes maxEvents cap in the prompt', () => {
    const clip = makeClip([{ id: 'seg-1', text: 'Hello.' }]);
    const { prompt } = buildPrompt([clip], { maxEvents: 7 });
    expect(prompt).toContain('7');
  });

  it('instructs the LLM to return only JSON', () => {
    const clip = makeClip([{ id: 'seg-1', text: 'Hello.' }]);
    const { prompt } = buildPrompt([clip], { maxEvents: 10 });
    expect(prompt).toContain('Return ONLY a JSON array');
  });
});
