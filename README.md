# ONETOO Portal — Mozart Maximalist (Decade‑stable bundle)

This repository merges the **Maximalist**, **Omega**, and **Ultra‑Edge** portal lines into one **feature‑rich**, **readable**, and **auditable** portal that still fits the current ONETOO architecture.

Key ideas:
- **Bot‑first, human‑calm** UI (static `portal/`)
- Optional **Cloudflare Worker API** (`worker/portal-edge/`) to proxy / normalize data sources
- **Decade‑stable verification** via `/.well-known/index.json` + `/.well-known/sha256.json` (+ minisign signature)

## What’s inside

### UI (static)
`/portal/`
- Registry browser (entities + entity view)
- Search UI
- Status dashboard
- Docs / Audit / Artifacts / Federation
- **Notary** (file/text SHA‑256 receipts)
- **Merchant** (offer + receipt JSON generator)
- **AI Room** (local private workspace, ~12MB cap)

### Worker API (optional)
`/worker/portal-edge/`
- Backwards compatible routes:
  - `/portal/v1/*` (legacy)
- Convenience aliases:
  - `/api/health`
  - `/api/status`
  - `/api/entities`
  - `/api/entity/{id}`
  - `/api/search?q=...`
  - `/api/explain`
  - `/api/time`

### Well‑known signals
`/.well-known/`
- `index.json` (entry point)
- `ai-trust-hub.json`
- `llms.txt`
- `sha256.json` (generate) + `sha256.json.minisig` (sign)
- `minisign.pub` (publish your public key)
- `tfws/context/v1` (tiny context)

## Local dev (Git Bash)

### 1) Static portal
```bash
cd portal
python -m http.server 8788
# open http://127.0.0.1:8788/index.html
```

### 2) Worker API (optional)
```bash
cd worker/portal-edge
npm i
npx wrangler dev --port 8787
# open http://127.0.0.1:8787/api/health
```

Then set portal config (either via UI “cfg” badge or URL params):
- `portalApiBase=http://127.0.0.1:8787`

Example:
`http://127.0.0.1:8788/search.html?portalApiBase=http://127.0.0.1:8787`

## Generate the sha256 manifest (decade mode)
```bash
python3 scripts/gen_sha256_manifest.py
# optional signing (requires minisign)
bash scripts/sign_manifest.sh
```

## Deploy

- **Cloudflare Pages**: publish repo root (so `/.well-known` exists), with `/portal` as static UI.
- **Worker**: deploy `worker/portal-edge` separately (recommended).

See: `DEPLOY-CLOUDFLARE-PAGES.md`

## Notes

This is an experimental maximalist bundle. The “Notary” and “Merchant” tools generate **portable JSON artifacts** that you can publish and sign under your trust‑root for long‑term verification.
