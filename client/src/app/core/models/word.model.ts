export interface Word {
  id: string;
  segmentId: string;
  text: string;
  startTime: number; // seconds (float)
  endTime: number;
  isRemoved: boolean;
  isEdited?: boolean;
}
