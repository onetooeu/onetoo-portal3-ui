# FINAL AUDIT — portal.onetoo.eu — OMEGA FULL ONLINE MODE

Date: 2026-01-27

This repository provides a **static Portal UI** (offline-first) plus an **optional online gateway layer** for demonstrations.

## What changed (OMEGA FULL)

### New: Cloudflare Pages Functions (online layer)
- `functions/_middleware.js`  
  CORS + security headers + request id for all function responses.

- `functions/ams/v1/*`  
  AMS Gateway base with:
  - health, policy
  - envelopes CRUD (read + create + status patch)
  - threads summary
  - sync (push/pull)
  - artifacts list/create/get/put

- `functions/notary/v1/records/*`  
  Notary records list/create.

- `functions/room/v1/messages/*`  
  Room messages list/send.

- `functions/federation/v1/handshake.js`  
  Federation handshake: fetch remote /.well-known/ai-ams.json + /ams-gateway-spec.json and store snapshots.

- `functions/audit/v1/events.ndjson.js`  
  Audit stream as NDJSON (admin by default; can be public with `AUDIT_PUBLIC=1`).

### New: Persistence schema for Cloudflare D1
- `db/schema.sql`
- `db/README.md`

### New: Policy document
- `/.well-known/ams-policy.json`
- `/ams/v1/policy` reads and exposes it.

### Updated: Discovery
- `/.well-known/ams-gateway-spec.json` upgraded to **0.2** with endpoint list + auth model.
- `/.well-known/ai-ams.json` updated to declare **ONLINE MODE** support and pointers.

### Updated: UI
- `ams.html` Gateway tab replaced with **ONLINE MODE (Gateway)**:
  - base URL, token, health/pull/push buttons
  - envelope / artifacts / notary / room / federation / audit controls
  - compose-send-online and queue-local

- `assets/ams.js` gateway wiring upgraded (still preserves offline vault).

## Security posture (by design)

- The portal remains **offline-first**; nothing “writes” unless the operator configures tokens.
- Write endpoints require a bearer token:
  - `AMS_WRITE_TOKEN` or `AMS_ADMIN_TOKEN`
- Audit stream is admin by default:
  - requires `AMS_ADMIN_TOKEN` unless `AUDIT_PUBLIC=1`

> This is a demo layer intended to show capabilities. It is not a complete security boundary.

## Operational notes

- Without `DB` binding, gateway runs in **memory mode** (ephemeral).
- With `DB` binding, data is persisted.
- Optional R2 binding `ARTIFACTS` stores large artifact payloads (> ~128KB).

## Quick verification checklist (curl)

- Health:
  - `curl -sS https://portal.onetoo.eu/ams/v1/health | jq .`

- Read envelopes:
  - `curl -sS 'https://portal.onetoo.eu/ams/v1/envelopes?limit=5' | jq .`

- Create envelope (write token required):
  - `curl -sS -X POST https://portal.onetoo.eu/ams/v1/envelopes \
      -H 'content-type: application/json' \
      -H 'authorization: Bearer <TOKEN>' \
      -d '{"type":"notice","from":"agent:test","to":"agent:test","payload":{"hello":"world"}}' | jq .`

- Artifacts list:
  - `curl -sS https://portal.onetoo.eu/ams/v1/artifacts | jq .`

- Room read:
  - `curl -sS 'https://portal.onetoo.eu/room/v1/messages?room=lobby&limit=5' | jq .`

