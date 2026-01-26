#!/usr/bin/env python3

import hashlib, json, os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / ".well-known" / "sha256.json"

# What to include (keep decade-stable: explicit allowlist)
INCLUDE = [
  "portal",
  ".well-known/index.json",
  ".well-known/ai-trust-hub.json",
  ".well-known/llms.txt",
  ".well-known/tfws/context/v1",
]

def sha256_file(p: Path) -> str:
  h = hashlib.sha256()
  with p.open("rb") as f:
    for chunk in iter(lambda: f.read(1024*1024), b""):
      h.update(chunk)
  return h.hexdigest()

def walk_dir(dir_rel: str):
  base = ROOT / dir_rel
  for p in sorted(base.rglob("*")):
    if p.is_file():
      rel = str(p.relative_to(ROOT)).replace("\\","/")
      yield p, rel

items = []
for entry in INCLUDE:
  if (ROOT/entry).is_dir():
    for p, rel in walk_dir(entry):
      # skip dev-only stuff
      if rel.endswith((".ps1",".sh")) and rel.startswith("portal/"): 
        continue
      items.append({"path": rel, "sha256": sha256_file(p), "bytes": p.stat().st_size})
  else:
    p = ROOT/entry
    if not p.exists():
      print(f"[warn] missing: {entry}", file=sys.stderr)
      continue
    items.append({"path": entry.replace("\\","/"), "sha256": sha256_file(p), "bytes": p.stat().st_size})

doc = {
  "type": "tfws.sha256.manifest.v1",
  "generated_at_utc": __import__("datetime").datetime.utcnow().isoformat(timespec="seconds")+"Z",
  "root": "/",
  "count": len(items),
  "items": items,
}

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
print(f"OK wrote {OUT} ({len(items)} items)")
