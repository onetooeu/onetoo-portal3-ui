import { getConfig, mountHeader, mountFooter, escapeHtml, safeJson, downloadText, humanBytes, fmtTs } from "./app.js";

/**
 * AMS.JS — ONLINE-FIXED (2026-01)
 * - Fixes 401 flow (Bearer token support + UI persistence + clear state)
 * - Fixes 2 silent traps:
 *    (1) setTab() programmatic navigation now routes special panels (gateway/quorum)
 *    (2) quorum vote counting reads payload.choice (was v.choice)
 * - Removes undefined isOnlineSubmitEnabled() gating (was hard crash)
 * - Adds Mock Gateway mode: lets you test “Send online” without server writes
 */

const cfg = getConfig();
mountHeader(cfg);
mountFooter(cfg);

const VAULT_KEY = "onetoo_ams_vault_v1";
const GW_TOKEN_KEY = "onetoo_ams_gateway_write_token_v1";
const GW_MOCK_KEY  = "onetoo_ams_gateway_mock";

const els = {
  // core UI
  meta: document.getElementById("meta"),
  list: document.getElementById("list"),
  panelTitle: document.getElementById("panelTitle"),
  panelHint: document.getElementById("panelHint"),
  inspector: document.getElementById("inspector"),
  raw: document.getElementById("raw"),
  btnLoadDemo: document.getElementById("btnLoadDemo"),
  btnJumpCompose: document.getElementById("btnJumpCompose"),
  btnExportVault: document.getElementById("btnExportVault"),
  btnClearVault: document.getElementById("btnClearVault"),
  inImport: document.getElementById("inImport"),
  btnDownloadRaw: document.getElementById("btnDownloadRaw"),
  btnPin: document.getElementById("btnPin"),
  map: document.getElementById("map"),
  mapMeta: document.getElementById("mapMeta"),

  // compose
  cFrom: document.getElementById("cFrom"),
  cTo: document.getElementById("cTo"),
  cKind: document.getElementById("cKind"),
  cPri: document.getElementById("cPri"),
  cTitle: document.getElementById("cTitle"),
  cBody: document.getElementById("cBody"),
  btnQueueOutbox: document.getElementById("btnQueueOutbox"),
  btnCopyRaw: document.getElementById("btnCopyRaw"),
  composeMeta: document.getElementById("composeMeta"),

  // gateway panel (must exist in ams.html)
  gwOut: document.getElementById("gwOut"),
  gwState: document.getElementById("gwState"),
  gwLoadSpec: document.getElementById("gwLoadSpec"),
  gwMockToggle: document.getElementById("gwMockToggle"),
  gwSubmitOnline: document.getElementById("gwSubmitOnline"),
  gwToken: document.getElementById("gwToken"),
  gwTokenSave: document.getElementById("gwTokenSave"),
  gwTokenClear: document.getElementById("gwTokenClear"),
  gwAuthState: document.getElementById("gwAuthState"),

  // quorum panel
  qRoom: document.getElementById("qRoom"),
  qThresh: document.getElementById("qThresh"),
  qNewProposal: document.getElementById("qNewProposal"),
  qVoteYes: document.getElementById("qVoteYes"),
  qVoteNo: document.getElementById("qVoteNo"),
  qDecide: document.getElementById("qDecide"),
  qOut: document.getElementById("qOut"),
  qState: document.getElementById("qState"),
};

let state = {
  tab: "inbox",
  selectedId: null,
  vault: { meta:{ created:new Date().toISOString() }, inbox:[], outbox:[], log:[] }
};

/* ============================
   Helpers
============================ */
function isMockGatewayEnabled(){
  try { return localStorage.getItem(GW_MOCK_KEY) === "1"; } catch { return false; }
}
function setGwState(txt){
  if (els.gwState) els.gwState.textContent = txt;
}
function setAuthState(){
  if (!els.gwAuthState) return;
  const tok = getWriteToken();
  els.gwAuthState.textContent = tok ? `auth: token set (${Math.min(8, tok.length)}+)` : "auth: empty";
}

function getWriteToken(){
  const tok = (els.gwToken?.value || "").trim();
  return tok;
}

function persistWriteToken(token){
  try{
    if (token) localStorage.setItem(GW_TOKEN_KEY, token);
    else localStorage.removeItem(GW_TOKEN_KEY);
  }catch{}
  setAuthState();
}

function loadWriteToken(){
  try{
    const t = localStorage.getItem(GW_TOKEN_KEY) || "";
    if (els.gwToken) els.gwToken.value = t;
  }catch{}
  setAuthState();
}

/* ============================
   API compatibility: type vs kind
   - UI uses legacy `kind` (ams-envelope-0.2)
   - Gateway expects strict `type`
============================ */
function normalizeEnvelopeForApi(env){
  const out = { ...(env || {}) };

  // Server expects: { type, payload, ts, ... }
  if (!out.type && out.kind) out.type = out.kind;

  // keep payload as-is
  if (!out.ts) out.ts = new Date().toISOString();

  // remove legacy `kind` field
  delete out.kind;

  // meta stable
  if (!out.meta || typeof out.meta !== "object") out.meta = {};

  return out;
}

/* ============================
   Gateway spec helpers
============================ */
let gwSpecCache = null;

function findSpecEndpoint(spec, id){
  const eps = (spec && Array.isArray(spec.endpoints)) ? spec.endpoints : [];
  return eps.find(x => x && x.id === id) || null;
}

function resolveGatewayUrl(path){
  if (!path) return null;
  try{
    return new URL(path, location.origin).toString();
  }catch{
    return String(path);
  }
}

