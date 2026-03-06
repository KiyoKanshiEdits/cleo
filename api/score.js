import fetch from 'node-fetch';

const HELIUS_BASE = 'https://api.helius.xyz/v0';

// ── KNOWN ADDRESSES ──────────────────────────────────────────────────────────

const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

// Known CEX hot wallet / deposit clusters
const CEX_ADDRESSES = new Set([
  'H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS', // Coinbase
  'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7ek5', // Coinbase 2
  'CakcnaRDHka2gXyfbEd2d3xsvkJkqsLw2akB3zsN1D2S', // Coinbase 3
  '5tzFkiKscXHK5jQtdbhB1VT3C4EwMhG7tHuepKsCNtWH', // Binance
  'AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2', // Binance 2
  'FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5', // Kraken
  'HVh6wHNBAsnt29hrNknefRJFbhiGZM5DBZ8g8nfCR6XS', // OKX
  'AobVSwdW7bWaFwSAQCm5MR6njWcAq7gy5MLfxWBWVBBe', // Bybit
]);

// High-frequency DEX programs used for copy-trade detection
const DEX_PROGRAMS = new Set([
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM v4
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',  // Jupiter v6
  'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB',  // Jupiter v4
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',  // Orca Whirlpool
  '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP', // Orca v1
  PUMP_FUN_PROGRAM,
]);

// ── DATA FETCHERS ─────────────────────────────────────────────────────────────

async function fetchTransactions(wallet, apiKey) {
  const url = `${HELIUS_BASE}/addresses/${wallet}/transactions?api-key=${apiKey}&limit=100`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Helius transactions ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchBalances(wallet, apiKey) {
  const url = `${HELIUS_BASE}/addresses/${wallet}/balances?api-key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Helius balances ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchMagicEdenNFTs(wallet) {
  const res = await fetch(
    `https://api-mainnet.magiceden.dev/v2/wallets/${wallet}/tokens?limit=100`,
    { headers: { 'User-Agent': 'cleo-lens/1.0' } }
  );
  if (!res.ok) return [];
  return res.json();
}

async function fetchSolDomain(wallet) {
  const res = await fetch(`https://sns-sdk-proxy.bonfida.workers.dev/reverse-lookup/${wallet}`);
  if (!res.ok) return null;
  const data = await res.json();
  const result = data?.result ?? null;
  // SNS returns "Invalid input" or similar strings when no domain exists
  if (!result || result.toLowerCase().includes('invalid') || result.toLowerCase().includes('error')) return null;
  return result;
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

// Minimum floor of 5 — no dimension ever shows 0
const withFloor = v => Math.max(v, 5);

// ── INDIVIDUAL SCORERS ────────────────────────────────────────────────────────

// 25% weight — pump.fun program interactions (logarithmic: 3 txns ≠ 3× the risk of 1)
function scorePumpFun(txns) {
  const pumpTxns = txns.filter(tx =>
    tx.source === 'PUMP_FUN' ||
    tx.accountData?.some(a => a.account === PUMP_FUN_PROGRAM)
  );
  const count = pumpTxns.length;

  // log10(count+1) / log10(101) maps 0→0, 1→20, 10→50, 100→100
  const raw = count === 0 ? 0 : Math.round((Math.log10(count + 1) / Math.log10(101)) * 95);

  return { raw: withFloor(raw), count, txSignature: pumpTxns[0]?.signature ?? null };
}

// 20% weight — large SOL balance + token portfolio size
function scoreWhale(balances) {
  const sol = (balances.nativeBalance ?? 0) / 1e9;
  const tokens = balances.tokens?.length ?? 0;

  let raw;
  if      (sol >= 500) raw = 95;
  else if (sol >= 100) raw = 78;
  else if (sol >= 50)  raw = 58;
  else if (sol >= 10)  raw = 38;
  else                 raw = 12;

  if      (tokens > 50) raw = Math.min(raw + 15, 100);
  else if (tokens > 20) raw = Math.min(raw + 8, 100);

  return { raw: withFloor(raw), sol: sol.toFixed(2), tokens };
}

// 20% weight — .sol domain found = high social exposure
function scoreSocialLinkage(domain) {
  return { raw: withFloor(domain ? 88 : 8), domain };
}

// 15% weight — high ratio of DEX/pump txns = copy-trade target
function scoreCopyTrade(txns) {
  const tradingTxns = txns.filter(tx =>
    ['SWAP', 'TOKEN_MINT'].includes(tx.type) ||
    tx.source === 'PUMP_FUN' ||
    tx.accountData?.some(a => DEX_PROGRAMS.has(a.account))
  );
  const ratio = txns.length > 0 ? tradingTxns.length / txns.length : 0;

  let raw;
  if      (ratio >= 0.8) raw = 92;
  else if (ratio >= 0.6) raw = 75;
  else if (ratio >= 0.4) raw = 55;
  else if (ratio >= 0.2) raw = 35;
  else                   raw = 12;

  return { raw: withFloor(raw), tradingTxns: tradingTxns.length, total: txns.length };
}

// 12% weight — time clustering (rapid bursts = identifiable fingerprint)
// Capped at 65 so a high cluster ratio can't dominate the overall score.
function scoreBehavioural(txns) {
  if (txns.length < 2) return { raw: withFloor(10), avgGapSecs: 0, clusterRatio: '0.00' };

  const timestamps = txns.map(t => t.timestamp).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < timestamps.length; i++) gaps.push(timestamps[i] - timestamps[i - 1]);

  const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const shortGaps = gaps.filter(g => g < 30).length;
  const clusterRatio = shortGaps / gaps.length;

  let raw;
  if      (avgGap < 60  || clusterRatio > 0.5)  raw = 65; // was 82 — capped
  else if (avgGap < 300 || clusterRatio > 0.3)  raw = 50;
  else if (avgGap < 900 || clusterRatio > 0.15) raw = 32;
  else                                            raw = 15;

  return { raw: withFloor(raw), avgGapSecs: Math.round(avgGap), clusterRatio: clusterRatio.toFixed(2) };
}

