import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { scoreWallet } from './api/score.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

// ── PORTFOLIO ROUTES ──────────────────────────────────────────────────────────
app.get('/portfolio', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'portfolio.html'));
});

app.post('/api/portfolio', async (req, res) => {
  const { wallets } = req.body;
  if (!wallets || !Array.isArray(wallets) || wallets.length === 0) {
    return res.status(400).json({ error: 'wallets array is required' });
  }

  const results = await Promise.allSettled(wallets.map(w => scoreWallet(w)));

  const walletScores = results.map((r, i) => {
    if (r.status === 'fulfilled') return { wallet: wallets[i], ...r.value };
    return { wallet: wallets[i], error: r.reason?.message || 'Scoring failed' };
  });

  const successful = walletScores.filter(w => !w.error);

  let aggregate = 5;
  if (successful.length > 0) {
    let avg = successful.reduce((sum, w) => sum + w.score, 0) / successful.length;
    if (successful.some(w => w.score > 70)) avg += 5;
    aggregate = Math.min(Math.max(avg, 5), 98);
  }

  // Average privacy sub-scores across wallets that returned them
  const withPrivacy = successful.filter(w => w.privacy);
  let privacy = { total: '0.0', protocolUsage: '0.0', fundingSource: '50.0', opacity: '0.0' };
  if (withPrivacy.length > 0) {
    const avg = field =>
      (withPrivacy.reduce((s, w) => s + parseFloat(w.privacy[field]), 0) / withPrivacy.length).toFixed(1);
    privacy = {
      total:         avg('total'),
      protocolUsage: avg('protocolUsage'),
      fundingSource: avg('fundingSource'),
      opacity:       avg('opacity'),
    };
  }

  res.json({ wallets: walletScores, aggregate: aggregate.toFixed(1), privacy });
});

app.listen(PORT, () => {
  console.log(`Cleo running on http://localhost:${PORT}`);
});
