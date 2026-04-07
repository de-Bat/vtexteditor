import express from 'express';
import cors from 'cors';
import { config } from './config';
import { ensureStorageDirs } from './utils/file.util';
import { mediaRoutes } from './routes/media.routes';
import { projectRoutes } from './routes/project.routes';
import { projectsRoutes } from './routes/projects.routes';
import { pluginRoutes } from './routes/plugin.routes';
import { clipRoutes } from './routes/clip.routes';
import { sseRoutes } from './routes/sse.routes';
import { exportRoutes } from './routes/export.routes';

const app = express();

app.use(cors({ origin: ['http://localhost:4200', 'http://localhost:8080', 'http://127.0.0.1:8080'] }));
app.use(express.json());

// Ensure storage directories exist on startup
ensureStorageDirs();

// Routes
app.use('/api/media', mediaRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/project', projectRoutes);
app.use('/api/plugins', pluginRoutes);
app.use('/api/clips', clipRoutes);
app.use('/api/events', sseRoutes);
app.use('/api/export', exportRoutes);

// Global error handler
app.use((err: Error & { code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[ERROR]', err.message);
  // Multer validation errors should be 400, not 500
  const clientErrorCodes = ['LIMIT_FILE_SIZE', 'LIMIT_UNEXPECTED_FILE', 'LIMIT_PART_COUNT', 'LIMIT_FIELD_KEY', 'LIMIT_FIELD_VALUE', 'LIMIT_FIELD_COUNT', 'LIMIT_FILE_COUNT'];
  const status = err.code && clientErrorCodes.includes(err.code) ? 400 : 500;
  res.status(status).json({ error: err.message });
});

app.listen(config.port, () => {
  console.log(`VTextStudio server running on http://localhost:${config.port}`);
});

export default app;
