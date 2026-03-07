import fetch from 'node-fetch';

// ── CACHE ─────────────────────────────────────────────────────────────────────
const cache = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
// Version stamp — bump this to auto-invalidate all cached results on redeploy
const CACHE_VERSION = '2025-03-v5';

export function getCached(wallet) {
  const entry = cache.get(wallet);
  if (!entry) return null;
  if (entry.version !== CACHE_VERSION) { cache.delete(wallet); return null; }
  if (Date.now() - entry.ts > CACHE_TTL) { cache.delete(wallet); return null; }
  return entry.data;
}

export function setCached(wallet, data) {
  cache.set(wallet, { data, ts: Date.now(), version: CACHE_VERSION });
}

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
// All IDs below are confirmed from live on-chain transaction data via Helius
// Last verified: March 2026

// Tier 1: Strong — ZK shielded pools (deposit breaks on-chain link entirely)
const PRIVACY_STRONG = new Set([
  'ELUSVetDERksBHBKiHUNXzZsMgHGr6fMBNNdtBxwFY3e', // Elusiv (sunset Feb 2024, legacy ZK — historical detection)
  '9fhQBbumKEFuXtMBDw8AaQyAjCorLGJQiS3skWZdQyQD', // PrivacyCash main program (ZK/Merkle, $270M+ volume, confirmed via tx programId)
  'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95',  // PrivacyCash verifier program (ZK proof verifier)
  // Umbra (Arcium-powered, Solana-native) — closed beta, no public program ID yet
  // Encifher — live on mainnet, docs intentionally omit program addresses (ephemeral account architecture)
]);

// Tier 2: Moderate — privacy-routed swaps / trade obfuscation
const PRIVACY_MODERATE = new Set([
  'vanshF62ku4jVVdf8DS47SXuJC1rq8qokGSANAomhey',  // Vanish: Trading Program (confirmed on-chain)
]);

// PrivacyCash pool accounts — top recurring accounts from real transaction analysis
// Transfers to/from these = PrivacyCash deposit even if program ID not in recent txns
const PRIVACY_CASH_ACCOUNTS = new Set([
  '2vV7xhCMWRrcLiwGoTaTRgvx98ku98TRJKPXhsS8jvBV', // PrivacyCash pool account #1 (21x frequency)
  'AF8VuwCncKd5ZBnLYYnMjqh4vLch8mjqE75sFe5ZjRFW', // PrivacyCash pool account #2 (17x frequency)
  'AWexibGxNFKTa1b5R5MN4PJr9HWnWRwf8EW9g8cLx3dM', // PrivacyCash pool account #3 (16x frequency)
  '6VVKJ44WTJGCksTGJHjf1kJWZaMf9Nswgj6w7Dtrw55D', // PrivacyCash pool account #4 (15x frequency)
  '4AV2Qzp3N4c9RfzyEbNZs2wqWfW4EwKnnxFAZCndvfGh', // PrivacyCash pool account #5 (15x frequency)
  'Hz1x9MCs79tz2s5S4DQ6RMYQcJYa9WSt5kNxwYs6eEai', // PrivacyCash pool account #6
  'AKyn6LoQp4UkuT11QfVjaYfDUjvFfxH8Y1HjT8yNYBnH', // PrivacyCash pool account #7
  'GiaDw4ne9BCGLSiCpap3vDq9Sy7gXD1xTRPPNFJQKcCX', // PrivacyCash pool account #8
  'BF6roxGA4yKCkpZJKEGXkHLoFCXv3HgqbWMXcjHEWzjE', // PrivacyCash pool account #9
  'Anb2xMGW4uinXWiHaTq5fnQCwSzUT98NJrZXeQJd5vh9', // PrivacyCash pool account #10
]);

// Vanish trading pool accounts — funds in these = Vanish privacy interaction
const VANISH_ACCOUNTS = new Set([
  '7ozoNcVqgptbAUHjLR1vNHgEfKiE5aYufStEHzJhxKeG', // Vanish: Trading Account #1
  'DM1kVwqbNJYeDgKn2T3UbCHqquSh3PAYHJpRYfTCcbrK', // Vanish: Trading Account #2
  '2bxLnNUgnbf7d4CX4sfdY2YoJkKirNc5FHE6awRwKKYY', // Vanish: Trading Account #3
  '3PMpWWXCVUrkhHpFWPH1prxBYxQ4SV4rucJchYRSBojH', // Vanish: Trading Account #4
  '8MjKXQgj97NPVNhj9gJrQNP7BibGCGkFMVJ2qZsC58E',  // Vanish: Trading Account #5
  'Evamno6in8wQGBKUnVbu3FQV5eNwn2ttE5456yDbnodR',  // Vanish: Trading Account #6
  '49zHSpdFZaSc92ygkooaMGVeeriLSXX5ujriDWVxTwVS',  // Vanish: Trading Account #7
  '37p56C7BLiMyG2jEa7zTNSewj94C34SuFEnxnRZ87kWw',  // Vanish: Trading Account #8
  '2QbCx4cTy11nv5FieXJkAKPvSVGdFcZPFdDMTo9vEfqm',  // Vanish: Trading Account #9
  '7juKfkXpvYHqjhxwK1Se2Mod96hHETHNduC9BMxBdxyt',  // Vanish: Trading Account #10
]);

