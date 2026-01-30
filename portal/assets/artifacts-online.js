import { qs, safeJson } from "./app.js";

const GW_TOKEN_KEY = "onetoo_ams_gateway_write_token_v1";

function getSavedToken(){
  try { return localStorage.getItem(GW_TOKEN_KEY) || ""; } catch { return ""; }
}
function setSavedToken(t){
  try { if (t) localStorage.setItem(GW_TOKEN_KEY, t); } catch {}
}
function v(sel){ return (qs(sel)?.value || "").trim(); }
function setV(sel, val){ if (qs(sel)) qs(sel).value = val; }

async function fetchJson(url, opts){
  const r = await fetch(url, opts);
  const txt = await r.text();
  const obj = safeJson(txt, null);
  if (!r.ok) throw new Error((obj && (obj.message || obj.error)) ? `${r.status}: ${obj.message || obj.error}` : `${r.status}: ${txt.slice(0,200)}`);
  return obj || { raw: txt };
}

export function initArtifactsOnline(){
  if (!qs("#artToken")) return;

  const t = getSavedToken();
  if (t) setV("#artToken", t);

  qs("#artListBtn")?.addEventListener("click", async ()=>{
    try{
      const res = await fetchJson("/ams/v1/artifacts?limit=100", { cache:"no-store" });
      qs("#artOut").textContent = JSON.stringify(res, null, 2);
    }catch(e){
      alert(String(e.message||e));
    }
  });

  qs("#artGetBtn")?.addEventListener("click", async ()=>{
    try{
      const key = v("#artKey");
      if (!key) return alert("Missing key");
      const res = await fetchJson(`/ams/v1/artifacts/${encodeURIComponent(key)}?payload=1`, { cache:"no-store" });
      qs("#artOut").textContent = JSON.stringify(res, null, 2);
    }catch(e){
      alert(String(e.message||e));
    }
  });

  qs("#artUpsertBtn")?.addEventListener("click", async ()=>{
    try{
      const key = v("#artKey");
      if (!key) return alert("Missing key");
      const token = v("#artToken");
      if (token) setSavedToken(token);

      const raw = (qs("#artPayload")?.value || "");
      const maybe = safeJson(raw, null);
      const payload = (maybe !== null && maybe !== undefined) ? maybe : raw;

      const headers = { "content-type":"application/json" };
      if (token) headers["authorization"] = "Bearer " + token;

      const res = await fetchJson("/ams/v1/artifacts", {
        method:"POST",
        headers,
        body: JSON.stringify({ key, payload, meta:{ source:"portal-artifacts-ui" } })
      });
      qs("#artOut").textContent = JSON.stringify(res, null, 2);
      alert("Upserted ✅");
    }catch(e){
      alert(String(e.message||e));
    }
  });
}