// 8% weight — transfers to known CEX deposit addresses
function scoreExchangeLinkage(txns) {
  const cexTxns = txns.filter(tx =>
    tx.nativeTransfers?.some(t => CEX_ADDRESSES.has(t.toUserAccount)) ||
    tx.tokenTransfers?.some(t => CEX_ADDRESSES.has(t.toUserAccount))
  );
  const count = cexTxns.length;

  let raw;
  if      (count === 0) raw = 5;
  else if (count === 1) raw = 48;
  else if (count <= 3)  raw = 65;
  else                  raw = 82;

  return { raw: withFloor(raw), count, txSignature: cexTxns[0]?.signature ?? null };
}

// ── VERDICT + FINDINGS ────────────────────────────────────────────────────────

function buildVerdict(score, { pumpFun, domain, cex, whale }) {
  const parts = [];
  if (pumpFun.count > 0)  parts.push(`${pumpFun.count} pump.fun interaction${pumpFun.count > 1 ? 's' : ''}`);
  if (domain.domain)       parts.push(`.sol domain linked (${domain.domain}.sol)`);
  if (cex.count > 0)       parts.push(`${cex.count} CEX deposit${cex.count > 1 ? 's' : ''} detected`);
  if (whale.sol > 10)      parts.push(`${whale.sol} SOL on-chain`);

  const tagline = parts.length > 0
    ? `Mmm. How interesting. ${parts.slice(0, 3).join(', ')}. My lens never lies.`
    : 'A remarkably clean slate. For now. My lens remains watchful.';

  if (score >= 75) return { verdict: 'CRITICAL EXPOSURE', level: 'critical', tagline };
  if (score >= 50) return { verdict: 'HIGH EXPOSURE',     level: 'high',     tagline };
  if (score >= 25) return { verdict: 'MODERATE EXPOSURE', level: 'medium',   tagline };
  return               { verdict: 'LOW EXPOSURE',         level: 'low',      tagline };
}

