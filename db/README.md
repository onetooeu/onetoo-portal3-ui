# D1 / R2 bindings (OMEGA FULL)

This repo can run in **memory mode** (no persistence), but the intended online mode uses **Cloudflare D1**.

## Bindings

### D1
Create a D1 database and bind it to Pages as:

- Binding name: `DB`

Then run migrations with the schema in `db/schema.sql`.

### R2 (optional)
If you want large artifacts stored outside D1:

- R2 binding name: `ARTIFACTS`

Artifacts smaller than ~128KB are stored inline in D1 (or memory mode).

## Environment variables

- `AMS_WRITE_TOKEN` (recommended) – bearer token required for all write endpoints
- `AMS_ADMIN_TOKEN` (optional) – bearer token for admin-only endpoints (audit NDJSON unless you set `AUDIT_PUBLIC=1`)
- `AUDIT_PUBLIC=1` (optional) – expose audit stream publicly (demo only)
- `AMS_CORS_ORIGIN` (optional) – restrict CORS to a single origin
- `FED_ALLOWLIST` (optional) – comma-separated hostnames allowed for federation handshake fetches
- `AMS_ED25519_PKCS8_B64` + `AMS_ED25519_SPKI_B64` (optional) – Ed25519 keys for server proofs
- `AMS_HMAC_SECRET` (optional) – fallback proof secret (base64 or raw)