async function loadGatewaySpec(){
  if (els.gwOut) els.gwOut.textContent = "Loading spec…";
  setGwState("loading…");
  try{
    const r = await fetch("/.well-known/ams-gateway-spec.json", { cache:"no-store" });
    const t = await r.text();

    if (els.gwOut) els.gwOut.textContent = t;

    const obj = safeJson(t, null);
    if (obj && typeof obj === "object") gwSpecCache = obj;

    setGwState("spec loaded");
    return gwSpecCache;
  }catch(e){
    if (els.gwOut) els.gwOut.textContent = String(e?.message||e);
    setGwState("spec error");
    throw e;
  }
}

/**
 * POST envelope to gateway
 * - Adds Authorization: Bearer <token> if present
 */
async function postEnvelopeToGateway(env){
  const spec = gwSpecCache;
  const ep = findSpecEndpoint(spec, "ingest_envelope");
  const path = ep?.path || "/ams/v1/envelopes";
  const url = resolveGatewayUrl(path);

  const payload = normalizeEnvelopeForApi(env);

  const headers = { "content-type": "application/json" };
  const token = getWriteToken();
  if (token) headers["authorization"] = "Bearer " + token;

  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  const text = await r.text();
  const json = safeJson(text, null);

  if (!r.ok){
    // Provide a useful error message (especially for 401)
    const serverMsg = (json && (json.message || json.error))
      ? `${json.error || "error"}: ${json.message || ""}`.trim()
      : (text || "").trim();

    if (r.status === 401){
      throw new Error((serverMsg || "401 Unauthorized") + " — missing/wrong token or server expects different secret.");
    }
    throw new Error(serverMsg || ("HTTP " + r.status));
  }

  return json || { ok:true, raw:text };
}

/* ============================
   Vault storage
============================ */
function setMeta(){
  if (!els.meta) return;
  const bytes = new TextEncoder().encode(JSON.stringify(state.vault)).length;
  els.meta.textContent = `vault: ${humanBytes(bytes)} • inbox ${state.vault.inbox.length} • outbox ${state.vault.outbox.length} • log ${state.vault.log.length}`;
}

function saveVault(){
  try{ localStorage.setItem(VAULT_KEY, JSON.stringify(state.vault)); }catch{}
  setMeta();
}

function loadVault(){
  try{
    const v = JSON.parse(localStorage.getItem(VAULT_KEY) || "null");
    if (v && typeof v === "object") state.vault = v;
  }catch{}
  if (!state.vault.inbox) state.vault.inbox = [];
  if (!state.vault.outbox) state.vault.outbox = [];
  if (!state.vault.log) state.vault.log = [];
  setMeta();
}

/* ============================
   Deterministic sorting + envelope normalization (UI)
============================ */
function sortDet(a,b){
  const pa = (a.priority ?? 999);
  const pb = (b.priority ?? 999);
  if (pa !== pb) return pa - pb;
  const ta = String(a.ts||"");
  const tb = String(b.ts||"");
  if (ta !== tb) return tb.localeCompare(ta); // newest first within same priority
  return String(a.id||"").localeCompare(String(b.id||""));
}

function normalizeEnv(e){
  if (!e || typeof e !== "object") return null;
  return {
    v: e.v || "ams-envelope-0.2",
    id: String(e.id || ""),
    ts: String(e.ts || new Date().toISOString()),
    from: String(e.from || "agent:unknown"),
    to: Array.isArray(e.to) ? e.to.map(String) : (typeof e.to === "string" ? e.to.split(",").map(x=>x.trim()).filter(Boolean) : []),
    kind: String(e.kind || "note"),
    priority: Number.isFinite(+e.priority) ? +e.priority : 999,
    thread: e.thread && typeof e.thread==="object" ? { root: e.thread.root||null, prev: e.thread.prev||null } : { root:null, prev:null },
    payload: e.payload && typeof e.payload==="object" ? e.payload : { title:"", body:"" },
    policy: e.policy && typeof e.policy==="object" ? e.policy : { score:null, tags:[], reasons:[] },
    proofs: Array.isArray(e.proofs) ? e.proofs : []
  };
}

function upsertFront(list, item){
  const id = item && item.id;
  if (!id) return;
  for (let i=list.length-1; i>=0; i--){
    if (list[i] && list[i].id === id) list.splice(i,1);
  }
  list.unshift(item);
  if (list.length > 200) list.length = 200;
}

/* ============================
   Rendering
============================ */
function renderList(items){
  const arr = items.slice().sort(sortDet);
  if (!arr.length){
    if (els.list) els.list.innerHTML = `<div class="small muted">No items.</div>`;
    return;
  }
  if (!els.list) return;

  els.list.innerHTML = arr.map(e=>{
    const tags = []
      .concat(e.kind ? [e.kind] : [])
      .concat((e.policy?.tags||[]).slice(0,4));
    const cls = (e.kind==="alert") ? "amsItem amsDanger" : (e.kind==="receipt") ? "amsItem amsOk" : "amsItem";
    return `
      <div class="${cls}">
        <div class="top">
          <div>
            <div class="k">${escapeHtml(e.payload?.title || "(untitled)")}</div>
            <div class="meta">${escapeHtml(fmtTs(e.ts))} • <span class="amsMono">${escapeHtml(e.from)}</span> → <span class="amsMono">${escapeHtml((e.to||[]).join(", "))}</span></div>
          </div>
          <div class="badge subtle">p${escapeHtml(String(e.priority ?? ""))}</div>
        </div>
        <div class="amsSmall">${escapeHtml(String(e.payload?.body||"")).slice(0,240)}${String(e.payload?.body||"").length>240?"…":""}</div>
        <div class="tags">${tags.map(t=>`<span class="amsTag">${escapeHtml(t)}</span>`).join("")}</div>
        <div class="row" style="margin-top:.5rem;">
          <button class="btn" data-open="${escapeHtml(e.id)}">Open</button>
          <button class="btn" data-pin="${escapeHtml(e.id)}">Pin</button>
        </div>
      </div>
    `;
  }).join("");

  els.list.querySelectorAll("button[data-open]").forEach(btn=>{
    btn.addEventListener("click", ()=> openById(btn.getAttribute("data-open")));
  });
  els.list.querySelectorAll("button[data-pin]").forEach(btn=>{
    btn.addEventListener("click", ()=> pinById(btn.getAttribute("data-pin")));
  });
}

