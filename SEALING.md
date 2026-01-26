# SEALING — Minisign + SHA-256 (Decade-stable)

Seal set:
- portal/assets/app.js
- portal/config/runtime.json
- portal/federation.html
- portal/artifacts.html
- portal/status.html
- FINAL_AUDIT.md
- SEALING.md

Steps:
1) Generate SEAL_SHA256.json (PowerShell)
2) minisign -S -m SEAL_SHA256.json
3) Verify with minisign.pub when available