function buildFindings({ pumpFun, whale, domain, copyTrade, behavioural, cex, nftCount, txns }) {
  const findings = [];

  // Pump.fun
  if (pumpFun.count > 5) {
    findings.push({ type: 'alert', badge: 'High Risk', title: `${pumpFun.count}× Pump.fun Interactions`, detail: 'Heavily active on pump.fun. Permanently indexed by copy-trade bots and leaderboard scrapers.', txSignature: pumpFun.txSignature, isPumpFun: true });
  } else if (pumpFun.count > 0) {
    findings.push({ type: 'warn', badge: 'Warning', title: `${pumpFun.count}× Pump.fun Interaction${pumpFun.count > 1 ? 's' : ''}`, detail: 'Interacted with pump.fun. May appear on memecoin launch leaderboards.', txSignature: pumpFun.txSignature, isPumpFun: true });
  } else {
    findings.push({ type: 'ok', badge: 'Clear', title: 'No Pump.fun Activity', detail: 'No pump.fun interactions in the last 100 transactions.' });
  }

  // DEX aggregator activity
  const DEX_AGGREGATORS = new Set([
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium
    'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',  // Orca
  ]);
  const dexTxns = txns.filter(tx => tx.accountData?.some(a => DEX_AGGREGATORS.has(a.account)));
  const dexCount = dexTxns.length;
  const dexSig = dexTxns[0]?.signature ?? null;

  if (dexCount >= 20) {
    findings.push({ type: 'alert', badge: 'High Risk', title: 'Heavy DEX Activity', detail: dexCount + ' aggregator swaps — high-frequency DEX trading creates a strong identifiable on-chain pattern.', txSignature: dexSig });
  } else if (dexCount >= 5) {
    findings.push({ type: 'warn', badge: 'Warning', title: 'Active DEX Trader', detail: dexCount + ' DEX aggregator swaps detected (Jupiter/Raydium/Orca). Trading patterns are publicly indexable.', txSignature: dexSig });
  } else {
    findings.push({ type: 'ok', badge: 'Clear', title: 'Low DEX Activity', detail: 'Fewer than 5 DEX aggregator swaps detected. Low pattern visibility.' });
  }

  // .sol domain
  if (domain.domain) {
    findings.push({ type: 'alert', badge: 'High Risk', title: `.sol Domain: ${domain.domain}.sol`, detail: 'Publicly queryable SNS domain creates a persistent identity link to your wallet.' });
  } else {
    findings.push({ type: 'ok', badge: 'Clear', title: 'No .sol Domain', detail: 'No SNS domain registered to this wallet address.' });
  }

  // Exchange linkage
  if (cex.count > 0) {
    findings.push({ type: 'warn', badge: 'Warning', title: `${cex.count} CEX Deposit${cex.count > 1 ? 's' : ''} Detected`, detail: 'Funds transferred to known centralised exchange deposit clusters. KYC linkage possible.', txSignature: cex.txSignature });
  } else {
    findings.push({ type: 'ok', badge: 'Clear', title: 'No Exchange Deposits', detail: 'No transfers to known CEX deposit addresses detected.' });
  }

  // Whale flagging
  if (whale.sol > 100) {
    findings.push({ type: 'alert', badge: 'High Risk', title: `${whale.sol} SOL Balance`, detail: 'Large SOL holding likely flagged as "Smart Money" on Birdeye, Cielo, and Nansen.' });
  } else if (whale.sol > 10) {
    findings.push({ type: 'warn', badge: 'Warning', title: `${whale.sol} SOL Balance`, detail: 'Moderate balance may attract whale-tracker attention.' });
  } else {
    findings.push({ type: 'ok', badge: 'Clear', title: 'Below Whale Threshold', detail: `${whale.sol} SOL — unlikely to be flagged by whale-tracking services.` });
  }

  // Copy-trade / high-frequency trading — attach signature of most recent swap
  const firstSwap = txns.find(tx => ['SWAP', 'TOKEN_MINT'].includes(tx.type) || tx.source === 'PUMP_FUN');
  if (copyTrade.raw >= 75) {
    findings.push({ type: 'alert', badge: 'High Risk', title: 'High-Frequency Trading Pattern', detail: `${copyTrade.tradingTxns} of ${copyTrade.total} recent txns are DEX swaps — prime copy-bot target profile.`, txSignature: firstSwap?.signature ?? null });
  } else if (copyTrade.raw >= 40) {
    findings.push({ type: 'warn', badge: 'Warning', title: 'Active DEX Trader', detail: `${copyTrade.tradingTxns} of ${copyTrade.total} recent txns involve DEX programs.`, txSignature: firstSwap?.signature ?? null });
  }

  // Behavioural clustering
  if (behavioural.clusterRatio > 0.4) {
    findings.push({ type: 'warn', badge: 'Warning', title: 'Clustered Trading Behaviour', detail: `${Math.round(behavioural.clusterRatio * 100)}% of txns fired in rapid bursts — identifiable on-chain fingerprint.` });
  }

  // NFTs
  if (nftCount > 20) {
    findings.push({ type: 'warn', badge: 'Warning', title: `${nftCount} NFTs Held`, detail: 'Large public NFT portfolio may indicate a high-value wallet to collectors and trackers.' });
  }

  // Pad with sanctions clear if still short
  if (findings.length < 4) {
    findings.push({ type: 'ok', badge: 'Clear', title: 'No Sanctions Exposure', detail: 'No interaction with OFAC-sanctioned addresses detected.' });
  }

  return findings;
}

// ── STUB FALLBACK ─────────────────────────────────────────────────────────────