function findById(id){
  const all = [...state.vault.inbox, ...state.vault.outbox, ...state.vault.log];
  return all.find(x=>x && x.id===id) || null;
}

function safeInspector(e){
  const pol = e.policy || {};
  const proofs = (e.proofs||[]).map(p=>p.type||"proof").join(", ") || "—";
  const tags = (pol.tags||[]).join(", ") || "—";
  const reasons = (pol.reasons||[]).join(" | ") || "—";
  return `
    <div class="small">
      <div><b>ID</b>: <span class="amsMono">${escapeHtml(e.id||"")}</span></div>
      <div><b>Kind</b>: ${escapeHtml(e.kind||"")}, <b>Priority</b>: ${escapeHtml(String(e.priority??""))}</div>
      <div><b>From</b>: <span class="amsMono">${escapeHtml(e.from||"")}</span></div>
      <div><b>To</b>: <span class="amsMono">${escapeHtml((e.to||[]).join(", "))}</span></div>
      <div><b>Thread</b>: root=<span class="amsMono">${escapeHtml(String(e.thread?.root||"—"))}</span> prev=<span class="amsMono">${escapeHtml(String(e.thread?.prev||"—"))}</span></div>
      <div><b>Policy</b>: score=${escapeHtml(String(pol.score ?? "—"))} tags=${escapeHtml(tags)}</div>
      <div><b>Reasons</b>: ${escapeHtml(reasons)}</div>
      <div><b>Proofs</b>: ${escapeHtml(proofs)}</div>
      <div class="muted" style="margin-top:.35rem;">Prompt Firewall: rendered as plain text only. Nothing executes.</div>
    </div>
  `;
}

function openById(id){
  const e0 = findById(id);
  if (!e0) return;
  const e = normalizeEnv(e0);
  state.selectedId = e.id;
  if (els.inspector) els.inspector.innerHTML = safeInspector(e);
  if (els.raw) els.raw.value = JSON.stringify(e, null, 2);
  drawMap();
}

function pinById(id){
  const e0 = findById(id);
  if (!e0) return;
  const e = normalizeEnv(e0);
  upsertFront(state.vault.log, e);
  saveVault();
  drawMap();
}

/* ============================
   Tabs + special panels
============================ */
function __amsRoutePanels(tab){
  const panels = Array.from(document.querySelectorAll("section.panel[data-panel]"));
  for (const p of panels){
    p.style.display = (p.dataset.panel === tab) ? "block" : "none";
  }

  const grid = document.querySelector(".amsGrid");
  if (grid){
    grid.style.display = (tab === "gateway" || tab === "quorum") ? "none" : "";
  }

  if (tab === "gateway"){
    const el = document.getElementById("panelGateway");
    el && el.scrollIntoView({ behavior:"smooth", block:"start" });
  }
  if (tab === "quorum"){
    const el = document.getElementById("panelQuorum");
    el && el.scrollIntoView({ behavior:"smooth", block:"start" });
  }
}

function setTab(tab){
  state.tab = tab;
  document.querySelectorAll(".amsTabs .btn").forEach(b=>{
    const t = b.getAttribute("data-tab");
    b.classList.toggle("active", t===tab);
  });
  __amsRoutePanels(tab);              // ✅ critical: programmatic navigation works too
  renderCurrent();
}

function renderCurrent(){
  const tab = state.tab;
  if (els.panelTitle) els.panelTitle.textContent = tab.charAt(0).toUpperCase()+tab.slice(1);

  if (tab==="inbox"){
    if (els.panelHint) els.panelHint.textContent = "Deterministic list (priority → time → id).";
    renderList(state.vault.inbox);
    return;
  }
  if (tab==="outbox"){
    if (els.panelHint) els.panelHint.textContent = "Queued envelopes (local-only).";
    renderList(state.vault.outbox);
    return;
  }
  if (tab==="vault"){
    if (els.panelHint) els.panelHint.textContent = "Pinned items (append-only log).";
    renderList(state.vault.log);
    return;
  }
  if (tab==="threads"){
    if (els.panelHint) els.panelHint.textContent = "Grouped by thread.root (causal chains).";
    renderThreads();
    return;
  }
  if (tab==="map"){
    if (els.panelHint) els.panelHint.textContent = "Signal density map (agents/topics).";
    renderMapPanel();
    return;
  }
  if (tab==="quorum"){
    if (els.panelHint) els.panelHint.textContent = "Quorum rooms inferred from topic:quorum/* messages.";
    renderQuorum();
    return;
  }
  if (tab==="policy"){
    if (els.panelHint) els.panelHint.textContent = "Policy lens (score/tags/reasons) across vault.";
    renderPolicy();
    return;
  }
  if (tab==="gateway"){
    if (els.panelHint) els.panelHint.textContent = "Gateway panel (spec + online submit).";
    if (els.list) els.list.innerHTML = `<div class="small muted">Open the Gateway panel below.</div>`;
    return;
  }
}

