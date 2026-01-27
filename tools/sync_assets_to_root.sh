#!/usr/bin/env bash
set -euo pipefail
mkdir -p assets
cp -f portal/assets/style.css assets/style.css
cp -f portal/assets/ams.css assets/ams.css
cp -f portal/assets/ams.js assets/ams.js
cp -f portal/assets/app.js assets/app.js
echo "OK: synced portal/assets -> /assets"
