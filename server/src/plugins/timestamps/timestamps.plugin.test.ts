import { describe, it, expect } from 'vitest';
import { Clip } from '../../models/clip.model';
import { Segment } from '../../models/segment.model';
import { addIntervalToClip, applyResults, buildExtractionPrompt, parseResults } from './timestamps.plugin';
import { DateIntervalMetadata } from '../../models/segment-metadata.model';

describe('Timestamps Plugin', () => {
  describe('buildExtractionPrompt', () => {
    it('should build a prompt containing segment IDs and text', () => {
      const segments: Segment[] = [
        { id: '1', text: 'In 1945 the war ended.', startTime: 0, endTime: 10, words: [] },
        { id: '2', text: 'Then in the 50s everything changed.', startTime: 10, endTime: 20, words: [] },
      ];
      const prompt = buildExtractionPrompt(segments);
      expect(prompt).toContain('[1] In 1945 the war ended.');
      expect(prompt).toContain('[2] Then in the 50s everything changed.');
      expect(prompt).toContain('JSON');
    });
  });

  describe('parseResults', () => {
    it('should parse valid JSON from LLM response', () => {
      const response = '```json\n{"1": [{"label": "1945", "startYear": 1945, "endYear": 1945}]}\n```';
      const results = parseResults(response);
      expect(results['1']).toHaveLength(1);
      expect(results['1'][0].label).toBe('1945');
    });
  });

  describe('applyResults', () => {
    it('should add DateIntervalMetadata to segments', () => {
      const segments: Segment[] = [
        { id: '1', text: 'text', startTime: 0, endTime: 10, words: [] },
      ];
      const results = {
        '1': [{ label: '1945', startYear: 1945, endYear: 1945 }]
      };
      applyResults(segments, results);
      expect(segments[0].metadata).toBeDefined();
      const meta = segments[0].metadata!['timestamps'] as DateIntervalMetadata[];
      expect(meta).toHaveLength(1);
      expect(meta[0].label).toBe('1945');
      expect(meta[0].startYear).toBe(1945);
    });
  });

  describe('addIntervalToClip', () => {
    it('should consolidate years into a range for the clip', () => {
      const seg1: Segment = { id: '1', text: '1930', startTime: 0, endTime: 10, words: [], metadata: {
        'timestamps': [{ type: 'dateInterval', sourcePluginId: 'timestamps', label: '1930', startYear: 1930, endYear: 1930 }]
      }};
      const seg2: Segment = { id: '2', text: '1940', startTime: 10, endTime: 20, words: [], metadata: {
        'timestamps': [{ type: 'dateInterval', sourcePluginId: 'timestamps', label: '1940', startYear: 1940, endYear: 1940 }]
      }};
      
      const clip: Clip = {
        id: 'c1',
        projectId: 'p1',
        name: 'clip',
        startTime: 0,
        endTime: 20,
        segments: [seg1, seg2],
        cutRegions: []
      };

      addIntervalToClip(clip);
      expect(clip.metadata).toBeDefined();
      const meta = clip.metadata!['timestamps'] as DateIntervalMetadata[];
      expect(meta).toHaveLength(1);
      expect(meta[0].label).toBe('1930 - 1940');
      expect(meta[0].startYear).toBe(1930);
      expect(meta[0].endYear).toBe(1940);
    });

    it('should use a single year label if min and max years are the same', () => {
      const seg1: Segment = { id: '1', text: '1930', startTime: 0, endTime: 10, words: [], metadata: {
        'timestamps': [{ type: 'dateInterval', sourcePluginId: 'timestamps', label: '1930', startYear: 1930, endYear: 1930 }]
      }};
      
      const clip: Clip = {
        id: 'c1',
        projectId: 'p1',
        name: 'clip',
        startTime: 0,
        endTime: 10,
        segments: [seg1],
        cutRegions: []
      };

      addIntervalToClip(clip);
      expect(clip.metadata!['timestamps'][0].label).toBe('1930');
    });

    it('should fallback to comma separated labels if years are missing', () => {
      const seg1: Segment = { id: '1', text: 'Unknown time', startTime: 0, endTime: 10, words: [], metadata: {
        'timestamps': [{ type: 'dateInterval', sourcePluginId: 'timestamps', label: 'Ancient times' }]
      }};
      const seg2: Segment = { id: '2', text: 'Modern times', startTime: 10, endTime: 20, words: [], metadata: {
        'timestamps': [{ type: 'dateInterval', sourcePluginId: 'timestamps', label: 'Modern times' }]
      }};
      
      const clip: Clip = {
        id: 'c1',
        projectId: 'p1',
        name: 'clip',
        startTime: 0,
        endTime: 20,
        segments: [seg1, seg2],
        cutRegions: []
      };

      addIntervalToClip(clip);
      expect(clip.metadata!['timestamps'][0].label).toBe('Ancient times, Modern times');
    });
  });
});
