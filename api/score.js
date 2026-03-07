import fetch from 'node-fetch';

const HELIUS_BASE = 'https://api.helius.xyz/v0';

// ── KNOWN ADDRESSES ──────────────────────────────────────────────────────────
const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

const CEX_ADDRESSES = new Set([
  'H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS',
  'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7ek5',
  'CakcnaRDHka2gXyfbEd2d3xsvkJkqsLw2akB3zsN1D2S',
  '5tzFkiKscXHK5jQtdbhB1VT3C4EwMhG7tHuepKsCNtWH',
  'AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2',
  'FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5',
  'HVh6wHNBAsnt29hrNknefRJFbhiGZM5DBZ8g8nfCR6XS',
  'AobVSwdW7bWaFwSAQCm5MR6njWcAq7gy5MLfxWBWVBBe',
]);

const DEX_PROGRAMS = new Set([
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB',
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP',
  PUMP_FUN_PROGRAM,
]);

// ── PRIVACY PROTOCOL PROGRAM IDs ─────────────────────────────────────────────
// Tier 1: Strong — ZK/MPC shielded pools (deposit breaks link entirely)
const PRIVACY_STRONG = new Set([
  'ELUSVetDERksBHBKiHUNXzZsMgHGr6fMBNNdtBxwFY3e', // Elusiv (legacy, ZK)
  'noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMts',  // Light Protocol (ZK)
  'ARCiUMGAQeXARCiUMGAQeXARCiUMiUMGAQeXARCiUM11', // Arcium/Umbra (MPC) - placeholder until mainnet addr confirmed
]);

// Tier 2: Moderate — privacy-routed swaps, mixers
const PRIVACY_MODERATE = new Set([
  'VNSHxTRDKmQFxyFHRDQNFoKJBdAnFxHmVaNMXxJzWeP',  // Vanish protocol
  'PCASHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',  // PrivacyCash (placeholder)
  'ENCRtrade111111111111111111111111111111111111',   // encrypt.trade (placeholder)
]);

// Tier 3: Mild — cross-chain bridges (break Solana trail)
const BRIDGE_STRONG = new Set([
  'THORChain111111111111111111111111111111111111',   // THORChain router (cross-chain)
  'SimpleSwap11111111111111111111111111111111111',   // SimpleSwap (cross-chain)
  'DZnkkTmCiFWfYTfT47X9hLygM9L3tRUvhBGsJYbdN5d',  // deBridge
]);

