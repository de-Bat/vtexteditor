import { Router, Request, Response } from 'express';

export const exportRoutes = Router();

/** POST /api/export — start export job (stub, implemented in Phase 10) */
exportRoutes.post('/', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Export not yet implemented' });
});

/** GET /api/export/:id/status */
exportRoutes.get('/:id/status', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Export not yet implemented' });
});

/** GET /api/export/:id/download */
exportRoutes.get('/:id/download', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Export not yet implemented' });
});
