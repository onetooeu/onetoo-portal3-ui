# FINAL_AUDIT — ONETOO Portal (Mozart Maximalist)

This file defines a **sealed audit checkpoint** for a decade-stable, read-only portal UI.

## Scope
- Static client UI (no backend required)
- Deterministic behavior
- Local artifacts stored in browser localStorage
- Federation handshake snapshot with SHA-256
- Status overview (human + AI readable export)

## Verified behaviors

### Federation handshake snapshot
- Fetches discovery targets from runtime discovery block
- Stores deterministic artifact with SHA-256
- Artifact is accessible via permalink: artifacts.html#<sha256>
- Federation page provides deep-link to artifact after snapshot is created

### Artifacts
- Local artifacts index stored in localStorage: onetoo_portal_artifacts
- Artifact payload stored in localStorage: artifact:<key> and alias artifact:<sha256> for permalink
- Artifacts page auto-opens on #<sha256> or #<artifact-key>

### Status overview
- Runs the same federation handshake snapshot
- Produces compact status summary (ok/fail and per-target statuses)
- Exports JSON + JSONL

## Operational verification (local)
1) python -m http.server 8787
2) Open http://127.0.0.1:8787/portal/
3) Confirm:
   - Federation snapshot creates artifact + link
   - artifacts.html#<sha256> auto-opens detail
   - status.html generates JSON and JSONL

## Sealing procedure
See SEALING.md.
