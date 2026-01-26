import { qs, safeJson } from "./app.js";

function scoreEntity(obj){
  // Deterministic heuristic: transparent & tweakable
  let score = 0;
  const reasons = [];
  if (!obj || typeof obj !== "object"){ return {score:0,reasons:["invalid object"]}; }

  // Identity
  if (obj.id){ score += 10; reasons.push("has id"); }
  if (obj.domain){ score += 8; reasons.push("has domain"); }
  if (obj.type){ score += 5; reasons.push("has type"); }

  // Trust artifacts
  const t = obj.trust || obj.artifacts || {};
  if (t.minisign || t.signature){ score += 25; reasons.push("signature/minisign present"); }
  if (t.sha256 || t.manifest){ score += 20; reasons.push("sha256 manifest present"); }
  if (t.contact || obj.contact){ score += 8; reasons.push("contact present"); }
  if (t.policies || obj.policies){ score += 6; reasons.push("policies present"); }
  if (t.changelog || obj.changelog){ score += 6; reasons.push("changelog present"); }

  // Federation hints
  if (obj.federation || obj.did || obj.dns){ score += 6; reasons.push("federation/did/dns signal"); }

  // Clamp
  if (score > 100) score = 100;
  return { score, reasons };
}

qs("#scoreBtn")?.addEventListener("click", ()=>{
  const raw = qs("#scoreIn").value.trim();
  const obj = safeJson(raw, null);
  const out = scoreEntity(obj);
  qs("#scoreBadge").textContent = String(out.score);
  qs("#scoreOut").textContent = JSON.stringify(out, null, 2);
});
