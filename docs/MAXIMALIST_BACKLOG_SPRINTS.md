# Maximalist Backlog (Sprints) — portal.onetoo.eu + ecosystem

This backlog is written to **maximize functionality** while respecting invariants:
- portal is **read-only**
- deterministic, audit-first
- no ML, no personalization, no hidden authority

## Sprint 0 — Baseline hardening (1 week)
**MUST**
- Add canonical config page with explicit URLs + health checks
- Add “Data shape validator” in UI for accepted-set schema (show errors)
- Add robust error UX (CORS/404/redirect) with copy-paste curl diagnostics
**Acceptance**
- portal shows clear reason when accepted-set cannot be fetched
- one-click copy of debug bundle (URLs + status codes)

## Sprint 1 — Registry v1 (1–2 weeks)
**MUST**
- Faceted browsing: type/topics/languages/status lane
- Export buttons: JSON / CSV of current filtered view (client-side)
- Deep link entity detail by stable id
**SHOULD**
- “Compare entities” view (side-by-side)
**Acceptance**
- 10k entities render within 2s on mid laptop (virtualized list or pagination)

## Sprint 2 — Entity detail v1 (1–2 weeks)
**MUST**
- Entity “Proofs” panel with all canonical artifacts (sha256/minisign)
- “Verify” wizard: copy/paste commands (Windows + Linux)
- Show decision trace (if available) + reason codes
**SHOULD**
- Render well-known preview (fetch + show JSON)
**Acceptance**
- Entity page contains zero mutable actions; all actions are “open / copy / export”

## Sprint 3 — Transparency center (2 weeks)
**MUST**
- Public audit timeline (accepted changes, decisions, incidents)
- Changelog feed: latest.json + rss/atom (static generated)
- “Drift detector” view: compares portal-configured URLs vs canonical
**Acceptance**
- User can answer: “what changed yesterday and why?” from UI

## Sprint 4 — Onboarding kit (2–3 weeks)
**MUST**
- “Publisher onboarding” section: required endpoints, templates
- Built-in validator page: paste URL → validate well-known + signatures presence
- Downloadable starter pack (ZIP): templates + CI examples
**Acceptance**
- New publisher can go from 0 → valid TFWS publish in 30–60 minutes

## Sprint 5 — Portal Worker (optional, 2–3 weeks)
**Purpose:** solve CORS and aggregate proofs.
**Endpoints**
- `/portal/v1/accepted` (proxy + cache)
- `/portal/v1/entity/{id}` (normalized canonical view)
- `/portal/v1/verify` (returns URLs + expected hashes; still no private keys)
**Acceptance**
- Portal works even if trustRoot blocks CORS, via worker proxy

## Sprint 6 — Search Phase 4 UX (2–4 weeks)
**MUST**
- `/search/v2` UI with facets, structured filters, explain endpoint
- Saved queries (local-only) + export query bundles
**Acceptance**
- Explain view matches runtime explain output for the same query

## Sprint 7 — Federation (4–8 weeks)
**MUST**
- Multi-trust-root list (curated) + federated discovery view
- Trust-root comparison: policies, signatures, update cadence
**Acceptance**
- Federation is opt-in, transparent, and deterministic.

---

## Definition of Done (global)
- Every feature includes: deterministic behavior, audit logging in UI, exportability, and zero write actions.
- Every endpoint used is documented on `/status` + `/docs`.
