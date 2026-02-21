import express from 'express';
import { createServer as createViteServer } from 'vite';
import app from './api/index.ts';

const PORT = 3000;

// Vite Middleware (Must be last, only for local dev)
if (process.env.NODE_ENV !== 'production') {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
