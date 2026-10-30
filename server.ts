import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { apiRouter } from './server/api.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';
  const port = 3000;

  // Global Middlewares
  app.use(express.json());

  // Mount API Router
  app.use('/api', apiRouter);

  if (!isProd) {
    // Dynamically import Vite to avoid loading it in production environment if not needed
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });

    // Use Vite's connect instance as middleware
    app.use(vite.middlewares);

    // Serve index.html with Vite transforms for development
    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      try {
        let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    // Serve production static assets
    app.use(express.static(path.resolve(__dirname, 'dist')));

    // All other requests serve the React frontend index.html
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(port, () => {
    console.log(`Server running in ${isProd ? 'production' : 'development'} mode on http://localhost:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
