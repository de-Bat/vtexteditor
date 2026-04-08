import { Router } from 'express';
import { settingsService } from '../services/settings.service';

export const settingsRoutes = Router();

/** GET /api/settings — return all persisted app settings (secrets masked) */
settingsRoutes.get('/', (_req, res) => {
  res.json(settingsService.getRedacted());
});

/** PUT /api/settings — merge updates into persisted settings (secrets masked in response) */
settingsRoutes.put('/', (req, res) => {
  const body = req.body as Record<string, unknown>;
  const updates: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) {
    if (typeof v === 'string') updates[k] = v;
  }
  settingsService.set(updates);
  res.json({ ok: true, settings: settingsService.getRedacted() });
});
