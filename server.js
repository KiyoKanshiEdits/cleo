import 'dotenv/config';
import express from 'express';
import { scoreWallet } from './api/score.js';

const app = express();
const PORT = process.env.PORT || 3010;

// ── IN-MEMORY CACHE ───────────────────────────────────────────────────────────
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const cache = new Map(); // wallet → { result, cachedAt }

function getCached(wallet) {
  const entry = cache.get(wallet);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    cache.delete(wallet);
    return null;
  }
  return entry.result;
}

function setCached(wallet, result) {
  cache.set(wallet, { result, cachedAt: Date.now() });
}

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static('public'));

// ── ROUTES ────────────────────────────────────────────────────────────────────
app.post('/api/score', async (req, res) => {
  const { walletAddress } = req.body;
  if (!walletAddress) {
    return res.status(400).json({ error: 'walletAddress is required' });
  }

  const forceRefresh = req.query.refresh === '1';

  if (!forceRefresh) {
    const cached = getCached(walletAddress);
    if (cached) {
      console.log(`[cache HIT]  ${walletAddress.slice(0, 8)}…`);
      return res.json({ ...cached, cache: true });
    }
  }

  console.log(`[cache MISS] ${walletAddress.slice(0, 8)}… — fetching live`);

  try {
    const result = await scoreWallet(walletAddress);
    setCached(walletAddress, result);
    res.json({ ...result, cache: false });
  } catch (err) {
    console.error('Scoring error:', err);
    res.status(500).json({ error: 'Scoring failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Cleo running on http://localhost:${PORT}`);
});
