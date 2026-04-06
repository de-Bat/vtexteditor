import { Router } from 'express';
import { sseService } from '../services/sse.service';

export const sseRoutes = Router();

sseRoutes.get('/', (req, res) => {
  sseService.handleConnection(req, res);
});
