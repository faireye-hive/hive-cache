import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { syncHiveBlockchainData, syncHiveRpcData, syncStatus, loadReputationsBackup, saveReputationsBackup, syncMissingReputations } from './blockchainSync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

app.use(express.json());

// Serve static assets from project root
app.use(express.static(__dirname));

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
  const hours = parseInt(req.query.hours || req.body?.hours || '24', 10);
  const limit = req.query.limit || req.body?.limit ? parseInt(req.query.limit || req.body?.limit, 10) : null;

  try {
    const result = await syncHiveBlockchainData({ hours, limit });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || 'Falha ao sincronizar com a blockchain Hive via HAFSQL',
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
      error: error.message || 'Falha ao sincronizar com a blockchain Hive via nós RPC',
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
    return res.status(400).json({ success: false, error: 'Objeto "reputations" não fornecido' });
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

// Fallback for HTML routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

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
      await syncHiveBlockchainData({ hours: 24 });
      await syncMissingReputations({ limit: 100 });
    } catch (err) {
      console.error('[AUTO-SYNC] Periodic sync error:', err.message);
    }
  }, 60 * 60 * 1000);
});

