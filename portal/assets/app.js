/**
 * ONETOO Portal Ultra Edge - client
 * - prefers Portal Worker API when configured
 * - falls back to direct sources if needed
 */
export const DEFAULTS = {
  portalApiBase: "", // e.g. https://portal-api.onetoo.eu or worker route
  trustRootBase: "https://www.onetoo.eu",
  searchRuntimeBase: "https://search.onetoo.eu",
  acceptedSetPath: "/public/dumps/contrib-accepted.json",
};
export async function bootstrapRuntimeConfig() {
  try {
    const r = await fetch("/config/runtime.json", { cache: "no-store" });
    if (!r.ok) return null;

    const runtime = await r.json();

    // canonicalize onetoo.eu -> www.onetoo.eu (your live infra redirects)
    if (runtime.trust_root && /^https:\/\/onetoo\.eu(\/|$)/.test(runtime.trust_root)) {
      runtime.trust_root = runtime.trust_root.replace("https://onetoo.eu", "https://www.onetoo.eu");
    }

    // Map runtime.json -> app.js config keys (keep existing architecture)
    const patch = {};
    if (runtime.portal_api_base) patch.portalApiBase = runtime.portal_api_base;
    if (runtime.trust_root) patch.trustRootBase = runtime.trust_root;
    if (runtime.search_runtime) patch.searchRuntimeBase = runtime.search_runtime;

    // Publish globally for debug/other modules
    window.__MOZART_CFG = runtime;
    window.__MOZART = window.__MOZART || {};
    window.__MOZART.cfg = runtime;

    // Persist patch so existing getConfig() picks it up
    if (Object.keys(patch).length) setConfig(patch);

    return runtime;
  } catch (e) {
    return null;
  }
}

// Auto-bootstrap on load (non-breaking)
bootstrapRuntimeConfig();


export function qs(sel){ return document.querySelector(sel); }
export function qsa(sel){ return Array.from(document.querySelectorAll(sel)); }

export function getConfig(){
  const url = new URL(window.location.href);
  const stored = JSON.parse(localStorage.getItem("onetoo_portal_cfg")||"{}");
  const cfg = { ...DEFAULTS, ...stored };
  // URL overrides
  for (const k of ["portalApiBase","trustRootBase","searchRuntimeBase","acceptedSetPath"]){
    if (url.searchParams.get(k)) cfg[k] = url.searchParams.get(k);
  }
  return cfg;
}

export function setConfig(patch){
  const cur = JSON.parse(localStorage.getItem("onetoo_portal_cfg")||"{}");
  localStorage.setItem("onetoo_portal_cfg", JSON.stringify({ ...cur, ...patch }));
}

export function canonicalAcceptedUrl(cfg){
  const base = (cfg.trustRootBase||"").replace(/\/$/,"");
  const path = cfg.acceptedSetPath.startsWith("/")?cfg.acceptedSetPath:`/${cfg.acceptedSetPath}`;
  return base + path;
}

async function fetchJson(url, opts={}){
  const resp = await fetch(url, { ...opts, headers: { "accept":"application/json", ...(opts.headers||{}) } });
  const text = await resp.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* noop */ }
  return { ok: resp.ok, status: resp.status, data, text, headers: resp.headers };
}

export async function getAccepted(cfg){
  // Prefer worker proxy if portalApiBase set
  if (cfg.portalApiBase){
    const u = cfg.portalApiBase.replace(/\/$/,"") + "/portal/v1/accepted";
    const r = await fetchJson(u);
    if (r.ok) return { source:"portal-api", ...r };
  }
  // Direct
  const u = canonicalAcceptedUrl(cfg);
  const r = await fetchJson(u);
  return { source:"direct", ...r };
}

export async function getEntity(cfg, id){
  if (cfg.portalApiBase){
    const u = cfg.portalApiBase.replace(/\/$/,"") + "/portal/v1/entity/" + encodeURIComponent(id);
    const r = await fetchJson(u);
    if (r.ok) return { source:"portal-api", ...r };
  }
  // direct fallback: load accepted-set and filter
  const acc = await getAccepted(cfg);
  const items = (acc.data && Array.isArray(acc.data.items)) ? acc.data.items : [];
  const match = items.find(it => stableId(it) === id) || null;
  return { ok: !!match, status: match?200:404, data: match, source:"direct-filter" };
}