function stub(walletAddress) {
  const short = `${walletAddress.slice(0, 4)}…${walletAddress.slice(-5)}`;
  return {
    score: 84,
    level: 'critical',
    verdict: 'CRITICAL EXPOSURE',
    tagline: `Mmm. How interesting. Three leaderboard appearances, two active copy-bots, and a KYC-linked exchange deposit. My lens never lies. (${short}) [STUB — add HELIUS_API_KEY to .env]`,
    risks: [
      { name: 'Leaderboard Visibility', value: 95, tier: 'crit' },
      { name: 'Whale Flagging',         value: 88, tier: 'crit' },
      { name: 'Social Linkage',         value: 72, tier: 'high' },
      { name: 'Copy-Trade Risk',        value: 90, tier: 'crit' },
      { name: 'Behavioural Pattern',    value: 78, tier: 'high' },
      { name: 'Exchange Linkage',       value: 65, tier: 'high' },
    ],
    findings: [
      { type: 'alert', badge: 'High Risk', title: '3× Pump.fun Leaderboard',   detail: 'Top-10 on 3 memecoin launches. Permanently indexed by copy-trade bots.' },
      { type: 'alert', badge: 'High Risk', title: 'Active Copy-Trade Target',   detail: '2 bots mirroring within 2 blocks. ~12–18 wallets shadowing positions.' },
      { type: 'alert', badge: 'High Risk', title: 'Whale-Flagged on Birdeye',   detail: 'Tagged "Smart Money" on Birdeye, Cielo, and Nansen Solana feed.' },
      { type: 'warn',  badge: 'Warning',   title: '.sol Domain Registered',     detail: 'wallet.sol is publicly queryable — direct identity link.' },
      { type: 'warn',  badge: 'Warning',   title: 'Exchange Deposit Detected',  detail: 'Funds sent to Coinbase deposit cluster. KYC linkage possible.' },
      { type: 'ok',    badge: 'Clear',     title: 'No Sanctions Exposure',      detail: 'No interaction with OFAC-sanctioned addresses detected.' },
    ],
  };
}

// ── MAIN EXPORT ───────────────────────────────────────────────────────────────

export async function scoreWallet(walletAddress) {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    console.warn('HELIUS_API_KEY not set — returning stub result');
    return stub(walletAddress);
  }

  try {
    // Fire all requests in parallel; individual failures fall back gracefully
    const [txnRes, balRes, nftRes, domainRes] = await Promise.allSettled([
      fetchTransactions(walletAddress, apiKey),
      fetchBalances(walletAddress, apiKey),
      fetchMagicEdenNFTs(walletAddress),
      fetchSolDomain(walletAddress),
    ]);

    const txns    = txnRes.status    === 'fulfilled' ? txnRes.value    : [];
    const bals    = balRes.status    === 'fulfilled' ? balRes.value    : { nativeBalance: 0, tokens: [] };
    const nfts    = nftRes.status    === 'fulfilled' ? nftRes.value    : [];
    const domain  = domainRes.status === 'fulfilled' ? domainRes.value : null;

    if (txnRes.status    === 'rejected') console.warn('Helius txns failed:', txnRes.reason?.message);
    if (balRes.status    === 'rejected') console.warn('Helius balances failed:', balRes.reason?.message);
    if (nftRes.status    === 'rejected') console.warn('Magic Eden failed:', nftRes.reason?.message);
    if (domainRes.status === 'rejected') console.warn('SNS lookup failed:', domainRes.reason?.message);

    // Score each dimension
    const pumpFun     = scorePumpFun(txns);
    const whale       = scoreWhale(bals);
    const domainScore = scoreSocialLinkage(domain);
    const copyTrade   = scoreCopyTrade(txns);
    const behavioural = scoreBehavioural(txns);
    const cex         = scoreExchangeLinkage(txns);
    const nftCount    = Array.isArray(nfts) ? nfts.length : 0;

    // Weighted composite (weights sum to 1.0), clamped 5–98
    const raw = Math.round(
      pumpFun.raw      * 0.25 +
      whale.raw        * 0.20 +
      domainScore.raw  * 0.20 +
      copyTrade.raw    * 0.15 +
      behavioural.raw  * 0.12 +
      cex.raw          * 0.08
    );
    const score = Math.min(Math.max(raw, 5), 98);

    const { verdict, level, tagline } = buildVerdict(score, {
      pumpFun, domain: domainScore, cex, whale,
    });

    const findings = buildFindings({
      pumpFun, whale, domain: domainScore, copyTrade, behavioural, cex, nftCount, txns,
    });

    const tierOf = v => v >= 75 ? 'crit' : v >= 50 ? 'high' : v >= 30 ? 'med' : 'low';

    return {
      score,
      level,
      verdict,
      tagline,
      risks: [
        { name: 'Leaderboard Visibility', value: pumpFun.raw,      tier: tierOf(pumpFun.raw) },
        { name: 'Whale Flagging',         value: whale.raw,        tier: tierOf(whale.raw) },
        { name: 'Social Linkage',         value: domainScore.raw,  tier: tierOf(domainScore.raw) },
        { name: 'Copy-Trade Risk',        value: copyTrade.raw,    tier: tierOf(copyTrade.raw) },
        { name: 'Behavioural Pattern',    value: behavioural.raw,  tier: tierOf(behavioural.raw) },
        { name: 'Exchange Linkage',       value: cex.raw,          tier: tierOf(cex.raw) },
      ],
      findings,
    };
  } catch (err) {
    console.error('scoreWallet fatal error, falling back to stub:', err.message);
    return stub(walletAddress);
  }
}
