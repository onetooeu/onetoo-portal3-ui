#!/usr/bin/env bash
set -euo pipefail
# Requires minisign installed.
# 1) Put your public key in .well-known/minisign.pub (optional but recommended)
# 2) Generate sha256 manifest
python3 scripts/gen_sha256_manifest.py
# 3) Sign it (creates .well-known/sha256.json.minisig)
minisign -S -m .well-known/sha256.json -x .well-known/sha256.json.minisig
echo "OK signed .well-known/sha256.json"
