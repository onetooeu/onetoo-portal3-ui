# ONETOO Portal — Omega Edition Notes (maximalist)

This repo elevates the portal from a landing page to an **auditable, read-only trust browser** with:
- Registry browsing + entity detail
- Deterministic search + explain
- Federated discovery (multi-source aggregation)
- Audit dashboard (quick health + artifact availability checks)
- Artifact resolver (expected `.well-known/*` URLs)

## What is intentionally **NOT** included
- Any write endpoints (no approvals, no overrides)
- Any ML or personalization
- Any user tracking

## Portal Edge API
See `/worker/portal-edge/src/index.ts` routes:
- `GET /openapi.json`
- `GET /portal/v1/accepted`
- `GET /portal/v1/entity/:id`
- `GET /portal/v1/search`
- `GET /portal/v1/explain`
- `GET /portal/v1/status`
- `GET /portal/v1/artifacts?url=...`
- `GET /portal/v1/probe?url=...`
- `GET /portal/v1/federated/search?q=...&sources=...`

## Operator checklist
1. Deploy portal static assets (Pages) to `portal.onetoo.eu`.
2. Deploy portal-edge worker (Wrangler) and route it (recommended: `api.portal.onetoo.eu/*` or same origin).
3. In portal config, set `portalApiBase` to the worker base.

## Next (Omega → Sigma)
- Add `entity/{id}/history` (trust-root changelog feed)
- Add `decision-trace` and `incident` viewers
- Add multi-language content + i18n JSON packs
