export interface StorySegmentRef {
  segmentId: string;
  clipId: string;
  accepted: boolean;  // default true; user can toggle to false
}

export interface StoryEvent {
  id: string;          // uuid, stable across user edits
  title: string;       // LLM-proposed, user-editable
  segments: StorySegmentRef[];
}

export interface StoryProposal {
  projectId: string;
  sourceClipIds: string[];   // transcription clip IDs consumed by this proposal
  storyClipPrefix: string;   // e.g. "Story" — used at commit time
  events: StoryEvent[];
}

/** Key used to store the proposal in project.metadata */
export const PROPOSAL_KEY = 'reconstruct2story:proposal';
