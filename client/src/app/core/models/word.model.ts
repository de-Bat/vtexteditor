export interface Word {
  id: string;
  segmentId: string;
  text: string;
  startTime: number;
  endTime: number;
  isRemoved: boolean;
  isEdited?: boolean;
  pendingText?: string;
}