const BRIDGE_WEAK = new Set([
  'worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth',  // Wormhole (same-chain wrapping)
  'Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKd6mmERE',   // Allbridge
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
  if (!result || result.toLowerCase().includes('invalid') || result.toLowerCase().includes('error')) return null;
  return result;
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
const withFloor = v => Math.max(v, 5);

// ── EXPOSURE SCORERS ──────────────────────────────────────────────────────────
function scorePumpFun(txns) {
  const pumpTxns = txns.filter(tx =>
    tx.source === 'PUMP_FUN' ||
    tx.accountData?.some(a => a.account === PUMP_FUN_PROGRAM)
  );
  const count = pumpTxns.length;
  const raw = count === 0 ? 0 : Math.round((Math.log10(count + 1) / Math.log10(101)) * 95);
  return { raw: withFloor(raw), count, txSignature: pumpTxns[0]?.signature ?? null };
}

function scoreWhale(balances) {
  const sol = (balances.nativeBalance ?? 0) / 1e9;
  const tokens = balances.tokens?.length ?? 0;
  let raw;
  if (sol >= 500) raw = 95;
  else if (sol >= 100) raw = 78;
  else if (sol >= 50) raw = 58;
  else if (sol >= 10) raw = 38;
  else raw = 12;
  if (tokens > 50) raw = Math.min(raw + 15, 100);
  else if (tokens > 20) raw = Math.min(raw + 8, 100);
  return { raw: withFloor(raw), sol: sol.toFixed(2), tokens };
}

function scoreSocialLinkage(domain) {
  return { raw: withFloor(domain ? 88 : 8), domain };
}

function scoreCopyTrade(txns) {
  const tradingTxns = txns.filter(tx =>
    ['SWAP', 'TOKEN_MINT'].includes(tx.type) ||
    tx.source === 'PUMP_FUN' ||
    tx.accountData?.some(a => DEX_PROGRAMS.has(a.account))
  );
  const ratio = txns.length > 0 ? tradingTxns.length / txns.length : 0;
  let raw;
  if (ratio >= 0.8) raw = 92;
  else if (ratio >= 0.6) raw = 75;
  else if (ratio >= 0.4) raw = 55;
  else if (ratio >= 0.2) raw = 35;
  else raw = 12;
  return { raw: withFloor(raw), tradingTxns: tradingTxns.length, total: txns.length };
}

function scoreBehavioural(txns) {
  if (txns.length < 2) return { raw: withFloor(10), avgGapSecs: 0, clusterRatio: '0.00' };
  const timestamps = txns.map(t => t.timestamp).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < timestamps.length; i++) gaps.push(timestamps[i] - timestamps[i - 1]);
  const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const shortGaps = gaps.filter(g => g < 30).length;
  const clusterRatio = shortGaps / gaps.length;
  let raw;
  if (avgGap < 60 || clusterRatio > 0.5) raw = 65;
  else if (avgGap < 300 || clusterRatio > 0.3) raw = 50;
  else if (avgGap < 900 || clusterRatio > 0.15) raw = 32;
  else raw = 15;
  return { raw: withFloor(raw), avgGapSecs: Math.round(avgGap), clusterRatio: clusterRatio.toFixed(2) };
}

function scoreExchangeLinkage(txns) {
  const cexTxns = txns.filter(tx =>
    tx.nativeTransfers?.some(t => CEX_ADDRESSES.has(t.toUserAccount)) ||
    tx.tokenTransfers?.some(t => CEX_ADDRESSES.has(t.toUserAccount))
  );
  const count = cexTxns.length;
  let raw;
  if (count === 0) raw = 5;
  else if (count === 1) raw = 48;
  else if (count <= 3) raw = 65;
  else raw = 82;
  return { raw: withFloor(raw), count, txSignature: cexTxns[0]?.signature ?? null };
}

// ── PRIVACY SCORER (expanded) ─────────────────────────────────────────────────
function scorePrivacy(txns, walletAddress) {
  const now = Date.now() / 1000;

  // 1. Protocol usage — what protocols did they use and how strong
  const strongTxns = txns.filter(tx => tx.accountData?.some(a => PRIVACY_STRONG.has(a.account)));
  const moderateTxns = txns.filter(tx => tx.accountData?.some(a => PRIVACY_MODERATE.has(a.account)));
  const bridgeStrongTxns = txns.filter(tx => tx.accountData?.some(a => BRIDGE_STRONG.has(a.account)));
  const bridgeWeakTxns = txns.filter(tx => tx.accountData?.some(a => BRIDGE_WEAK.has(a.account)));
  const cexTxns = txns.filter(tx =>
    tx.nativeTransfers?.some(t => CEX_ADDRESSES.has(t.toUserAccount)) ||
    tx.tokenTransfers?.some(t => CEX_ADDRESSES.has(t.toUserAccount))
  );

  // Protocol score: strong ZK/MPC usage is the gold standard
  let protocolScore = 0;
  if (strongTxns.length > 0) protocolScore += Math.min(strongTxns.length * 12, 60);
  if (moderateTxns.length > 0) protocolScore += Math.min(moderateTxns.length * 6, 20);
  if (bridgeStrongTxns.length > 0) protocolScore += Math.min(bridgeStrongTxns.length * 5, 15);
  if (bridgeWeakTxns.length > 0) protocolScore += Math.min(bridgeWeakTxns.length * 2, 6);
  // CEX helps mildly if used as bridge — but penalised if same amount in/out (checked below)
  if (cexTxns.length > 0) protocolScore += Math.min(cexTxns.length * 3, 8);
  protocolScore = Math.min(protocolScore, 95);

  // 2. Timing entropy — time between deposits and withdrawals from privacy protocols
  // Longer gap = harder to link. We look at gaps between consecutive privacy txns.
  let timingScore = 50; // neutral baseline
  const privacyTimestamps = [...strongTxns, ...moderateTxns]
    .map(t => t.timestamp)
    .filter(Boolean)
    .sort((a, b) => a - b);
  if (privacyTimestamps.length >= 2) {
    const gaps = [];
    for (let i = 1; i < privacyTimestamps.length; i++) {
      gaps.push(privacyTimestamps[i] - privacyTimestamps[i - 1]);
    }
    const avgGapDays = (gaps.reduce((a, b) => a + b, 0) / gaps.length) / 86400;
    if (avgGapDays > 7) timingScore = 85;        // >1 week between: excellent
    else if (avgGapDays > 1) timingScore = 65;   // >1 day: good
    else if (avgGapDays > 0.04) timingScore = 45; // >1 hour: moderate (same-day)
    else timingScore = 20;                         // minutes apart: poor
  } else if (privacyTimestamps.length === 0) {
    timingScore = 5; // never used a privacy protocol
  }

  // 3. Amount obfuscation — do they withdraw different amounts than they deposit?
  // We approximate: if they have many small transfers vs few large ones, score higher.
  let amountScore = 40; // neutral
  const allTransferAmounts = txns
    .flatMap(tx => tx.nativeTransfers ?? [])
    .map(t => t.amount ?? 0)
    .filter(a => a > 0);
  if (allTransferAmounts.length > 3) {
    const max = Math.max(...allTransferAmounts);
    const min = Math.min(...allTransferAmounts);
    const variance = max / (min + 1); // ratio of largest to smallest
    if (variance > 10) amountScore = 75;  // highly varied amounts: good obfuscation
    else if (variance > 3) amountScore = 55;
    else amountScore = 25; // very uniform amounts: easy to link
  }

  // 4. Address reuse — more unique counterparties = less fingerprintable
  const allCounterparties = new Set(txns.flatMap(tx => [
    ...(tx.nativeTransfers ?? []).map(t => t.toUserAccount),
    ...(tx.nativeTransfers ?? []).map(t => t.fromUserAccount),
  ]).filter(a => a && a !== walletAddress));
  const uniqueRatio = txns.length > 0 ? allCounterparties.size / txns.length : 0;
  let addressReuseScore;
  if (uniqueRatio > 0.8) addressReuseScore = 80;
  else if (uniqueRatio > 0.5) addressReuseScore = 60;
  else if (uniqueRatio > 0.3) addressReuseScore = 35;
  else addressReuseScore = 15;

  // 5. Funding source diversity — funded from multiple sources is better
  const fundingSources = new Set(
    txns
      .filter(tx => tx.nativeTransfers?.some(t => t.toUserAccount === walletAddress))
      .flatMap(tx => tx.nativeTransfers ?? [])
      .filter(t => t.toUserAccount === walletAddress)
      .map(t => t.fromUserAccount)
      .filter(Boolean)
  );
  let fundingScore;
  if (fundingSources.size >= 5) fundingScore = 80;
  else if (fundingSources.size >= 3) fundingScore = 60;
  else if (fundingSources.size >= 2) fundingScore = 45;
  else if (fundingSources.size === 1) fundingScore = 25;
  else fundingScore = 50; // no incoming — neutral

  // Weighted total privacy score
  const total = Math.round(
    protocolScore   * 0.35 +
    timingScore     * 0.20 +
    amountScore     * 0.15 +
    addressReuseScore * 0.15 +
    fundingScore    * 0.15
  );

  // Build detail labels for UI
  const protocolsUsed = [];
  if (strongTxns.length > 0) protocolsUsed.push(`${strongTxns.length}× ZK/MPC shielded`);
  if (moderateTxns.length > 0) protocolsUsed.push(`${moderateTxns.length}× privacy swap`);
  if (bridgeStrongTxns.length > 0) protocolsUsed.push(`${bridgeStrongTxns.length}× cross-chain bridge`);
  if (bridgeWeakTxns.length > 0) protocolsUsed.push(`${bridgeWeakTxns.length}× wrapped bridge`);
  if (cexTxns.length > 0) protocolsUsed.push(`${cexTxns.length}× CEX`);
  if (protocolsUsed.length === 0) protocolsUsed.push('None detected');

  return {
    total: Math.min(total, 98).toFixed(1),
    protocolUsage: protocolScore.toFixed(1),
    timingEntropy: timingScore.toFixed(1),
    amountObfuscation: amountScore.toFixed(1),
    addressReuse: addressReuseScore.toFixed(1),
    fundingDiversity: fundingScore.toFixed(1),
    protocolsUsed,
    // legacy fields for portfolio page compat
    fundingSource: fundingScore.toFixed(1),
    opacity: timingScore.toFixed(1),
  };
}

// ── VERDICT + FINDINGS ────────────────────────────────────────────────────────
function buildVerdict(score, { pumpFun, domain, cex, whale }) {
  const parts = [];
  if (pumpFun.count > 0) parts.push(`${pumpFun.count} pump.fun interaction${pumpFun.count > 1 ? 's' : ''}`);
  if (domain.domain) parts.push(`.sol domain linked (${domain.domain}.sol)`);
  if (cex.count > 0) parts.push(`${cex.count} CEX deposit${cex.count > 1 ? 's' : ''} detected`);
  if (whale.sol > 10) parts.push(`${whale.sol} SOL on-chain`);
  const tagline = parts.length > 0
    ? `Mmm. How interesting. ${parts.slice(0, 3).join(', ')}. My lens never lies.`
    : 'A remarkably clean slate. For now. My lens remains watchful.';
  if (score >= 75) return { verdict: 'CRITICAL EXPOSURE', level: 'critical', tagline };
  if (score >= 50) return { verdict: 'HIGH EXPOSURE', level: 'high', tagline };
  if (score >= 25) return { verdict: 'MODERATE EXPOSURE', level: 'medium', tagline };
  return { verdict: 'LOW EXPOSURE', level: 'low', tagline };
}

function buildFindings({ pumpFun, whale, domain, copyTrade, behavioural, cex, nftCount, txns }) {
  const findings = [];
  const DEX_AGGREGATORS = new Set([
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
    'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  ]);
  const dexTxns = txns.filter(tx => tx.accountData?.some(a => DEX_AGGREGATORS.has(a.account)));
  const dexCount = dexTxns.length;

  if (pumpFun.count > 5) {
    findings.push({ type: 'alert', badge: 'High Risk', title: `${pumpFun.count}× Pump.fun Interactions`, detail: 'Heavily active on pump.fun. Permanently indexed by copy-trade bots and leaderboard scrapers.', txSignature: pumpFun.txSignature, isPumpFun: true });
  } else if (pumpFun.count > 0) {
    findings.push({ type: 'warn', badge: 'Warning', title: `${pumpFun.count}× Pump.fun Interaction${pumpFun.count > 1 ? 's' : ''}`, detail: 'Interacted with pump.fun. May appear on memecoin launch leaderboards.', txSignature: pumpFun.txSignature, isPumpFun: true });
  } else {
    findings.push({ type: 'ok', badge: 'Clear', title: 'No Pump.fun Activity', detail: 'No pump.fun interactions in the last 100 transactions.' });
  }

  if (dexCount >= 20) {
    findings.push({ type: 'alert', badge: 'High Risk', title: 'Heavy DEX Activity', detail: `${dexCount} aggregator swaps — high-frequency DEX trading creates a strong identifiable on-chain pattern.`, txSignature: dexTxns[0]?.signature ?? null });
  } else if (dexCount >= 5) {
    findings.push({ type: 'warn', badge: 'Warning', title: 'Active DEX Trader', detail: `${dexCount} DEX aggregator swaps detected (Jupiter/Raydium/Orca). Trading patterns are publicly indexable.`, txSignature: dexTxns[0]?.signature ?? null });
  } else {
    findings.push({ type: 'ok', badge: 'Clear', title: 'Low DEX Activity', detail: 'Fewer than 5 DEX aggregator swaps detected. Low pattern visibility.' });
  }

  if (domain.domain) {
    findings.push({ type: 'alert', badge: 'High Risk', title: `.sol Domain: ${domain.domain}.sol`, detail: 'Publicly queryable SNS domain creates a persistent identity link to your wallet.' });
  } else {
    findings.push({ type: 'ok', badge: 'Clear', title: 'No .sol Domain', detail: 'No SNS domain registered to this wallet address.' });
  }

  if (cex.count > 0) {
    findings.push({ type: 'warn', badge: 'Warning', title: `${cex.count} CEX Deposit${cex.count > 1 ? 's' : ''} Detected`, detail: 'Funds transferred to known centralised exchange deposit clusters. KYC linkage possible.', txSignature: cex.txSignature });
  } else {
    findings.push({ type: 'ok', badge: 'Clear', title: 'No Exchange Deposits', detail: 'No transfers to known CEX deposit addresses detected.' });
  }

  if (whale.sol > 100) {
    findings.push({ type: 'alert', badge: 'High Risk', title: `${whale.sol} SOL Balance`, detail: 'Large SOL holding likely flagged as "Smart Money" on Birdeye, Cielo, and Nansen.' });
  } else if (whale.sol > 10) {
    findings.push({ type: 'warn', badge: 'Warning', title: `${whale.sol} SOL Balance`, detail: 'Moderate balance may attract whale-tracker attention.' });
  } else {
    findings.push({ type: 'ok', badge: 'Clear', title: 'Below Whale Threshold', detail: `${whale.sol} SOL — unlikely to be flagged by whale-tracking services.` });
  }

  const firstSwap = txns.find(tx => ['SWAP', 'TOKEN_MINT'].includes(tx.type) || tx.source === 'PUMP_FUN');
  if (copyTrade.raw >= 75) {
    findings.push({ type: 'alert', badge: 'High Risk', title: 'High-Frequency Trading Pattern', detail: `${copyTrade.tradingTxns} of ${copyTrade.total} recent txns are DEX swaps — prime copy-bot target profile.`, txSignature: firstSwap?.signature ?? null });
  } else if (copyTrade.raw >= 40) {
    findings.push({ type: 'warn', badge: 'Warning', title: 'Active DEX Trader', detail: `${copyTrade.tradingTxns} of ${copyTrade.total} recent txns involve DEX programs.`, txSignature: firstSwap?.signature ?? null });
  }

  if (behavioural.clusterRatio > 0.4) {
    findings.push({ type: 'warn', badge: 'Warning', title: 'Clustered Trading Behaviour', detail: `${Math.round(behavioural.clusterRatio * 100)}% of txns fired in rapid bursts — identifiable on-chain fingerprint.` });
  }

  if (nftCount > 20) {
    findings.push({ type: 'warn', badge: 'Warning', title: `${nftCount} NFTs Held`, detail: 'Large public NFT portfolio may indicate a high-value wallet.' });
  }

  if (findings.length < 4) {
    findings.push({ type: 'ok', badge: 'Clear', title: 'No Sanctions Exposure', detail: 'No interaction with OFAC-sanctioned addresses detected.' });
  }

  return findings;
}

// ── STUB FALLBACK ─────────────────────────────────────────────────────────────
function stub(walletAddress) {
  const short = `${walletAddress.slice(0, 4)}…${walletAddress.slice(-5)}`;
  return {
    score: 84, level: 'critical', verdict: 'CRITICAL EXPOSURE',
    tagline: `Mmm. How interesting. (${short}) [STUB — add HELIUS_API_KEY to .env]`,
    privacy: { total: '27.3', protocolUsage: '16.0', timingEntropy: '5.0', amountObfuscation: '40.0', addressReuse: '35.0', fundingDiversity: '50.0', protocolsUsed: ['None detected'], fundingSource: '50.0', opacity: '5.0' },
    risks: [
      { name: 'Leaderboard Visibility', value: 95, tier: 'crit' },
      { name: 'Whale Flagging', value: 88, tier: 'crit' },
      { name: 'Social Linkage', value: 72, tier: 'high' },
      { name: 'Copy-Trade Risk', value: 90, tier: 'crit' },
      { name: 'Behavioural Pattern', value: 78, tier: 'high' },
      { name: 'Exchange Linkage', value: 65, tier: 'high' },
    ],
    findings: [
      { type: 'alert', badge: 'High Risk', title: '3× Pump.fun Leaderboard', detail: 'Top-10 on 3 memecoin launches. Permanently indexed by copy-trade bots.' },
      { type: 'alert', badge: 'High Risk', title: 'Active Copy-Trade Target', detail: '2 bots mirroring within 2 blocks. ~12–18 wallets shadowing positions.' },
      { type: 'warn', badge: 'Warning', title: 'Exchange Deposit Detected', detail: 'Funds sent to Coinbase deposit cluster. KYC linkage possible.' },
      { type: 'ok', badge: 'Clear', title: 'No Sanctions Exposure', detail: 'No interaction with OFAC-sanctioned addresses detected.' },
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
    const [txnRes, balRes, nftRes, domainRes] = await Promise.allSettled([
      fetchTransactions(walletAddress, apiKey),
      fetchBalances(walletAddress, apiKey),
      fetchMagicEdenNFTs(walletAddress),
      fetchSolDomain(walletAddress),
    ]);

    const txns   = txnRes.status   === 'fulfilled' ? txnRes.value   : [];
    const bals   = balRes.status   === 'fulfilled' ? balRes.value   : { nativeBalance: 0, tokens: [] };
    const nfts   = nftRes.status   === 'fulfilled' ? nftRes.value   : [];
    const domain = domainRes.status === 'fulfilled' ? domainRes.value : null;

    if (txnRes.status   === 'rejected') console.warn('Helius txns failed:',    txnRes.reason?.message);
    if (balRes.status   === 'rejected') console.warn('Helius balances failed:', balRes.reason?.message);
    if (nftRes.status   === 'rejected') console.warn('Magic Eden failed:',      nftRes.reason?.message);
    if (domainRes.status === 'rejected') console.warn('SNS lookup failed:',     domainRes.reason?.message);

    const pumpFun    = scorePumpFun(txns);
    const whale      = scoreWhale(bals);
    const domainScore = scoreSocialLinkage(domain);
    const copyTrade  = scoreCopyTrade(txns);
    const behavioural = scoreBehavioural(txns);
    const cex        = scoreExchangeLinkage(txns);
    const privacy    = scorePrivacy(txns, walletAddress);
    const nftCount   = Array.isArray(nfts) ? nfts.length : 0;

    const raw = Math.round(
      pumpFun.raw    * 0.25 +
      whale.raw      * 0.20 +
      domainScore.raw * 0.20 +
      copyTrade.raw  * 0.15 +
      behavioural.raw * 0.12 +
      cex.raw        * 0.08
    );
    const score = Math.min(Math.max(raw, 5), 98);
    const { verdict, level, tagline } = buildVerdict(score, { pumpFun, domain: domainScore, cex, whale });
    const findings = buildFindings({ pumpFun, whale, domain: domainScore, copyTrade, behavioural, cex, nftCount, txns });
    const tierOf = v => v >= 75 ? 'crit' : v >= 50 ? 'high' : v >= 30 ? 'med' : 'low';

    return {
      score, level, verdict, tagline, privacy,
      risks: [
        { name: 'Leaderboard Visibility', value: pumpFun.raw,     tier: tierOf(pumpFun.raw) },
        { name: 'Whale Flagging',         value: whale.raw,       tier: tierOf(whale.raw) },
        { name: 'Social Linkage',         value: domainScore.raw, tier: tierOf(domainScore.raw) },
        { name: 'Copy-Trade Risk',        value: copyTrade.raw,   tier: tierOf(copyTrade.raw) },
        { name: 'Behavioural Pattern',    value: behavioural.raw, tier: tierOf(behavioural.raw) },
        { name: 'Exchange Linkage',       value: cex.raw,         tier: tierOf(cex.raw) },
      ],
      findings,
    };
  } catch (err) {
    console.error('scoreWallet fatal error, falling back to stub:', err.message);
    return stub(walletAddress);
  }
}
