export interface StorySegmentRef {
  segmentId: string;
  clipId: string;
  accepted: boolean;
}

export interface StoryEvent {
  id: string;
  title: string;
  segments: StorySegmentRef[];
}

export interface StoryProposal {
  projectId: string;
  sourceClipIds: string[];
  storyClipPrefix: string;
  events: StoryEvent[];
}