/* ============================
   Threads / Map / Quorum / Policy
============================ */
function renderThreads(){
  const all = [...state.vault.inbox, ...state.vault.outbox, ...state.vault.log].map(normalizeEnv).filter(Boolean);
  const byRoot = new Map();
  for (const e of all){
    const root = e.thread?.root || "—";
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(e);
  }
  const roots = [...byRoot.keys()].sort((a,b)=>String(a).localeCompare(String(b)));
  if (!roots.length){ if (els.list) els.list.innerHTML = `<div class="small muted">No threads.</div>`; return; }

  if (!els.list) return;
  els.list.innerHTML = roots.map(root=>{
    const items = byRoot.get(root).slice().sort(sortDet);
    const head = items[0];
    return `
      <div class="amsItem">
        <div class="top">
          <div>
            <div class="k">Thread: <span class="amsMono">${escapeHtml(String(root))}</span></div>
            <div class="meta">${escapeHtml(items.length)} events • first: ${escapeHtml(fmtTs(head.ts))}</div>
          </div>
          <div class="badge subtle">${escapeHtml(items.map(x=>x.kind).filter(Boolean)[0]||"")}</div>
        </div>
        <div class="amsSmall">${escapeHtml(String(head.payload?.title||""))}</div>
        <div class="row" style="margin-top:.5rem;">
          <button class="btn" data-open="${escapeHtml(head.id)}">Open head</button>
        </div>
      </div>
    `;
  }).join("");

  els.list.querySelectorAll("button[data-open]").forEach(btn=>{
    btn.addEventListener("click", ()=> openById(btn.getAttribute("data-open")));
  });
}

function renderMapPanel(){
  if (!els.list) return;
  els.list.innerHTML = `
    <div class="small muted">See the Orchestra Map on the right. It updates from vault contents.</div>
    <div class="amsItem" style="margin-top:.5rem;">
      <div class="k">How it works</div>
      <div class="amsSmall">
        Nodes are agents/topics. Edges are message flows (from → to). Size indicates message count.
        This is deterministic and offline-first.
      </div>
    </div>
  `;
  drawMap();
}

function renderQuorum(){
  const all = [...state.vault.inbox, ...state.vault.outbox, ...state.vault.log].map(normalizeEnv).filter(Boolean);
  const q = all.filter(e => (e.to||[]).some(x=>String(x).startsWith("topic:quorum/")) || (e.kind==="quorum"));
  if (!q.length){ if (els.list) els.list.innerHTML = `<div class="small muted">No quorum messages found.</div>`; return; }

  const byTopic = new Map();
  for (const e of q){
    const t = (e.to||[]).find(x=>String(x).startsWith("topic:quorum/")) || "topic:quorum/—";
    if (!byTopic.has(t)) byTopic.set(t, []);
    byTopic.get(t).push(e);
  }
  const topics = [...byTopic.keys()].sort((a,b)=>String(a).localeCompare(String(b)));

  if (!els.list) return;
  els.list.innerHTML = topics.map(t=>{
    const items = byTopic.get(t).slice().sort(sortDet);
    const votes = items.filter(x=>String(x.payload?.title||"").toLowerCase().includes("vote")).length;
    return `
      <div class="amsItem">
        <div class="top">
          <div>
            <div class="k">${escapeHtml(t)}</div>
            <div class="meta">${escapeHtml(items.length)} msgs • votes: ${escapeHtml(String(votes))}</div>
          </div>
          <div class="badge subtle">quorum</div>
        </div>
        <div class="amsSmall">${escapeHtml(String(items[0]?.payload?.body||""))}</div>
        <div class="row" style="margin-top:.5rem;">
          <button class="btn" data-open="${escapeHtml(items[0].id)}">Open</button>
        </div>
      </div>
    `;
  }).join("");

  els.list.querySelectorAll("button[data-open]").forEach(btn=>{
    btn.addEventListener("click", ()=> openById(btn.getAttribute("data-open")));
  });
}

function renderPolicy(){
  const all = [...state.vault.inbox, ...state.vault.outbox, ...state.vault.log].map(normalizeEnv).filter(Boolean);
  if (!all.length){ if (els.list) els.list.innerHTML = `<div class="small muted">No policy data.</div>`; return; }

  const tagCount = new Map();
  for (const e of all){
    for (const t of (e.policy?.tags||[])){
      tagCount.set(t, (tagCount.get(t)||0)+1);
    }
  }
  const tags = [...tagCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0,40);

  if (!els.list) return;
  els.list.innerHTML = `
    <div class="amsItem">
      <div class="k">Top policy tags</div>
      <div class="tags" style="margin-top:.5rem;">
        ${tags.map(([t,n])=>`<span class="amsTag">${escapeHtml(t)} (${escapeHtml(String(n))})</span>`).join("") || "<span class='small muted'>—</span>"}
      </div>
      <div class="small muted" style="margin-top:.5rem;">
        In full AMS, policy is evaluated by gateway/autopilot and attached to each envelope deterministically.
      </div>
    </div>
  `;
}

