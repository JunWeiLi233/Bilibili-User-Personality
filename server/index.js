/**
 * Hono API server — main bootstrap for the Bilibili User Personality backend.
 *
 * Starts on `http://127.0.0.1:{PORT}` (default 8787) and auto-spawns the Vite
 * dev server on port `{VITE_PORT}` (default 5191) unless `START_VITE=0`.
 *
 * Vite proxies `/api` requests to this Hono backend via its own proxy config,
 * so the frontend dev server and API backend appear on the same origin.
 *
 * Route mounts:
 * - `/api/bilibili`  — user analysis & video keyword search
 * - `/api/deepseek`  — AI dictionary training & comment analysis
 * - `/api/aicu`      — AICU scraper integration
 * - `/api/admin`     — human-in-the-loop dictionary review (auth required)
 * - `/api/health`    — liveness check
 *
 * @module server/index
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { spawn } from 'node:child_process';

import bilibili from './routes/bilibili.js';
import deepseek from './routes/deepseek.js';
import aicu from './routes/aicu.js';
import admin from './routes/admin.js';

const PORT = Number(process.env.PORT || 8787);
const VITE_PORT = Number(process.env.VITE_PORT || 5191);

if (!Number.isFinite(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`Invalid PORT: ${process.env.PORT}`);
  process.exit(1);
}

const app = new Hono();

// CORS enabled for all origins — the API is local-only (127.0.0.1)
app.use('*', cors());

// Global error handler — catches unhandled exceptions in route handlers
app.onError((err, c) => {
  console.error(err);
  return c.json({ ok: false, error: 'Internal server error' }, 500);
});

// Mount sub-routers
app.route('/api/bilibili', bilibili);
app.route('/api/deepseek', deepseek);
app.route('/api/aicu', aicu);
app.route('/api/admin', admin);
app.get('/api/health', (c) => c.json({ ok: true }));

// Start the Hono HTTP server (loopback only — not exposed to LAN)
const server = serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, () => {
  console.log(`API server listening on http://127.0.0.1:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});

// Auto-spawn Vite dev server (unless START_VITE=0)
// Vite proxies /api → this backend, so the frontend sees a single origin.
let vite = null;
if (process.env.START_VITE !== '0') {
  vite = spawn('npm', ['run', 'dev', '--', '--port', String(VITE_PORT)], {
    shell: true,
    stdio: 'inherit',
  });
  vite.on('error', (err) => {
    console.error('Failed to start Vite:', err.message);
  });
}

/**
 * Graceful shutdown handler. Kills the Vite child process (if running),
 * closes the HTTP server, and exits. Falls back to forced exit after 5 s.
 */
function shutdown() {
  if (vite) {
    vite.kill();
    vite = null;
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
