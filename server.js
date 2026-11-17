import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { syncHiveBlockchainData, syncHiveRpcData, syncStatus, loadReputationsBackup, saveReputationsBackup, syncMissingReputations } from './blockchainSync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// Apply security headers before API and static responses.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com",
    "font-src 'self' https://cdnjs.cloudflare.com https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https://wsrv.nl https://images.hive.blog",
    "connect-src 'self' https://api.hive.blog https://api.openhive.network https://api.deathwing.me https://hive-api.arcange.eu https://rpc.mahdiyari.info",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '));
  next();
});

app.use(express.json({ limit: '1mb' }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// API endpoint to get current sync status
app.get('/api/blockchain-status', (req, res) => {
  const dataPath = path.join(__dirname, 'data.json');
  let fileStats = null;
  if (fs.existsSync(dataPath)) {
    const stat = fs.statSync(dataPath);
    fileStats = {
      sizeBytes: stat.size,
      sizeMB: (stat.size / (1024 * 1024)).toFixed(2),
      modifiedAt: stat.mtime.toISOString(),
    };
  }

  res.json({
    status: 'ok',
    sync: syncStatus,
    file: fileStats,
  });
});

// API endpoint to trigger live blockchain sync from Hive (hafsql)
app.all(['/api/sync-blockchain', '/api/sync'], async (req, res) => {
  const hours = Number(req.query.hours ?? req.body?.hours ?? 168);
  const rawLimit = req.query.limit ?? req.body?.limit;
  const limit = rawLimit == null ? null : Number(rawLimit);
  if (!Number.isSafeInteger(hours) || hours < 1 ||
      (limit !== null && (!Number.isSafeInteger(limit) || limit < 1))) {
    return res.status(400).json({ success: false, error: 'Hours and limit must be positive integers' });
  }

  try {
    const result = await syncHiveBlockchainData({ hours, limit });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to sync with the Hive blockchain via HAFSQL',
    });
  }
});

// API endpoint to trigger live blockchain sync from Hive via RPC (Sem HAFSQL)
app.all(['/api/sync-rpc', '/api/sync-blockchain-rpc'], async (req, res) => {
  const limit = parseInt(req.query.limit || req.body?.limit || '20', 10);

  try {
    const result = await syncHiveRpcData({ limit });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to sync with the Hive blockchain via RPC nodes',
    });
  }
});

// Explicit route for data.json with correct mime type
app.get('/data.json', (req, res) => {
  const dataPath = path.join(__dirname, 'data.json');
  if (fs.existsSync(dataPath)) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.sendFile(dataPath);
  } else {
    res.status(404).send('data.json not found');
  }
});

// Explicit route for blacklist.json
app.get('/blacklist.json', (req, res) => {
  const blacklistPath = path.join(__dirname, 'blacklist.json');
  if (fs.existsSync(blacklistPath)) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.sendFile(blacklistPath);
  } else {
    res.json([]);
  }
});

// Explicit routes for reputations.json backup
app.get(['/reputations.json', '/api/reputations'], (req, res) => {
  const data = loadReputationsBackup();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(data);
});

// Endpoint to push newly resolved reputations to disk backup
app.post('/api/reputations', (req, res) => {
  const newReps = req.body?.reputations;
  if (!newReps || typeof newReps !== 'object') {
    return res.status(400).json({ success: false, error: 'The "reputations" object is required' });
  }
  const updated = saveReputationsBackup(newReps);
  res.json({ success: true, count: updated.count, lastUpdated: updated.lastUpdated });
});

// Endpoint to trigger missing reputations resolution on server
app.post('/api/sync-reputations', async (req, res) => {
  const limit = parseInt(req.body?.limit || req.query?.limit || '100', 10);
  try {
    const result = await syncMissingReputations({ limit });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Serve only the optimized Vite build. Source files and project data stay private.
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath, { index: false }));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  app.get('*', (req, res) => {
    res.status(503).type('text/plain').send('Frontend is not built. Run npm run dev or npm run build.');
  });
}

app.listen(PORT, HOST, () => {
  console.log(`Hive Moderation Dashboard server running on http://${HOST}:${PORT}`);

  // Auto-enrich reputations backup on startup (non-blocking)
  setTimeout(async () => {
    try {
      console.log('[AUTO-REP] Initializing background reputation sync for missing authors...');
      const res = await syncMissingReputations({ limit: 150 });
      console.log(`[AUTO-REP] Resolved ${res.newlyFetched || 0} reputations, total cached: ${res.totalCached || 0}`);
    } catch (e) {
      console.warn('[AUTO-REP] Non-critical reputation prefetch notice:', e.message);
    }
  }, 3000);

  // Schedule auto-sync every 60 minutes
  setInterval(async () => {
    try {
      console.log('[AUTO-SYNC] Running periodic sync from Hive blockchain...');
      await syncHiveBlockchainData();
      await syncMissingReputations({ limit: 100 });
    } catch (err) {
      console.error('[AUTO-SYNC] Periodic sync error:', err.message);
    }
  }, 60 * 60 * 1000);
});

