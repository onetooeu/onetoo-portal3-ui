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
    const r = await fetch("./config/runtime.json", { cache: "no-store" });
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

export async function fetchJson(url, opts={}){
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
    ["AMS ✨","./ams.html"],
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
      &copy; ${yr} ONETOO &mdash; deterministic, audit-friendly trust fabric. UI is read-only and does not approve or modify registry state.
    </div>
  </div>`;
}


export function safeJson(txt, fallback=null){ try { return JSON.parse(txt); } catch(e){ return fallback; } }
export function humanBytes(n){ const u=['B','KB','MB','GB']; let i=0; let x=n; while(x>=1024 && i<u.length-1){ x/=1024; i++; } return (i===0?x: x.toFixed(2))+' '+u[i]; }
export function fmtTs(iso){ try{ return new Date(iso).toLocaleString(); }catch(e){ return iso; } }
export function downloadText(name, txt){ const blob=new Blob([txt],{type:'text/plain;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }


/* --- Mozart Federation Handshake Snapshot --- */
async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,"0")).join("");
}

function saveArtifact(key, payload) {
  const listKey = "onetoo_portal_artifacts";
  const cur = JSON.parse(localStorage.getItem(listKey) || "[]");
  cur.unshift({ key, ts: new Date().toISOString(), bytes: JSON.stringify(payload).length });
  localStorage.setItem(listKey, JSON.stringify(cur.slice(0, 200)));
  localStorage.setItem("artifact:" + key, JSON.stringify(payload, null, 2));
}

async function fetchJsonLoose(url) {
  const r = await fetch(url, { headers: { "accept":"application/json" } });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch {}
  return { ok: r.ok, status: r.status, url, json: j, text: t.slice(0, 2000) };
}

export async function federationHandshakeSnapshot() {
  // use runtime config already loaded by bootstrapRuntimeConfig()
  const runtime = window.__MOZART_CFG || null;
  const cfg = await (async () => {
    try { return await (await fetch("./config/runtime.json", { cache:"no-store" })).json(); } catch { return null; }
  })();

  const disc = (cfg && cfg.discovery) ? cfg.discovery : (runtime && runtime.discovery) ? runtime.discovery : {};
  const targets = [
    disc.trust_root_index,
    disc.trust_root_ai_trust_hub,
    disc.trust_root_llms,
    disc.trust_root_sha256,
    disc.trust_root_minisign_pub,
    disc.search_openapi,
    disc.agents_index,
    disc.agents_status,
    disc.agents_openapi
  ].filter(Boolean);

  const results = [];
  for (const u of targets) results.push(await fetchJsonLoose(u));

  const snapshot = {
    kind: "onetoo_federation_snapshot",
    created: new Date().toISOString(),
    portal_origin: window.location.origin,
    runtime: cfg || runtime,
    targets,
    results
  };

  const snapshotText = JSON.stringify(snapshot);
  const sha256 = await sha256Hex(snapshotText);

  const artifactKey = `federation-snapshot:${sha256}`;
  saveArtifact(artifactKey, { sha256, snapshot });

  return { ok: true, sha256, artifactKey, targets, resultsCount: results.length };
}

// wire federation.html buttons if present (robust)
function wireHandshakeUI() {
  const btn = document.getElementById("btnHandshake");
  const clr = document.getElementById("btnClearHandshake");
  const out = document.getElementById("handshakeOut");
  if (!btn || !out) return;

  btn.style.pointerEvents = "auto";

  btn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    out.textContent = "Running handshakeĂ„â€šĂ˘â‚¬ĹľÄ‚ËĂ˘â€šÂ¬ÄąË‡Ă„â€šĂ˘â‚¬Ä…Ä‚â€šĂ‚ÂÄ‚â€žĂ˘â‚¬ĹˇÄ‚â€ąĂ‚ÂĂ„â€šĂ‹ÂÄ‚ËĂ˘â‚¬ĹˇĂ‚Â¬Ă„Ä…Ă‹â€ˇĂ„â€šĂ˘â‚¬ĹˇÄ‚â€šĂ‚Â¬Ä‚â€žĂ˘â‚¬ĹˇÄ‚ËĂ˘â€šÂ¬ÄąË‡Ă„â€šĂ˘â‚¬ĹˇÄ‚â€šĂ‚Â¦";
    try {
      const res = await federationHandshakeSnapshot();
      out.textContent = JSON.stringify(res, null, 2);
    } catch (e) {
      out.textContent = JSON.stringify({ ok:false, error: String(e && e.message ? e.message : e) }, null, 2);
    }
  });

  if (clr) clr.addEventListener("click", (ev) => {
    ev.preventDefault();
    out.textContent = "";
  });
}

// Ensure wiring runs no matter the load timing
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wireHandshakeUI);
} else {
  wireHandshakeUI();
}
/* --- end handshake --- */


/* --- Artifacts UI (localStorage) --- */
function loadArtifactsIndex() {
  try { return JSON.parse(localStorage.getItem("onetoo_portal_artifacts") || "[]"); } catch { return []; }
}
function getArtifactPayload(key) {
  try { return localStorage.getItem("artifact:" + key); } catch { return null; }
}

function wireArtifactsUI() {
  const listEl = document.getElementById("artifactsList");
  const viewEl = document.getElementById("artifactView");
  const btnR = document.getElementById("btnArtifactsRefresh");
  const btnC = document.getElementById("btnArtifactsClear");
  const btnD = document.getElementById("btnArtifactDownload");
  if (!listEl || !viewEl || !btnR) return;

  let selectedKey = null;

  function render() {
    const items = loadArtifactsIndex();
    listEl.innerHTML = "";
    if (!items.length) {
      listEl.innerHTML = `<li class="muted">No local artifacts yet.</li>`;
      viewEl.textContent = "";
      if (btnD) btnD.disabled = true;
      return;
    }

    for (const it of items) {
      const li = document.createElement("li");
      li.className = "item";
      li.innerHTML = `<div><b>${it.key}</b><div class="muted small">${it.ts} Ä‚â€šĂ‚Â· ${it.bytes} bytes</div></div>`;
      li.style.cursor = "pointer";
      li.addEventListener("click", () => {
        selectedKey = it.key;
        const payload = getArtifactPayload(selectedKey) || "";
        viewEl.textContent = payload || "(empty)";
        if (btnD) btnD.disabled = !payload;
      });
      listEl.appendChild(li);
    }
  }

  btnR.addEventListener("click", (e) => { e.preventDefault(); render(); });

  if (btnC) btnC.addEventListener("click", (e) => {
    e.preventDefault();
    const items = loadArtifactsIndex();
    for (const it of items) localStorage.removeItem("artifact:" + it.key);
    localStorage.removeItem("onetoo_portal_artifacts");
    selectedKey = null;
    render();
  });

  if (btnD) btnD.addEventListener("click", (e) => {
    e.preventDefault();
    if (!selectedKey) return;
    const payload = getArtifactPayload(selectedKey);
    if (!payload) return;
    const safe = selectedKey.replace(/[^a-zA-Z0-9:_-]+/g, "_");
    downloadText(safe + ".json", payload);
  });

  render();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wireArtifactsUI);
} else {
  wireArtifactsUI();
}
/* --- end artifacts --- */