/* ============================
   Envelope compose + hashing
============================ */
async function sha256Hex(str){
  const data = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

async function makeEnvelope(){
  const from = (els.cFrom?.value||"agent:you").trim() || "agent:you";
  const to = (els.cTo?.value||"topic:ams").split(",").map(x=>x.trim()).filter(Boolean);
  const kind = (els.cKind?.value||"note").trim();
  const priority = Math.max(0, Math.min(999, parseInt(els.cPri?.value||"50",10)));
  const title = (els.cTitle?.value||"").trim() || "(untitled)";
  const body = (els.cBody?.value||"").toString();

  const base = {
    v:"ams-envelope-0.2",
    ts: new Date().toISOString(),
    from, to, kind, priority,
    thread: { root: null, prev: null },
    payload: { title, body },
    policy: { score: null, tags: ["local-only"], reasons: ["composed in offline vault"] },
    proofs: [{ type:"local", note:"not signed (yet) — gateway will attach proofs later" }]
  };
  const id = await sha256Hex(JSON.stringify(base));
  return normalizeEnv({ ...base, id });
}

function copyToClipboard(txt){
  return navigator.clipboard.writeText(txt);
}

/* ============================
   Wiring: compose / inspector / vault
============================ */
function wireCompose(){
  els.btnQueueOutbox?.addEventListener("click", async ()=>{
    const env0 = await makeEnvelope();
    state.vault.outbox.unshift(env0);
    saveVault();
    if (els.composeMeta) els.composeMeta.textContent = "queued: " + env0.id;
    openById(env0.id);
    setTab("outbox");
  });

  els.btnCopyRaw?.addEventListener("click", async ()=>{
    const env0 = await makeEnvelope();
    const raw = JSON.stringify(env0, null, 2);
    await copyToClipboard(raw);
    if (els.composeMeta) els.composeMeta.textContent = "copied";
    if (els.raw) els.raw.value = raw;
    if (els.inspector) els.inspector.innerHTML = safeInspector(env0);
  });
}

function wireInspector(){
  els.btnDownloadRaw?.addEventListener("click", ()=>{
    const txt = els.raw?.value || "";
    const obj = safeJson(txt, null);
    const name = (obj && obj.id) ? (`ams_${obj.id}.json`) : "ams_envelope.json";
    downloadText(name, txt);
  });

  els.btnPin?.addEventListener("click", ()=>{
    const obj = safeJson(els.raw?.value || "", null);
    const e = normalizeEnv(obj);
    if (!e || !e.id) return alert("Invalid envelope JSON");
    upsertFront(state.vault.log, e);
    saveVault();
    drawMap();
    alert("Pinned to Vault");
  });
}

async function exportVault(){
  downloadText("onetoo_ams_vault.json", JSON.stringify(state.vault, null, 2));
}

async function importFile(f){
  const text = await f.text();

  if (f.name.toLowerCase().endsWith(".jsonl")){
    const lines = text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    const events = [];
    for (const ln of lines){
      const obj = safeJson(ln, null);
      const e = normalizeEnv(obj);
      if (e && e.id) events.push(e);
    }
    state.vault.log = events.concat(state.vault.log);
    saveVault();
    renderCurrent();
    drawMap();
    return;
  }

  const obj = safeJson(text, null);
  if (!obj) return alert("Invalid JSON");

  if (obj.inbox && obj.outbox && obj.log){
    state.vault = obj;
    saveVault();
    renderCurrent();
    drawMap();
    return;
  }

  const e = normalizeEnv(obj);
  if (e && e.id){
    upsertFront(state.vault.log, e);
    saveVault();
    renderCurrent();
    drawMap();
    return;
  }

  alert("Unsupported import format");
}

function wireVaultControls(){
  if (els.btnLoadDemo){ els.btnLoadDemo.disabled = false; els.btnLoadDemo.style.pointerEvents = "auto"; }
  els.btnLoadDemo?.addEventListener("click", loadDemo);
  els.btnJumpCompose?.addEventListener("click", (ev)=>{ ev.preventDefault(); document.getElementById("compose")?.scrollIntoView({behavior:"smooth", block:"start"}); });
  els.btnExportVault?.addEventListener("click", exportVault);
  els.btnClearVault?.addEventListener("click", ()=>{
    if (!confirm("Clear AMS vault (localStorage)?")) return;
    state.vault = { meta:{ created:new Date().toISOString() }, inbox:[], outbox:[], log:[] };
    saveVault();
    renderCurrent();
    drawMap();
    if (els.raw) els.raw.value = "";
    if (els.inspector) els.inspector.innerHTML = "";
  });

  els.inImport?.addEventListener("change", async (e)=>{
    const f = e.target.files?.[0];
    if (!f) return;
    try { await importFile(f); }
    catch(err){ alert(String(err.message||err)); }
    e.target.value = "";
  });
}

async function loadDemo(){
  const urls = [
    "/.well-known/ams-demo-log.jsonl?cb=" + Date.now(),
    "/.well-known/ams-demo-log.ndjson?cb=" + Date.now(),
    "/.well-known/ams-demo-log.jsonl",
    "/.well-known/ams-demo-log.ndjson"
  ];

  let lastErr = null;
  let text = null;
  let usedUrl = null;

  for (const u of urls){
    try{
      const r = await fetch(u, { cache:"no-store" });
      if (!r.ok){
        lastErr = new Error(`demo fetch failed: ${r.status} ${r.statusText} (${u})`);
        continue;
      }
      text = await r.text();
      usedUrl = u;
      break;
    }catch(e){
      lastErr = e;
    }
  }

  if (text == null){
    alert("Load demo failed: " + String(lastErr?.message || lastErr || "unknown"));
    return;
  }

  const lines = text.split(/?
/).map(x=>x.trim()).filter(Boolean);
  const events = [];
  for (const ln of lines){
    const obj = safeJson(ln, null);
    const e = normalizeEnv(obj);
    if (e && e.id) events.push(e);
  }

  if (!events.length){
    alert("Demo loaded but no valid events were found. (" + (usedUrl || "") + ")");
    return;
  }

  state.vault.inbox = events.filter(e=>["receipt","alert"].includes(e.kind));
  state.vault.log = events.filter(e=>!["receipt","alert"].includes(e.kind));
  saveVault();
  renderCurrent();
  drawMap();

  setGwState("demo loaded");
}


/* ============================
   Orchestra map
============================ */
function drawMap(){
  const c = els.map;
  if (!c) return;

  const ctx = c.getContext("2d");
  const w = c.width = c.clientWidth * devicePixelRatio;
  const h = c.height = c.clientHeight * devicePixelRatio;
  ctx.clearRect(0,0,w,h);

  const all = [...state.vault.inbox, ...state.vault.outbox, ...state.vault.log].map(normalizeEnv).filter(Boolean);

  const nodes = new Map();
  function bump(k){
    k = String(k||"");
    if (!k) return;
    nodes.set(k, (nodes.get(k)||0)+1);
  }
  for (const e of all){
    bump(e.from);
    for (const t of (e.to||[])) bump(t);
  }

  const keys = [...nodes.keys()].sort((a,b)=>nodes.get(b)-nodes.get(a)).slice(0,16);
  if (!keys.length){
    if (els.mapMeta) els.mapMeta.textContent = "—";
    ctx.font = `${14*devicePixelRatio}px sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,.65)";
    ctx.fillText("No signals yet.", 16*devicePixelRatio, 28*devicePixelRatio);
    return;
  }

  const cx = w/2, cy = h/2, R = Math.min(w,h)*0.34;
  const pos = new Map();
  keys.forEach((k,i)=>{
    const a = (Math.PI*2*i)/keys.length;
    pos.set(k, { x: cx + R*Math.cos(a), y: cy + R*Math.sin(a) });
  });

  ctx.lineWidth = 1.2*devicePixelRatio;
  for (const e of all){
    if (!pos.has(e.from)) continue;
    const p1 = pos.get(e.from);
    for (const t of (e.to||[])){
      if (!pos.has(t)) continue;
      const p2 = pos.get(t);
      ctx.strokeStyle = "rgba(255,255,255,.12)";
      ctx.beginPath();
      ctx.moveTo(p1.x,p1.y);
      ctx.lineTo(p2.x,p2.y);
      ctx.stroke();
    }
  }

  for (const k of keys){
    const p = pos.get(k);
    const n = nodes.get(k)||1;
    const r = (6 + Math.min(18, n)) * devicePixelRatio;

    ctx.fillStyle = "rgba(255,255,255,.14)";
    ctx.beginPath(); ctx.arc(p.x,p.y,r,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.22)";
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,.75)";
    ctx.font = `${11*devicePixelRatio}px sans-serif`;
    const label = k.length>28 ? (k.slice(0,28)+"…") : k;
    ctx.fillText(label, p.x + (r+6), p.y + 4*devicePixelRatio);
  }

  const total = all.length;
  const kinds = new Map();
  for (const e of all) kinds.set(e.kind, (kinds.get(e.kind)||0)+1);
  const topKinds = [...kinds.entries()].sort((a,b)=>b[1]-a[1]).slice(0,4).map(([k,n])=>`${k}:${n}`).join(" ");
  if (els.mapMeta) els.mapMeta.textContent = `signals: ${total} • nodes: ${keys.length} • ${topKinds || "—"}`;
}

/* ============================
   Gateway + Quorum (mock)
============================ */
function toggleMockGateway(){
  const cur = isMockGatewayEnabled();
  const next = !cur;
  try{ localStorage.setItem(GW_MOCK_KEY, next ? "1" : "0"); }catch{}
  setGwState(next ? "mock enabled" : (gwSpecCache ? "spec loaded" : "disabled"));
  alert(next ? "Mock Gateway enabled (no network writes)." : "Mock Gateway disabled.");
}

function quorumKey(room){ return "onetoo_ams_quorum:" + room; }
function lsGet(key, fallback=null){ try{ return JSON.parse(localStorage.getItem(key)||""); }catch{ return fallback; } }
function lsSet(key, obj){ try{ localStorage.setItem(key, JSON.stringify(obj)); }catch{} }

function quorumLoad(room){
  return lsGet(quorumKey(room), { room, threshold:"2-of-3", proposal:null, votes:[], decided:false, decision:null });
}
function quorumSave(room, st){ lsSet(quorumKey(room), st); }

function quorumRender(st){
  if (els.qOut) els.qOut.textContent = JSON.stringify(st, null, 2);
  if (els.qState) els.qState.textContent = st.decided ? "decided" : st.proposal ? "active" : "idle";
}

function quorumComputeDecision(st){
  // ✅ critical: votes store choice inside payload.choice
  const yes = st.votes.filter(v=>v?.payload?.choice==="yes").length;
  const no  = st.votes.filter(v=>v?.payload?.choice==="no").length;
  const need = parseInt(String(st.threshold).split("-of-")[0], 10) || 2;
  const result = yes >= need ? "accepted" : (no >= need ? "rejected" : "undecided");
  return { yes, no, need, result };
}

function env(kind, from, toArr, payload, extra={}){
  return {
    v: "ams-envelope-0.2",
    id: "mock-" + kind + "-" + Math.random().toString(16).slice(2),
    ts: new Date().toISOString(),
    from,
    to: toArr,
    kind,
    priority: extra.priority ?? 10,
    thread: extra.thread ?? { root: extra.root ?? null, prev: extra.prev ?? null },
    payload,
    policy: extra.policy ?? { score: 50, tags:["mock"], reasons:["local-only mock"] },
    proofs: extra.proofs ?? [{type:"mock", note:"no signature"}]
  };
}

async function sendOnline(){
  // Ensure spec is loaded (best effort). If it fails, still try default path.
  if (!gwSpecCache){
    try{ await loadGatewaySpec(); }catch{ /* ignore */ }
  }

  const e = await makeEnvelope();

  // MOCK mode: no network writes, but you can test the full UX flow
  if (isMockGatewayEnabled()){
    const receipt = { ok:true, mock:true, received_at: new Date().toISOString(), echo: normalizeEnvelopeForApi(e) };
    const receiptEnv = normalizeEnv({
      v: "ams-envelope-0.2",
      id: "receipt-mock-" + Date.now(),
      ts: new Date().toISOString(),
      from: "gateway:mock",
      to: ["agent:you"],
      kind: "receipt",
      priority: 20,
      thread: { root: e.id || null, prev: null },
      payload: { title: "Mock gateway receipt", body: JSON.stringify(receipt, null, 2) },
      policy: { score: 90, tags: ["mock","receipt"], reasons: ["mock gateway enabled"] },
      proofs: [{ type:"mock", note:"no network write" }]
    });
    upsertFront(state.vault.log, receiptEnv);
    saveVault();
    renderCurrent();
    drawMap();
    alert("Mock send ✅ (no network)\n" + JSON.stringify(receipt, null, 2).slice(0, 900));
    return;
  }

  // REAL network submit
  const res = await postEnvelopeToGateway(e);
  const receipt = (res && typeof res === "object") ? res : { ok:true, raw:String(res) };

  const receiptEnv = normalizeEnv({
    v: "ams-envelope-0.2",
    id: receipt.id || ("receipt-" + Date.now()),
    ts: new Date().toISOString(),
    from: "gateway:ams",
    to: ["agent:you"],
    kind: "receipt",
    priority: 20,
    thread: { root: e.id || null, prev: null },
    payload: { title: "Gateway receipt", body: JSON.stringify(receipt, null, 2) },
    policy: { score: 90, tags: ["online-submit","receipt"], reasons: ["gateway response"] },
    proofs: Array.isArray(receipt.proofs) ? receipt.proofs : [{ type:"gateway", note:"response" }]
  });

  upsertFront(state.vault.log, receiptEnv);
  saveVault();
  renderCurrent();
  drawMap();

  alert("Sent online ✅\n" + JSON.stringify(receipt, null, 2).slice(0, 900));
}

function wireGatewayAndQuorum(){
  // gateway
  els.gwLoadSpec && (els.gwLoadSpec.onclick = ()=> loadGatewaySpec().catch(()=>{}));
  els.gwMockToggle && (els.gwMockToggle.onclick = toggleMockGateway);

  // token box
  loadWriteToken();
  els.gwToken?.addEventListener("input", ()=> setAuthState());
  els.gwTokenSave && (els.gwTokenSave.onclick = ()=>{
    persistWriteToken(getWriteToken());
    alert("Token saved (localStorage).");
  });
  els.gwTokenClear && (els.gwTokenClear.onclick = ()=>{
    if (els.gwToken) els.gwToken.value = "";
    persistWriteToken("");
    alert("Token cleared.");
  });

  // always enabled in UI; server decides auth (401 if protected)
  if (els.gwSubmitOnline){
    els.gwSubmitOnline.disabled = false;
    els.gwSubmitOnline.title = "Send composed envelope online (or mock if enabled)";
    els.gwSubmitOnline.onclick = async ()=>{
      try{
        await sendOnline();
      }catch(err){
        alert("Send failed: " + String(err?.message || err));
      }
    };
  }

  // quorum
  function getRoom(){ return (els.qRoom?.value||"room:core").trim(); }
  function loadQ(){
    const room = getRoom();
    const st = quorumLoad(room);
    st.threshold = (els.qThresh?.value||st.threshold);
    quorumRender(st);
    return st;
  }
  function saveQ(st){
    const room = getRoom();
    st.threshold = (els.qThresh?.value||st.threshold);
    quorumSave(room, st);
    quorumRender(st);
  }

  els.qNewProposal && (els.qNewProposal.onclick = ()=>{
    const st = loadQ();
    const root = "q-" + Math.random().toString(16).slice(2);
    st.proposal = env(
      "proposal",
      "agent:composer",
      [getRoom()],
      { title:"Proposal", body:"Describe desired action / change." },
      { root, thread:{root,prev:null}, policy:{score:80,tags:["proposal","quorum"],reasons:["mock proposal"]} }
    );
    st.votes = [];
    st.decided = false;
    st.decision = null;
    saveQ(st);
  });

  els.qVoteYes && (els.qVoteYes.onclick = ()=>{
    const st = loadQ();
    if (!st.proposal) return alert("Create proposal first");
    st.votes.push(env(
      "vote",
      "agent:reviewer",
      [getRoom()],
      { choice:"yes" },
      { root: st.proposal.thread.root, prev: st.votes.at(-1)?.id || st.proposal.id }
    ));
    saveQ(st);
  });

  els.qVoteNo && (els.qVoteNo.onclick = ()=>{
    const st = loadQ();
    if (!st.proposal) return alert("Create proposal first");
    st.votes.push(env(
      "vote",
      "agent:reviewer",
      [getRoom()],
      { choice:"no" },
      { root: st.proposal.thread.root, prev: st.votes.at(-1)?.id || st.proposal.id }
    ));
    saveQ(st);
  });

  els.qDecide && (els.qDecide.onclick = ()=>{
    const st = loadQ();
    if (!st.proposal) return alert("Create proposal first");
    const d = quorumComputeDecision(st);
    st.decision = env(
      "decision",
      "agent:conductor",
      [getRoom()],
      {
        threshold: st.threshold,
        tally: d,
        result: d.result,
        proposal_id: st.proposal.id,
        votes: st.votes.map(v=>({id:v.id, choice:v.payload?.choice}))
      },
      { root: st.proposal.thread.root, prev: st.votes.at(-1)?.id || st.proposal.id, policy:{score:90,tags:["decision","quorum"],reasons:["mock deterministic decision"]} }
    );
    st.decided = (d.result !== "undecided");
    saveQ(st);
  });

  // initial render
  loadQ();

  // initial state badge
  if (isMockGatewayEnabled()) setGwState("mock enabled");
  else if (gwSpecCache) setGwState("spec loaded");
  else setGwState("disabled");
}

/* ============================
   Init
============================ */
function wireTabs(){
  document.querySelectorAll(".amsTabs .btn").forEach(b=>{
    b.addEventListener("click", ()=> setTab(b.getAttribute("data-tab")));
  });
}

function init(){
  loadVault();
  // Auto-load gateway spec (best effort) so online mode is ready without extra clicks
  loadGatewaySpec().catch(()=>{});
  wireTabs();
  wireCompose();
  wireInspector();
  wireVaultControls();
  wireGatewayAndQuorum();

  setTab("inbox");
  drawMap();
}

init();/* === ONETOO: Public Audit Widget (Portal 4.0) ==========================
   Shows public NDJSON feed: GET /audit/v1/events.ndjson?limit=N
   No auth required when AUDIT_PUBLIC=1 (your current setup).
======================================================================= */
(function () {
  if (window.__ONETOO_PUBLIC_AUDIT_WIDGET__) return;
  window.__ONETOO_PUBLIC_AUDIT_WIDGET__ = true;

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (k === "style") e.setAttribute("style", v);
      else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, String(v));
    }
    for (const k of kids.flat()) {
      if (k == null) continue;
      e.appendChild(typeof k === "string" ? document.createTextNode(k) : k);
    }
    return e;
  }

  async function fetchAudit(limit) {
    const url = `${location.origin}/audit/v1/events.ndjson?limit=${encodeURIComponent(limit)}&cb=${Date.now()}`;
    const r = await fetch(url, { method: "GET" });
    const t = await r.text();
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${t.slice(0, 200)}`);
    return t;
  }

  function mount() {
    // Only mount on AMS page(s)
    const isAmsPage = location.pathname.endsWith("/ams.html") || location.pathname === "/ams" || location.pathname === "/ams/";
    if (!isAmsPage) return;

    const wrap = h("details", {
      open: "",
      style: [
        "position:fixed",
        "right:12px",
        "bottom:12px",
        "max-width:520px",
        "width:min(520px, calc(100vw - 24px))",
        "background:#0b0d12",
        "border:1px solid rgba(255,255,255,.12)",
        "border-radius:12px",
        "padding:10px",
        "z-index:999999",
        "box-shadow:0 10px 30px rgba(0,0,0,.35)"
      ].join(";")
    });

    const summary = h("summary", {
      style: "cursor:pointer; user-select:none; font-weight:700; color:#e8ecff; outline:none;"
    }, "Public Audit (NDJSON)");

    const row = h("div", { style: "display:flex; gap:8px; margin-top:10px; align-items:center; flex-wrap:wrap;" });

    const inp = h("input", {
      id: "onetoo_audit_limit",
      type: "number",
      min: "1",
      max: "2000",
      value: "50",
      style: "width:120px; padding:8px 10px; border-radius:10px; border:1px solid rgba(255,255,255,.14); background:#0f1320; color:#e8ecff;"
    });

    const btn = h("button", {
      type: "button",
      style: "padding:8px 12px; border-radius:10px; border:1px solid rgba(255,255,255,.18); background:#151b2f; color:#e8ecff; cursor:pointer;"
    }, "Refresh");

    const status = h("span", { style: "color:rgba(232,236,255,.75); font-size:12px;" }, "");

    const out = h("pre", {
      id: "onetoo_audit_out",
      style: [
        "margin-top:10px",
        "max-height:45vh",
        "overflow:auto",
        "white-space:pre-wrap",
        "word-break:break-word",
        "font-size:12px",
        "line-height:1.35",
        "padding:10px",
        "border-radius:10px",
        "background:#0f1320",
        "border:1px solid rgba(255,255,255,.10)",
        "color:#e8ecff"
      ].join(";")
    }, "Click Refresh to load /audit/v1/events.ndjson …");

    btn.addEventListener("click", async () => {
      const limit = Math.max(1, Math.min(parseInt(inp.value || "50", 10) || 50, 2000));
      status.textContent = "loading…";
      try {
        const txt = await fetchAudit(limit);
        const lines = txt.trim() ? txt.trimEnd().split("\n") : [];
        status.textContent = `ok (${lines.length} lines)`;
        out.textContent = txt || "";
      } catch (e) {
        status.textContent = "error";
        out.textContent = String(e && e.message ? e.message : e);
      }
    });

    row.appendChild(h("span", { style: "color:rgba(232,236,255,.75); font-size:12px;" }, "limit"));
    row.appendChild(inp);
    row.appendChild(btn);
    row.appendChild(status);

    wrap.appendChild(summary);
    wrap.appendChild(row);
    wrap.appendChild(out);

    document.body.appendChild(wrap);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
