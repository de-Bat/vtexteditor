import { Router, Request, Response } from 'express';
import { clipService } from '../services/clip.service';
import { settingsService } from '../services/settings.service';
import { VisionService } from '../services/vision.service';

const router = Router();

const SAFE_ID = /^[a-zA-Z0-9_\-]{1,64}$/;

router.post('/:clipId/suggest-cuts', async (req: Request, res: Response) => {
  const clipId = req.params['clipId'] as string;
  if (!SAFE_ID.test(clipId)) {
    res.status(400).json({ error: 'Invalid clipId' });
    return;
  }

  const clip = clipService.getById(clipId);
  if (!clip) {
    res.status(404).json({ error: 'Clip not found' });
    return;
  }

  type WordWithProbability = { probability?: number };

  const words = clip.segments
    .flatMap((seg) => seg.words)
    .filter((w) => !w.isRemoved)
    .map((w) => {
      const wp = w as typeof w & WordWithProbability;
      return {
        id: w.id,
        text: w.text,
        startTime: w.startTime,
        endTime: w.endTime,
        ...(wp.probability !== undefined ? { probability: wp.probability } : {}),
      };
    });

  const {
    silenceThresholdMs = 500,
    fillerLangs = ['en', 'he'],
    ollamaEnabled = true,
    ollamaModel = 'llama3:8b',
  } = req.body as {
    silenceThresholdMs?: number;
    fillerLangs?: string[];
    ollamaEnabled?: boolean;
    ollamaModel?: string;
  };

  const ollamaBaseUrl =
    settingsService.get('OLLAMA_BASE_URL') ?? 'http://localhost:11434';

  try {
    const upstream = await globalThis.fetch(
      `${VisionService.getBaseUrl()}/suggest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          words,
          silenceThresholdMs,
          fillerLangs,
          ollamaEnabled,
          ollamaModel,
          ollamaBaseUrl,
        }),
      }
    );
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch {
    res.status(502).json({ error: 'Vision service unavailable' });
  }
});

export default router;
