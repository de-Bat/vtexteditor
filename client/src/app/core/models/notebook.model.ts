import { CutRegion } from './cut-region.model';

export interface NotebookSnapshot {
  wordStates: Record<string, { isRemoved: boolean; isPendingCut: boolean }>;
  cutRegions: Record<string, CutRegion[]>;
  clipOrder: string[];
}

export interface Notebook {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  snapshot: NotebookSnapshot;
}

export interface Note {
  id: string;
  notebookId: string;
  text: string;
  attachedToType: 'word' | 'segment' | 'clip';
  attachedToId: string;
  timecode: number;
  createdAt: string;
}
