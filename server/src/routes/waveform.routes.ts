import { Router, Request, Response } from 'express';
import { waveformService } from '../services/waveform.service';

const waveformRoutes = Router();

/** GET /api/clips/:clipId/waveform */
waveformRoutes.get('/:clipId/waveform', async (req: Request, res: Response) => {
  try {
    const data = await waveformService.compute(String(req.params.clipId));
    res.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (msg.includes('Clip not found')) {
      res.status(404).json({ error: msg });
    } else {
      res.status(500).json({ error: 'Failed to compute waveform' });
    }
  }
});

export default waveformRoutes;
