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
  cutRegions: [],
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

  it('parses valid JSON array with segment objects from LLM response', () => {
    const raw = JSON.stringify([
      { title: 'Family', segments: [{ id: 'seg-1', text: 'Clean text' }, { id: 'seg-2' }] },
    ]);
    const result = parseEvents(raw, validIds);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Family');
    expect(result[0].segments).toEqual([
      { id: 'seg-1', text: 'Clean text' },
      { id: 'seg-2', text: undefined },
    ]);
  });

  it('strips markdown code fences', () => {
    const raw = '```json\n[{ "title": "School", "segments": [{ "id": "seg-3" }] }]\n```';
    const result = parseEvents(raw, validIds);
    expect(result[0].title).toBe('School');
    expect(result[0].segments[0].id).toBe('seg-3');
  });

  it('silently discards segment IDs not in validIds', () => {
    const raw = JSON.stringify([
      { title: 'Family', segments: ['seg-1', 'seg-UNKNOWN'] },
    ]);
    const result = parseEvents(raw, validIds);
    expect(result[0].segments).toEqual([{ id: 'seg-1', text: undefined }]);
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
      cutRegions: [] as import('../../models/clip.model').CutRegion[],
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
    // Fresh UUID is generated for each committed segment to prevent ID
    // propagation across re-runs (the original ID must NOT be reused).
    expect(clips[0].segments[0].id).not.toBe('seg-1');
    expect(clips[0].segments[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
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

  it('generates a CutRegion for omitted segments between accepted ones', () => {
    const events: StoryEvent[] = [
      {
        id: 'evt-1',
        title: 'Gap Test',
        segments: [
          { segmentId: 'seg-1', clipId: 'clip-src', accepted: true },
          // seg-2 is omitted
          { segmentId: 'seg-3', clipId: 'clip-src', accepted: true },
        ],
      },
    ];
    const clips = buildCommitClips('proj-1', events, sourceClips, 'Story');
    expect(clips).toHaveLength(1);
    expect(clips[0].cutRegions).toHaveLength(1);
    expect(clips[0].cutRegions[0].startTime).toBe(5);  // end of seg-1
    expect(clips[0].cutRegions[0].endTime).toBe(20);   // start of seg-3
    expect(clips[0].cutRegions[0].effectType).toBe('hard-cut');
  });

  it('sets showSilenceMarkers to true on committed clips', () => {
    const events: StoryEvent[] = [{ id: 'evt-1', title: 'T', segments: [{ segmentId: 'seg-1', clipId: 'clip-src', accepted: true }] }];
    const clips = buildCommitClips('proj-1', events, sourceClips, 'Story');
    expect(clips[0].showSilenceMarkers).toBe(true);
  });

  it('trims filler words and cuts leading silence using ref.text', () => {
    const source = [
      {
        id: 'c1',
        projectId: 'p1',
        name: 'S',
        startTime: 0,
        endTime: 10,
        cutRegions: [],
        segments: [
          {
            id: 's1',
            clipId: 'c1',
            startTime: 0,
            endTime: 10,
            text: 'uh hello world',
            words: [
              { id: 'w1', segmentId: 's1', text: 'uh', startTime: 0, endTime: 1, isRemoved: false },
              { id: 'w2', segmentId: 's1', text: 'hello', startTime: 2, endTime: 3, isRemoved: false },
              { id: 'w3', segmentId: 's1', text: 'world', startTime: 3, endTime: 4, isRemoved: false },
            ],
            tags: [],
          },
        ],
      },
    ];

    const events: StoryEvent[] = [
      {
        id: 'evt-1',
        title: 'Trimmed',
        segments: [
          { segmentId: 's1', clipId: 'c1', accepted: true, text: 'hello world' },
        ],
      },
    ];

    const clips = buildCommitClips('p1', events, source, 'Story');
    const seg = clips[0].segments[0];
    
    // Check words
    expect(seg.words[0].isRemoved).toBe(true);  // 'uh' removed
    expect(seg.words[1].isRemoved).toBe(false); // 'hello' kept
    expect(seg.words[2].isRemoved).toBe(false); // 'world' kept

    // Check silence cutting (leading 'uh' start=0, 'hello' start=2)
    expect(seg.startTime).toBe(2);
    expect(seg.endTime).toBe(4);

    // Check clip bounds
    expect(clips[0].startTime).toBe(2);
    expect(clips[0].endTime).toBe(4);
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

  it('instructs the LLM about first-person goals and trimming', () => {
    const clip = makeClip([{ id: 'seg-1', text: 'Hello.' }]);
    const { prompt } = buildPrompt([clip], { maxEvents: 10 });
    expect(prompt).toContain('Create a coherent life story told by the person themselves');
    expect(prompt).toContain('"Trim" segments to remove filler words');
    expect(prompt).toContain('Return ONLY a JSON array');
    expect(prompt).toContain('"text": "The cleaned/trimmed text to keep"');
  });

  it('labels empty segments as [Silence]', () => {
    const clip = makeClip([{ id: 'seg-1', text: '' }]);
    const { prompt } = buildPrompt([clip], { maxEvents: 5 });
    expect(prompt).toContain('[S001] [Silence]');
  });

  it('detects and labels internal pauses between words', () => {
    const clip = makeClip([{ id: 'seg-1', text: 'Hello world' }]);
    clip.segments[0].words = [
      { id: 'w1', startTime: 0, endTime: 1, text: 'Hello', segmentId: 'seg-1', isRemoved: false },
      { id: 'w2', startTime: 5, endTime: 6, text: 'world', segmentId: 'seg-1', isRemoved: false }, // 4s gap
    ];
    const { prompt } = buildPrompt([clip], { maxEvents: 5 });
    expect(prompt).toContain('(Pause 4.0s)');
  });
});
