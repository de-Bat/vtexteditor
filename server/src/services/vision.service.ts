import { ChildProcess, spawn } from 'child_process';
import http from 'http';
import path from 'path';

const VISION_PORT = 3001;
const VISION_URL = `http://localhost:${VISION_PORT}`;

let pythonProcess: ChildProcess | null = null;

export const VisionService = {
  spawnPythonService(): void {
    const storageRoot = path.resolve(process.cwd(), '..', 'storage');

    const proc = spawn(
      'python',
      ['-m', 'uvicorn', 'main:app', '--port', String(VISION_PORT), '--host', '127.0.0.1'],
      {
        cwd: process.cwd().replace(/[\\/]server$/, '') + '/vision-service',
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        shell: true,
        env: { ...process.env, STORAGE_ROOT: storageRoot },
      }
    );

    proc.stdout?.on('data', (d) => process.stdout.write(`[vision] ${d}`));
    proc.stderr?.on('data', (d) => process.stderr.write(`[vision] ${d}`));
    proc.on('exit', (code) => console.warn(`[vision] Python process exited with code ${code}`));

    pythonProcess = proc;
    console.log(`[vision] Python service spawning on port ${VISION_PORT}`);
  },

  stopPythonService(): void {
    if (pythonProcess) {
      pythonProcess.kill();
      pythonProcess = null;
    }
  },

  async checkHealth(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(`${VISION_URL}/health`, { timeout: 3000 }, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  },

  getBaseUrl(): string {
    return VISION_URL;
  },
};
