export interface Word {
  id: string;
  segmentId: string;
  text: string;
  startTime: number; // seconds (float)
  endTime: number;
  isRemoved: boolean;
  probability?: number; // Whisper confidence score (0–1); absent for SRT imports
}
