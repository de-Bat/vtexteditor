import { describe, it, expect } from 'vitest';
import { 
  buildExtractionPrompt, 
  parseResults, 
  applyResults, 
  addTrailToClip 
} from './locations.plugin';
import { Segment } from '../../models/segment.model';
import { Clip } from '../../models/clip.model';
import { GeoMetadata, TrailMetadata } from '../../models/segment-metadata.model';

describe('Locations Plugin Helpers', () => {

  const makeSegment = (id: string, text: string): Segment => ({
    id,
    clipId: 'clip-1',
    startTime: 0,
    endTime: 10,
    text,
    words: [],
    tags: [],
  });

  describe('parseResults', () => {
    it('parses valid JSON from LLM response', () => {
      const response = 'Here is the JSON: {"seg-1": [{"name": "Paris", "lat": 48, "lng": 2, "confidence": 0.9}]}';
      const results = parseResults(response);
      expect(results['seg-1']).toHaveLength(1);
      expect(results['seg-1'][0].name).toBe('Paris');
    });

    it('strips markdown fences', () => {
      const response = '```json\n{"seg-1": []}\n```';
      const results = parseResults(response);
      expect(results).toEqual({"seg-1": []});
    });

    it('throws if no JSON found', () => {
      expect(() => parseResults('No JSON here')).toThrow();
    });
  });

  describe('applyResults', () => {
    it('adds GeoMetadata to segments based on results', () => {
      const segs = [makeSegment('seg-1', 'He went to London.')];
      const results = {
        'seg-1': [{ name: 'London', lat: 51.5, lng: -0.1, confidence: 0.9 }]
      };
      
      applyResults(segs, results, 0.5);
      
      expect(segs[0].metadata?.['locations']).toHaveLength(1);
      const meta = segs[0].metadata?.['locations'][0] as GeoMetadata;
      expect(meta.type).toBe('geo');
      expect(meta.placeName).toBe('London');
      expect(meta.lat).toBe(51.5);
    });

    it('filters by minConfidence', () => {
      const segs = [makeSegment('seg-1', 'Text')];
      const results = {
        'seg-1': [{ name: 'LowConf', lat: 0, lng: 0, confidence: 0.1 }]
      };
      
      applyResults(segs, results, 0.5);
      expect(segs[0].metadata).toBeUndefined();
    });
  });

  describe('addTrailToClip', () => {
    it('creates a TrailMetadata for the clip from segment locations', () => {
      const seg1 = makeSegment('s1', 'A');
      const seg2 = makeSegment('s2', 'B');
      
      seg1.metadata = {
        'locations': [{ type: 'geo', sourcePluginId: 'locations', lat: 10, lng: 20, placeName: 'Place A', confidence: 1 } as GeoMetadata]
      };
      seg2.metadata = {
        'locations': [{ type: 'geo', sourcePluginId: 'locations', lat: 30, lng: 40, placeName: 'Place B', confidence: 1 } as GeoMetadata]
      };

      const clip: Clip = {
        id: 'clip-1',
        projectId: 'p1',
        name: 'Clip',
        startTime: 0,
        endTime: 20,
        segments: [seg1, seg2],
        cutRegions: [],
      };

      addTrailToClip(clip);
      
      expect(clip.metadata?.['locations']).toHaveLength(1);
      const trail = clip.metadata?.['locations'][0] as TrailMetadata;
      expect(trail.type).toBe('trail');
      expect(trail.points).toHaveLength(2);
      expect(trail.points[0].name).toBe('Place A');
      expect(trail.points[1].name).toBe('Place B');
    });

    it('removes duplicate location names in the trail', () => {
      const seg1 = makeSegment('s1', 'A');
      const seg2 = makeSegment('s2', 'B');
      
      const geoA = { type: 'geo', sourcePluginId: 'locations', lat: 10, lng: 20, placeName: 'Place A', confidence: 1 } as GeoMetadata;

      seg1.metadata = { 'locations': [geoA] };
      seg2.metadata = { 'locations': [geoA] };

      const clip: Clip = {
        id: 'c1', projectId: 'p1', name: 'N', startTime: 0, endTime: 10,
        segments: [seg1, seg2], cutRegions: [],
      };

      addTrailToClip(clip);
      expect((clip.metadata?.['locations'][0] as TrailMetadata).points).toHaveLength(1);
    });
  });
});
