# Cleo · Lens Score

On-chain exposure intelligence for Solana wallets. Paste a wallet address, get a scored breakdown of how visible and trackable it is — leaderboard appearances, whale flags, .sol domains, CEX linkage, copy-trade risk, and behavioural fingerprints.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `HELIUS_API_KEY` | Yes | Helius RPC API key — [helius.dev](https://helius.dev) |
| `BIRDEYE_API_KEY` | No | Reserved for future Birdeye integration |
| `PORT` | No | HTTP port (default: `3010`) |

## Running Locally

```bash
# Install dependencies
npm install

# Add your API key
echo "HELIUS_API_KEY=your_key_here" >> .env

# Start the server
npm start

# Or with auto-reload during development
npm run dev
```

Open `http://localhost:3010` in your browser.

To force a fresh scan (bypass the 6-hour cache):
```
POST /api/score?refresh=1
```

## API

**POST** `/api/score`

Request:
```json
{ "walletAddress": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" }
```

Response:
```json
{
  "score": 28,
  "level": "medium",
  "verdict": "MODERATE EXPOSURE",
  "tagline": "...",
  "cache": false,
  "risks": [{ "name": "...", "value": 53, "tier": "high" }],
  "findings": [{ "type": "warn", "badge": "Warning", "title": "...", "detail": "..." }]
}
```

`cache: true` means the result was served from the in-memory cache (6-hour TTL).

## Deploying to Railway

1. Push this repo to GitHub
2. Create a new Railway project → Deploy from GitHub repo
3. Add `HELIUS_API_KEY` in Railway's environment variables panel
4. Railway auto-detects `railway.json` and starts `node server.js`
