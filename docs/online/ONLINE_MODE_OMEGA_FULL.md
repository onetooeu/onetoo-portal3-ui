# ONLINE MODE — OMEGA FULL (portal.onetoo.eu)

This repo ships an **offline‑first UI** plus an **optional online gateway layer** implemented as **Cloudflare Pages Functions**.

The online layer supports:

- AMS envelopes (read + write)
- Sync (push/pull)
- Artifacts (read + write, optional R2 for large payloads)
- Notary records (read + write)
- Room messages (read + write)
- Federation handshake (read + write)
- Audit log (NDJSON; admin unless public flag is set)
- Deterministic policy doc (read)

> Experimental: This is a demo system to **show capabilities**, not a final security model.

---

## 1) Cloudflare bindings

### D1 (recommended)
Create a D1 database, then bind to Pages as:

- **Binding name:** `DB`

Apply the schema in `db/schema.sql`.

### R2 (optional)
If you want large artifacts stored as objects:

- **Binding name:** `ARTIFACTS`

Artifacts smaller than ~128KB are stored inline.

---

## 2) Environment variables

Set these in your Cloudflare Pages project:

### Required for write endpoints
- `AMS_WRITE_TOKEN` — Bearer token required for:
  - POST/PATCH /ams/v1/envelopes
  - POST /ams/v1/sync (push)
  - POST/PUT /ams/v1/artifacts
  - POST /notary/v1/records
  - POST /room/v1/messages
  - POST /federation/v1/handshake

### Optional
- `AMS_ADMIN_TOKEN` — token for admin-only endpoints
- `AUDIT_PUBLIC=1` — **demo only**: expose audit stream publicly
- `AMS_CORS_ORIGIN` — restrict CORS to a single origin (default "*")
- `FED_ALLOWLIST` — comma-separated hostnames allowed for federation handshake
- `AMS_ED25519_PKCS8_B64` + `AMS_ED25519_SPKI_B64` — attach ed25519 proof objects (optional)
- `AMS_HMAC_SECRET` — attach hmac-sha256 proof objects (fallback)

---

## 3) Endpoints (summary)

### AMS gateway (base: `/ams/v1`)
- `GET  /ams/v1/health`
- `GET  /ams/v1/policy`
- `GET  /ams/v1/envelopes`
- `POST /ams/v1/envelopes` (auth)
- `GET  /ams/v1/envelopes/{id}`
- `PATCH /ams/v1/envelopes/{id}` (auth)
- `GET  /ams/v1/threads`
- `POST /ams/v1/sync` (push auth; pull public)
- `GET  /ams/v1/artifacts`
- `POST /ams/v1/artifacts` (auth)
- `GET  /ams/v1/artifacts/{key}?payload=1`
- `PUT  /ams/v1/artifacts/{key}` (auth)

### Other
- `GET|POST /notary/v1/records` (POST auth)
- `GET|POST /room/v1/messages?room=lobby` (POST auth)
- `GET|POST /federation/v1/handshake` (POST auth)
- `GET /audit/v1/events.ndjson?limit=200` (admin unless `AUDIT_PUBLIC=1`)

---

## 4) UI usage

Open:

- `/ams`  (or `/ams.html` which 301s to pretty URL)

Go to **ONLINE MODE (Gateway)** tab:

1. Press **Load spec** (fills base to `/ams/v1`)
2. Set **Write token** (optional)
3. Use buttons:
   - **Health**, **Pull**, **Push local queue**
   - **List envelopes / artifacts / threads / notary**
   - Compose & **Send ONLINE** or **Queue LOCAL**
   - Room send/read, Notary create

---

## 5) Local dev (optional)

If you use `wrangler pages dev` (or Pages dev server), functions will run locally.
If `DB` is not bound, the gateway runs in **memory mode** (temporary).