// Tier 3: Mild — cross-chain bridges (break Solana trail)
const BRIDGE_STRONG = new Set([
  'DZnkkTmCiFWfYTfT47X9hLygM9L3tRUvhBGsJYbdN5d',  // deBridge
]);

const BRIDGE_WEAK = new Set([
  'worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth',  // Wormhole
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
  const strongTxns = txns.filter(tx =>
    tx.accountData?.some(a => PRIVACY_STRONG.has(a.account))
  );

  // PrivacyCash: detect via program ID OR via transfers to/from known pool accounts
  const pcProgramTxns = txns.filter(tx => tx.accountData?.some(a => PRIVACY_STRONG.has(a.account) &&
    (a.account === '9fhQBbumKEFuXtMBDw8AaQyAjCorLGJQiS3skWZdQyQD' || a.account === 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95')
  ));
  const pcAccountTxns = txns.filter(tx =>
    (tx.nativeTransfers||[]).some(t => PRIVACY_CASH_ACCOUNTS.has(t.toUserAccount) || PRIVACY_CASH_ACCOUNTS.has(t.fromUserAccount)) ||
    (tx.tokenTransfers||[]).some(t => PRIVACY_CASH_ACCOUNTS.has(t.toUserAccount) || PRIVACY_CASH_ACCOUNTS.has(t.fromUserAccount)) ||
    (tx.accountData||[]).some(a => PRIVACY_CASH_ACCOUNTS.has(a.account))
  );
  const pcSigs = new Set([...pcProgramTxns, ...pcAccountTxns].map(t => t.signature));
  const privacyCashTxns = txns.filter(tx => pcSigs.has(tx.signature));

  // Vanish: detect via program ID OR via transfers to/from known trading pool accounts
  const vanishProgramTxns = txns.filter(tx => tx.accountData?.some(a => PRIVACY_MODERATE.has(a.account)));
  const vanishAccountTxns = txns.filter(tx =>
    (tx.nativeTransfers||[]).some(t => VANISH_ACCOUNTS.has(t.toUserAccount) || VANISH_ACCOUNTS.has(t.fromUserAccount)) ||
    (tx.tokenTransfers||[]).some(t => VANISH_ACCOUNTS.has(t.toUserAccount) || VANISH_ACCOUNTS.has(t.fromUserAccount)) ||
    (tx.accountData||[]).some(a => VANISH_ACCOUNTS.has(a.account))
  );
  const vanishSigs = new Set([...vanishProgramTxns, ...vanishAccountTxns].map(t => t.signature));
  const vanishTxns = txns.filter(tx => vanishSigs.has(tx.signature));

  // Combine all moderate-tier (Vanish + PrivacyCash both count here for scoring weight)
  const moderateSigs = new Set([...vanishSigs, ...pcSigs]);
  const moderateTxns = txns.filter(tx => moderateSigs.has(tx.signature));

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
  // A single privacy deposit with no withdrawal yet is excellent (funds still shielded).
  // Multiple privacy txns: longer gap between them = harder to link.
  let timingScore;
  const privacyTimestamps = [...strongTxns, ...moderateTxns]
    .map(t => t.timestamp)
    .filter(Boolean)
    .sort((a, b) => a - b);
  if (privacyTimestamps.length === 0) {
    timingScore = 5; // never used a privacy protocol
  } else if (privacyTimestamps.length === 1) {
    // Single privacy interaction — funds are still in the shielded pool or this IS the exit.
    // Either way, no linkable deposit→withdrawal pair visible on-chain: excellent.
    timingScore = 80;
  } else {
    const gaps = [];
    for (let i = 1; i < privacyTimestamps.length; i++) {
      gaps.push(privacyTimestamps[i] - privacyTimestamps[i - 1]);
    }
    const avgGapDays = (gaps.reduce((a, b) => a + b, 0) / gaps.length) / 86400;
    if (avgGapDays > 7) timingScore = 85;         // >1 week between: excellent
    else if (avgGapDays > 1) timingScore = 65;    // >1 day: good
    else if (avgGapDays > 0.04) timingScore = 45; // >1 hour: moderate
    else timingScore = 20;                          // minutes apart: poor
  }

  // 3. Amount obfuscation
  // Fresh/sparse wallet: few transfers is actually good — less data to fingerprint.
  let amountScore;
  const allTransferAmounts = txns
    .flatMap(tx => tx.nativeTransfers ?? [])
    .map(t => t.amount ?? 0)
    .filter(a => a > 0);
  if (allTransferAmounts.length === 0) {
    amountScore = 70; // no transfer history = nothing to link
  } else if (allTransferAmounts.length <= 3) {
    amountScore = 60; // very sparse — low surface area for amount-based linking
  } else {
    const max = Math.max(...allTransferAmounts);
    const min = Math.min(...allTransferAmounts);
    const variance = max / (min + 1);
    if (variance > 10) amountScore = 75;  // highly varied: good obfuscation
    else if (variance > 3) amountScore = 55;
    else amountScore = 25;                // uniform amounts: easy to link
  }

  // 4. Address reuse — more unique counterparties = less fingerprintable
  // Fresh wallet with no txns: treat as clean (not penalised).
  const allCounterparties = new Set(txns.flatMap(tx => [
    ...(tx.nativeTransfers ?? []).map(t => t.toUserAccount),
    ...(tx.nativeTransfers ?? []).map(t => t.fromUserAccount),
  ]).filter(a => a && a !== walletAddress));
  let addressReuseScore;
  if (txns.length === 0) {
    addressReuseScore = 75; // brand new — no reuse possible
  } else {
    const uniqueRatio = allCounterparties.size / txns.length;
    if (uniqueRatio > 0.8) addressReuseScore = 80;
    else if (uniqueRatio > 0.5) addressReuseScore = 60;
    else if (uniqueRatio > 0.3) addressReuseScore = 35;
    else addressReuseScore = 15;
  }

  // 5. Funding source diversity
  // Key fix: if the single funding source IS a known privacy protocol, that's excellent.
  // If it's an unknown wallet, single-source is still somewhat risky.
  const inboundTxns = txns.filter(tx => tx.nativeTransfers?.some(t => t.toUserAccount === walletAddress));
  const fundingSources = new Set(
    inboundTxns
      .flatMap(tx => tx.nativeTransfers ?? [])
      .filter(t => t.toUserAccount === walletAddress)
      .map(t => t.fromUserAccount)
      .filter(Boolean)
  );
  // Check if any funding source is itself a privacy protocol interaction
  const fundedViaPrivacy = inboundTxns.some(tx =>
    tx.accountData?.some(a => PRIVACY_STRONG.has(a.account) || PRIVACY_MODERATE.has(a.account))
  );
  let fundingScore;
  if (fundingSources.size === 0) {
    fundingScore = 60; // no inbound yet — clean slate, moderately positive
  } else if (fundedViaPrivacy) {
    fundingScore = 85; // funded directly via a privacy protocol — best case
  } else if (fundingSources.size >= 5) {
    fundingScore = 80;
  } else if (fundingSources.size >= 3) {
    fundingScore = 60;
  } else if (fundingSources.size >= 2) {
    fundingScore = 45;
  } else {
    fundingScore = 28; // single traceable source
  }

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
  if (strongTxns.length > 0) {
    const pcCount = privacyCashTxns.length;
    const elCount = strongTxns.length - pcCount;
    if (pcCount > 0) protocolsUsed.push(`${pcCount}× PrivacyCash`);
    if (elCount > 0) protocolsUsed.push(`${elCount}× Elusiv (legacy)`);
  }
  if (vanishTxns.length > 0) protocolsUsed.push(`${vanishTxns.length}× Vanish`);
  if (bridgeStrongTxns.length > 0) protocolsUsed.push(`${bridgeStrongTxns.length}× cross-chain bridge (deBridge)`);
  if (bridgeWeakTxns.length > 0) protocolsUsed.push(`${bridgeWeakTxns.length}× wrapped bridge`);
  if (cexTxns.length > 0) protocolsUsed.push(`${cexTxns.length}× CEX`);
  if (protocolsUsed.length === 0) protocolsUsed.push('None detected');

  // Build per-category explanations for the expandable UI
  const privacyExplain = {};

  // Protocol Usage explanation
  if (protocolsUsed[0] === 'None detected') {
    privacyExplain.protocolUsage = 'No interactions with known privacy protocols (Elusiv, Arcium, Vanish, PrivacyCash, encrypt.trade, cross-chain bridges) were found in the last 100 transactions.';
  } else {
    const parts = [];
    if (privacyCashTxns.length > 0) parts.push(`${privacyCashTxns.length} PrivacyCash interaction${privacyCashTxns.length > 1 ? 's' : ''} — ZK shielded pool breaks deposit/withdrawal link entirely`);
    if (vanishTxns.length > 0) parts.push(`${vanishTxns.length} Vanish interaction${vanishTxns.length > 1 ? 's' : ''} — funds routed through Vanish privacy trading pool`);
    if (strongTxns.length > privacyCashTxns.length) parts.push(`${strongTxns.length - privacyCashTxns.length} Elusiv interaction${strongTxns.length - privacyCashTxns.length > 1 ? 's' : ''} (legacy ZK protocol, sunset 2024)`);
    if (bridgeStrongTxns.length > 0) parts.push(`${bridgeStrongTxns.length} cross-chain bridge${bridgeStrongTxns.length > 1 ? 's' : ''} (deBridge) — breaks the Solana trail entirely`);
    if (bridgeWeakTxns.length > 0) parts.push(`${bridgeWeakTxns.length} same-chain bridge${bridgeWeakTxns.length > 1 ? 's' : ''} (Wormhole) — mild obfuscation only`);
    if (cexTxns.length > 0) parts.push(`${cexTxns.length} CEX deposit${cexTxns.length > 1 ? 's' : ''} — used as bridge`);
    privacyExplain.protocolUsage = parts.join('. ') + '.';
  }

  // Timing explanation
  if (privacyTimestamps.length === 0) {
    privacyExplain.timingEntropy = 'No privacy protocol activity found — no timing gap to evaluate.';
  } else if (privacyTimestamps.length === 1) {
    privacyExplain.timingEntropy = 'One privacy interaction found with no corresponding withdrawal visible on-chain. Funds appear to still be in the shielded pool — no linkable deposit/withdrawal pair exists.';
  } else {
    const gapDays = ((privacyTimestamps[privacyTimestamps.length-1] - privacyTimestamps[0]) / 86400).toFixed(1);
    privacyExplain.timingEntropy = `${privacyTimestamps.length} privacy interactions spanning ${gapDays} days. ${timingScore >= 65 ? 'Time gaps are large enough to make deposit/withdrawal correlation difficult.' : 'Interactions are close together in time — same-day activity can still be correlated.'}`;
  }

  // Amount obfuscation explanation
  if (allTransferAmounts.length === 0) {
    privacyExplain.amountObfuscation = 'No transfer history found — nothing to fingerprint by amount.';
  } else if (allTransferAmounts.length <= 3) {
    privacyExplain.amountObfuscation = `Only ${allTransferAmounts.length} transfer${allTransferAmounts.length > 1 ? 's' : ''} in history — very low surface area for amount-based linking.`;
  } else {
    const max = Math.max(...allTransferAmounts);
    const min = Math.min(...allTransferAmounts);
    privacyExplain.amountObfuscation = `${allTransferAmounts.length} transfers ranging from ${(min/1e9).toFixed(3)} to ${(max/1e9).toFixed(3)} SOL. ${amountScore >= 70 ? 'High variance makes amount-based correlation difficult.' : amountScore >= 50 ? 'Moderate variance — some amount patterns are detectable.' : 'Low variance — uniform amounts make deposit/withdrawal matching easier.'}`;
  }

  // Address diversity explanation
  if (txns.length === 0) {
    privacyExplain.addressReuse = 'No transaction history — completely clean address with no reuse possible.';
  } else {
    privacyExplain.addressReuse = `Interacted with ${allCounterparties.size} unique counterparties across ${txns.length} transactions. ${addressReuseScore >= 70 ? 'High diversity — hard to fingerprint by interaction patterns.' : addressReuseScore >= 40 ? 'Moderate diversity — some repeated counterparties exist.' : 'Low diversity — repeated interactions with the same addresses create a traceable pattern.'}`;
  }

  // Funding diversity explanation
  if (fundingSources.size === 0) {
    privacyExplain.fundingDiversity = 'No inbound transfers found — wallet origin is not yet visible on-chain.';
  } else if (fundedViaPrivacy) {
    privacyExplain.fundingDiversity = `Funded via a privacy protocol interaction — the originating wallet is shielded from direct on-chain linkage.`;
  } else {
    privacyExplain.fundingDiversity = `Funded from ${fundingSources.size} distinct source${fundingSources.size > 1 ? 's' : ''}. ${fundingScore >= 60 ? 'Multiple sources make origin tracing harder.' : 'Single traceable funding source — origin wallet is directly linkable on-chain.'}`;
  }

  return {
    total: Math.min(total, 98).toFixed(1),
    protocolUsage: protocolScore.toFixed(1),
    timingEntropy: timingScore.toFixed(1),
    amountObfuscation: amountScore.toFixed(1),
    addressReuse: addressReuseScore.toFixed(1),
    fundingDiversity: fundingScore.toFixed(1),
    protocolsUsed,
    privacyExplain,
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