export async function portalSearch(cfg, q, limit=10){
  if (cfg.portalApiBase){
    const u = cfg.portalApiBase.replace(/\/$/,"") + "/portal/v1/search?q=" + encodeURIComponent(q) + "&limit=" + encodeURIComponent(String(limit));
    const r = await fetchJson(u);
    if (r.ok) return { source:"portal-api", ...r };
  }
  const u = cfg.searchRuntimeBase.replace(/\/$/,"") + "/search/v1?q=" + encodeURIComponent(q) + "&limit=" + encodeURIComponent(String(limit));
  const r = await fetchJson(u);
  return { source:"search-runtime", ...r };
}

export function norm(x){
  return String(x||"").toLowerCase().replace(/\s+/g," ").trim();
}

export function stableId(it){
  // deterministic id derived from url + kind + title (fallback)
  const k = norm(it?.kind);
  const u = norm(it?.url);
  const t = norm(it?.title);
  const s = `${k}|${u}|${t}`;
  // simple browser-safe hash
  let h=2166136261;
  for (let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ("id_"+(h>>>0).toString(16)).padEnd(11,"0");
}

export function scoreExplain(it, q){
  // MUST match worker's deterministic scoring
  const qq = norm(q);
  const expl = { q: qq, total: 0, rules: [] };
  const add = (points, why, ok) => {
    expl.rules.push({ points, why, ok: !!ok });
    if (ok) expl.total += points;
  };

  const title = norm(it?.title);
  const desc = norm(it?.description);
  const url = norm(it?.url);
  const topics = Array.isArray(it?.topics) ? it.topics.map(norm) : [];
  const langs = Array.isArray(it?.languages) ? it.languages.map(norm) : [];

  add(5, "title includes query", title.includes(qq));
  add(3, "description includes query", desc.includes(qq));
  add(4, "topics contain query", topics.includes(qq));
  add(1, "languages contain query", langs.includes(qq));
  add(1, "url includes query", url.includes(qq));

  return expl;
}

export function fmtDate(s){
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s);
  return d.toISOString().replace(".000Z","Z");
}

export function escapeHtml(s){
  return String(s||"").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
}


export function mountHeader(cfg){
  const el = document.getElementById("header");
  if (!el) return;
  const links = [
    ["Home","./index.html"],
    ["Registry","./entities.html"],
    ["Search","./search.html"],
    ["Federation","./federation.html"],
    ["Audit","./audit.html"],
    ["Artifacts","./artifacts.html"],
    ["Status","./status.html"],
    ["Docs","./docs.html"],
  ];
  const qs = new URLSearchParams();
  // persist config in URL (optional, minimal)
  for (const k of ["portalApiBase","trustRootBase","searchRuntimeBase","acceptedSetPath"]){
    if (cfg && cfg[k] && cfg[k] !== DEFAULTS[k]) qs.set(k, cfg[k]);
  }
  const suffix = qs.toString() ? ("?"+qs.toString()) : "";
  el.innerHTML = `
  <div class="topbar">
    <div class="brand">
      <span class="logo">ONETOO</span>
      <span class="muted">Portal</span>
      <span class="badge subtle">read-only</span>
    </div>
    <nav class="nav">
      ${links.map(([t,h])=>`<a href="${h}${suffix}">${escapeHtml(t)}</a>`).join("")}
    </nav>
  </div>`;
}

export function mountFooter(cfg){
  const el = document.getElementById("footer");
  if (!el) return;
  const yr = new Date().getUTCFullYear();
  el.innerHTML = `<div class="footer">
    <div class="small muted">
      Â© ${yr} ONETOO â€” deterministic, audit-friendly trust fabric. UI is read-only and does not approve or modify registry state.
    </div>
  </div>`;
}


export function safeJson(txt, fallback=null){ try { return JSON.parse(txt); } catch(e){ return fallback; } }
export function humanBytes(n){ const u=['B','KB','MB','GB']; let i=0; let x=n; while(x>=1024 && i<u.length-1){ x/=1024; i++; } return (i===0?x: x.toFixed(2))+' '+u[i]; }
export function fmtTs(iso){ try{ return new Date(iso).toLocaleString(); }catch(e){ return iso; } }
export function downloadText(name, txt){ const blob=new Blob([txt],{type:'text/plain;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }
