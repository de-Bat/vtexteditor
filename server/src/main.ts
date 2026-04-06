import express from 'express';
import cors from 'cors';
import { config } from './config';
import { ensureStorageDirs } from './utils/file.util';
import { mediaRoutes } from './routes/media.routes';
import { projectRoutes } from './routes/project.routes';
import { pluginRoutes } from './routes/plugin.routes';
import { clipRoutes } from './routes/clip.routes';
import { sseRoutes } from './routes/sse.routes';
import { exportRoutes } from './routes/export.routes';

const app = express();

app.use(cors({ origin: 'http://localhost:4200' }));
app.use(express.json());

// Ensure storage directories exist on startup
ensureStorageDirs();

// Routes
app.use('/api/media', mediaRoutes);
app.use('/api/project', projectRoutes);
app.use('/api/plugins', pluginRoutes);
app.use('/api/clips', clipRoutes);
app.use('/api/events', sseRoutes);
app.use('/api/export', exportRoutes);

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: err.message });
});

app.listen(config.port, () => {
  console.log(`VTextStudio server running on http://localhost:${config.port}`);
});

export default app;
