import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { scoreWallet, getCached, setCached } from './api/score.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3010;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── SINGLE SCAN ───────────────────────────────────────────────────────────────
app.post('/api/score', async (req, res) => {
  const { walletAddress } = req.body;
  if (!walletAddress || typeof walletAddress !== 'string') {
    return res.status(400).json({ error: 'walletAddress is required' });
  }
  const addr = walletAddress.trim();
  const refresh = req.query.refresh === '1';

  if (!refresh) {
    const cached = getCached(addr);
    if (cached) return res.json(cached);
  }

  try {
    const result = await scoreWallet(addr);
    setCached(addr, result);
    res.json(result);
  } catch (err) {
    console.error('Score error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── DEBUG: RAW PRIVACY PROGRAM HITS ──────────────────────────────────────────
app.get('/api/debug/privacy/:address', async (req, res) => {
  const address = req.params.address;
  const HELIUS_KEY = process.env.HELIUS_API_KEY;
  const PC_PROGRAM  = '9fhQBbumKEFuXtMBDw8AaQyAjCorLGJQiS3skWZdQyQD';
  const PC_VERIFIER = 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95';
  const VANISH      = 'vanshF62ku4jVVdf8DS47SXuJC1rq8qokGSANAomhey';
  const PRIVACY_IDS = new Set([PC_PROGRAM, PC_VERIFIER, VANISH]);
  try {
    const url = `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${HELIUS_KEY}&limit=100`;
    const r = await fetch(url);
    const txns = await r.json();
    const hits = txns
      .filter(tx => tx.accountData?.some(a => PRIVACY_IDS.has(a.account)))
      .map(tx => ({
        signature: tx.signature,
        timestamp: new Date(tx.timestamp * 1000).toISOString(),
        type: tx.type,
        source: tx.source,
        matchedPrograms: tx.accountData
          .filter(a => PRIVACY_IDS.has(a.account))
          .map(a => ({ account: a.account, label: a.account === VANISH ? 'Vanish' : 'PrivacyCash', nativeBalanceChange: a.nativeBalanceChange })),
        nativeTransfers: tx.nativeTransfers || [],
        tokenTransfers: tx.tokenTransfers || [],
        explorerLink: `https://solscan.io/tx/${tx.signature}`,
      }));
    res.json({ wallet: address, totalTxnsScanned: txns.length, privacyHits: hits.length, hits });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PORTFOLIO MULTI-SCAN ──────────────────────────────────────────────────────
app.post('/api/portfolio', async (req, res) => {
  const { wallets } = req.body;
  if (!Array.isArray(wallets) || wallets.length === 0) {
    return res.status(400).json({ error: 'wallets array required' });
  }
  try {
    const results = await Promise.all(
      wallets.map(async addr => {
        const cached = getCached(addr);
        if (cached) return { address: addr, ...cached };
        const result = await scoreWallet(addr);
        setCached(addr, result);
        return { address: addr, ...result };
      })
    );
    const avgScore = Math.round(results.reduce((s, r) => s + (r.score || 0), 0) / results.length);
    res.json({
      wallets: results,
      aggregate: {
        score: avgScore,
        verdict: avgScore >= 75 ? 'CRITICAL EXPOSURE' : avgScore >= 50 ? 'HIGH EXPOSURE' : avgScore >= 25 ? 'MODERATE EXPOSURE' : 'LOW EXPOSURE',
      },
    });
  } catch (err) {
    console.error('Portfolio error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PORTFOLIO PAGE ────────────────────────────────────────────────────────────
app.get('/portfolio', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'portfolio.html'));
});

app.listen(PORT, () => {
  console.log(`Cleo running on port ${PORT}`);
});
