import { getConfig, mountHeader, mountFooter, escapeHtml, safeJson, downloadText, humanBytes, fmtTs } from "./app.js";

const cfg = getConfig();
mountHeader(cfg);
mountFooter(cfg);

const VAULT_KEY = "onetoo_ams_vault_v1";

const els = {
  meta: document.getElementById("meta"),
  list: document.getElementById("list"),
  panelTitle: document.getElementById("panelTitle"),
  panelHint: document.getElementById("panelHint"),
  inspector: document.getElementById("inspector"),
  raw: document.getElementById("raw"),
  btnLoadDemo: document.getElementById("btnLoadDemo"),
  btnExportVault: document.getElementById("btnExportVault"),
  btnClearVault: document.getElementById("btnClearVault"),
  inImport: document.getElementById("inImport"),
  btnDownloadRaw: document.getElementById("btnDownloadRaw"),
  btnPin: document.getElementById("btnPin"),
  map: document.getElementById("map"),
  mapMeta: document.getElementById("mapMeta"),

  cFrom: document.getElementById("cFrom"),
  cTo: document.getElementById("cTo"),
  cKind: document.getElementById("cKind"),
  cPri: document.getElementById("cPri"),
  cTitle: document.getElementById("cTitle"),
  cBody: document.getElementById("cBody"),
  btnQueueOutbox: document.getElementById("btnQueueOutbox"),
  btnCopyRaw: document.getElementById("btnCopyRaw"),
  composeMeta: document.getElementById("composeMeta"),
};

let state = {
  tab: "inbox",
  selectedId: null,
  vault: { meta:{ created:new Date().toISOString() }, inbox:[], outbox:[], log:[] }
};

function setMeta(){
  const bytes = new TextEncoder().encode(JSON.stringify(state.vault)).length;
  els.meta.textContent = `vault: ${humanBytes(bytes)} • inbox ${state.vault.inbox.length} • outbox ${state.vault.outbox.length} • log ${state.vault.log.length}`;
}

function saveVault(){
  localStorage.setItem(VAULT_KEY, JSON.stringify(state.vault));
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
  // remove any existing
  for (let i=list.length-1; i>=0; i--){
    if (list[i] && list[i].id === id) list.splice(i,1);
  }
  list.unshift(item);
  // cap to keep it light
  if (list.length > 200) list.length = 200;
}

function renderList(items){
  const arr = items.slice().sort(sortDet);
  if (!arr.length){
    els.list.innerHTML = `<div class="small muted">No items.</div>`;
    return;
  }
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
  els.inspector.innerHTML = safeInspector(e);
  els.raw.value = JSON.stringify(e, null, 2);
  drawMap(); // update highlight context
}

function pinById(id){
  const e0 = findById(id);
  if (!e0) return;
  const e = normalizeEnv(e0);
  upsertFront(state.vault.log, e);
    saveVault();
  drawMap();
}

async function loadDemo(){
  const url = "/.well-known/ams-demo-log.jsonl?cb=" + Date.now();
  const r = await fetch(url, { cache:"no-store" });
  const t = await r.text();
  const lines = t.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const events = [];
  for (const ln of lines){
    const obj = safeJson(ln, null);
    const e = normalizeEnv(obj);
    if (e && e.id) events.push(e);
  }
  // heuristics: receipts+alerts go inbox, others to log
  state.vault.inbox = events.filter(e=>["receipt","alert"].includes(e.kind));
  state.vault.log = events.filter(e=>!["receipt","alert"].includes(e.kind));
  // keep outbox untouched
  saveVault();
  renderCurrent();
  drawMap();
}

function setTab(tab){
  state.tab = tab;
  document.querySelectorAll(".amsTabs .btn").forEach(b=>{
    const t = b.getAttribute("data-tab");
    b.classList.toggle("active", t===tab);
  });
  renderCurrent();
}

function renderCurrent(){
  const tab = state.tab;
  els.panelTitle.textContent = tab.charAt(0).toUpperCase()+tab.slice(1);

  if (tab==="inbox"){
    els.panelHint.textContent = "Deterministic list (priority → time → id).";
    renderList(state.vault.inbox);
    return;
  }
  if (tab==="outbox"){
    els.panelHint.textContent = "Queued envelopes (local-only).";
    renderList(state.vault.outbox);
    return;
  }
  if (tab==="vault"){
    els.panelHint.textContent = "Pinned items (append-only log).";
    renderList(state.vault.log);
    return;
  }
  if (tab==="threads"){
    els.panelHint.textContent = "Grouped by thread.root (causal chains).";
    renderThreads();
    return;
  }
  if (tab==="map"){
    els.panelHint.textContent = "Signal density map (agents/topics).";
    renderMapPanel();
    return;
  }
  if (tab==="quorum"){
    els.panelHint.textContent = "Quorum rooms inferred from topic:quorum/* messages.";
    renderQuorum();
    return;
  }
  if (tab==="policy"){
    els.panelHint.textContent = "Policy lens (score/tags/reasons) across vault.";
    renderPolicy();
    return;
  }
}

function renderThreads(){
  const all = [...state.vault.inbox, ...state.vault.outbox, ...state.vault.log].map(normalizeEnv).filter(Boolean);
  const byRoot = new Map();
  for (const e of all){
    const root = e.thread?.root || "—";
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(e);
  }
  const roots = [...byRoot.keys()].sort((a,b)=>String(a).localeCompare(String(b)));
  if (!roots.length){ els.list.innerHTML = `<div class="small muted">No threads.</div>`; return; }

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
  if (!q.length){ els.list.innerHTML = `<div class="small muted">No quorum messages found.</div>`; return; }
  // group by quorum topic
  const byTopic = new Map();
  for (const e of q){
    const t = (e.to||[]).find(x=>String(x).startsWith("topic:quorum/")) || "topic:quorum/—";
    if (!byTopic.has(t)) byTopic.set(t, []);
    byTopic.get(t).push(e);
  }
  const topics = [...byTopic.keys()].sort((a,b)=>String(a).localeCompare(String(b)));
  els.list.innerHTML = topics.map(t=>{
    const items = byTopic.get(t).slice().sort(sortDet);
    const votes = items.filter(x=>x.payload?.title?.toLowerCase().includes("vote")).length;
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
  if (!all.length){ els.list.innerHTML = `<div class="small muted">No policy data.</div>`; return; }
  // aggregate tags
  const tagCount = new Map();
  for (const e of all){
    for (const t of (e.policy?.tags||[])){
      tagCount.set(t, (tagCount.get(t)||0)+1);
    }
  }
  const tags = [...tagCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0,40);

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

async function sha256Hex(str){
  const data = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

async function makeEnvelope(){
  const from = (els.cFrom.value||"agent:you").trim() || "agent:you";
  const to = (els.cTo.value||"topic:ams").split(",").map(x=>x.trim()).filter(Boolean);
  const kind = (els.cKind.value||"note").trim();
  const priority = Math.max(0, Math.min(999, parseInt(els.cPri.value||"50",10)));
  const title = (els.cTitle.value||"").trim() || "(untitled)";
  const body = (els.cBody.value||"").toString();

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

function wireCompose(){
  els.btnQueueOutbox?.addEventListener("click", async ()=>{
    const env = await makeEnvelope();
    state.vault.outbox.unshift(env);
    saveVault();
    els.composeMeta.textContent = "queued: " + env.id;
    openById(env.id);
    setTab("outbox");
  });

  els.btnCopyRaw?.addEventListener("click", async ()=>{
    const env = await makeEnvelope();
    const raw = JSON.stringify(env, null, 2);
    await copyToClipboard(raw);
    els.composeMeta.textContent = "copied";
    els.raw.value = raw;
    els.inspector.innerHTML = safeInspector(env);
  });
}

function wireInspector(){
  els.btnDownloadRaw?.addEventListener("click", ()=>{
    const txt = els.raw.value || "";
    const obj = safeJson(txt, null);
    const name = (obj && obj.id) ? (`ams_${obj.id}.json`) : "ams_envelope.json";
    downloadText(name, txt);
  });
  els.btnPin?.addEventListener("click", ()=>{
    const obj = safeJson(els.raw.value, null);
    const e = normalizeEnv(obj);
    if (!e || !e.id) return alert("Invalid envelope JSON");
    upsertFront(state.vault.log, e);
    saveVault();
    drawMap();
    alert("Pinned to Vault");
  });
}

function wireTabs(){
  document.querySelectorAll(".amsTabs .btn").forEach(b=>{
    b.addEventListener("click", ()=> setTab(b.getAttribute("data-tab")));
  });
}

async function exportVault(){
  downloadText("onetoo_ams_vault.json", JSON.stringify(state.vault, null, 2));
}

async function importFile(f){
  const text = await f.text();
  // if jsonl -> lines
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
  // vault json
  if (obj.inbox && obj.outbox && obj.log){
    state.vault = obj;
    saveVault();
    renderCurrent();
    drawMap();
    return;
  }
  // single envelope json
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
  els.btnLoadDemo?.addEventListener("click", loadDemo);
  els.btnExportVault?.addEventListener("click", exportVault);
  els.btnClearVault?.addEventListener("click", ()=>{
    if (!confirm("Clear AMS vault (localStorage)?")) return;
    state.vault = { meta:{ created:new Date().toISOString() }, inbox:[], outbox:[], log:[] };
    saveVault();
    renderCurrent();
    drawMap();
    els.raw.value = "";
    els.inspector.innerHTML = "";
  });
  els.inImport?.addEventListener("change", async (e)=>{
    const f = e.target.files?.[0];
    if (!f) return;
    try { await importFile(f); }
    catch(err){ alert(String(err.message||err)); }
    e.target.value = "";
  });
}

function drawMap(){
  const c = els.map;
  if (!c) return;
  const ctx = c.getContext("2d");
  const w = c.width = c.clientWidth * devicePixelRatio;
  const h = c.height = c.clientHeight * devicePixelRatio;
  ctx.clearRect(0,0,w,h);

  const all = [...state.vault.inbox, ...state.vault.outbox, ...state.vault.log].map(normalizeEnv).filter(Boolean);

  // build node counts: agents + topics
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
    els.mapMeta.textContent = "—";
    ctx.font = `${14*devicePixelRatio}px sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,.65)";
    ctx.fillText("No signals yet.", 16*devicePixelRatio, 28*devicePixelRatio);
    return;
  }

  // place nodes on circle
  const cx = w/2, cy = h/2, R = Math.min(w,h)*0.34;
  const pos = new Map();
  keys.forEach((k,i)=>{
    const a = (Math.PI*2*i)/keys.length;
    pos.set(k, { x: cx + R*Math.cos(a), y: cy + R*Math.sin(a) });
  });

  // edges from->to
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

  // draw nodes
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

  // meta
  const total = all.length;
  const kinds = new Map();
  for (const e of all) kinds.set(e.kind, (kinds.get(e.kind)||0)+1);
  const topKinds = [...kinds.entries()].sort((a,b)=>b[1]-a[1]).slice(0,4).map(([k,n])=>`${k}:${n}`).join(" ");
  els.mapMeta.textContent = `signals: ${total} • nodes: ${keys.length} • ${topKinds || "—"}`;
}

function init(){
  loadVault();
  wireTabs();
  wireCompose();
  wireInspector();
  wireVaultControls();
  setTab("inbox");
  drawMap();
}

init();




/* --- Gateway + Quorum (mock) --- */
function lsGet(key, fallback=null){ try{ return JSON.parse(localStorage.getItem(key)||""); }catch{ return fallback; } }
function lsSet(key, obj){ localStorage.setItem(key, JSON.stringify(obj)); }

function nowIso(){ return new Date().toISOString(); }

function env(kind, from, toArr, payload, extra={}){
  return {
    v: "ams-envelope-0.2",
    id: "mock-" + kind + "-" + Math.random().toString(16).slice(2),
    ts: nowIso(),
    from, to: toArr,
    kind,
    priority: extra.priority ?? 10,
    thread: extra.thread ?? { root: extra.root ?? null, prev: extra.prev ?? null },
    payload,
    policy: extra.policy ?? { score: 50, tags:["mock"], reasons:["local-only mock"] },
    proofs: extra.proofs ?? [{type:"mock", note:"no signature"}]
  };
}

async function loadGatewaySpec(){
  const out = document.getElementById("gwOut");
  const badge = document.getElementById("gwState");
  out.textContent = "Loading spec…";
  try{
    const r = await fetch("/.well-known/ams-gateway-spec.json", { cache:"no-store" });
    const t = await r.text();
    out.textContent = t;
    badge.textContent = "disabled (spec loaded)";
  }catch(e){
    out.textContent = String(e?.message||e);
    badge.textContent = "error";
  }
}

function toggleMockGateway(){
  const key = "onetoo_ams_gateway_mock";
  const cur = localStorage.getItem(key) === "1";
  const next = !cur;
  localStorage.setItem(key, next ? "1" : "0");
  const badge = document.getElementById("gwState");
  badge.textContent = next ? "mock enabled" : "disabled";
}

function quorumKey(room){ return "onetoo_ams_quorum:" + room; }
function quorumLoad(room){
  return lsGet(quorumKey(room), { room, threshold:"2-of-3", proposal:null, votes:[], decided:false, decision:null });
}
function quorumSave(room, st){ lsSet(quorumKey(room), st); }

function quorumRender(st){
  const out = document.getElementById("qOut");
  out.textContent = JSON.stringify(st, null, 2);
  document.getElementById("qState").textContent = st.decided ? "decided" : st.proposal ? "active" : "idle";
}

function quorumComputeDecision(st){
  const yes = st.votes.filter(v=>v.choice==="yes").length;
  const no = st.votes.filter(v=>v.choice==="no").length;
  // parse "2-of-3" → 2
  const need = parseInt(String(st.threshold).split("-of-")[0], 10) || 2;
  const result = yes >= need ? "accepted" : (no >= need ? "rejected" : "undecided");
  return { yes, no, need, result };
}


function wireGatewayAndQuorum(){
  // ===== Gateway (ONLINE MODE) =====
  const el = (id)=>document.getElementById(id);
  const gwUrl = el("gwUrl");
  const gwKey = el("gwKey");
  const outEl = el("gwOut");
  const btnLoadSpec = el("gwLoadSpec");
  const btnMock = el("gwMockToggle");
  const btnHealth = el("gwHealth");
  const btnPull = el("gwPull");
  const btnPush = el("gwPush");
  const btnListInbox = el("gwListInbox");
  const btnListThreads = el("gwListThreads");
  const btnListArtifacts = el("gwListArtifacts");
  const btnListNotary = el("gwListNotary");
  const btnAudit = el("gwAudit");
  const btnSend = el("gwSend");
  const btnQueueLocal = el("gwQueueLocal");
  const btnRoomSend = el("gwRoomSend");
  const btnRoomRead = el("gwRoomRead");
  const btnNotaryCreate = el("gwNotaryCreate");
  const btnPolicy = el("gwPolicy");
  const policyOut = el("gwPolicyOut");
  const listBox = el("gwListBox");
  const artifactsBox = el("gwArtifactsBox");

  const KEY = "ams_gateway_state_v1";

  function logOut(obj){
    if(!outEl) return;
    const txt = (typeof obj === "string") ? obj : JSON.stringify(obj, null, 2);
    outEl.textContent = txt;
  }

  function load(){
    try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
  }
  function save(st){
    localStorage.setItem(KEY, JSON.stringify(st));
  }
  function normalizeBase(u){
    if(!u) return (location.origin + "/ams/v1");
    if(u.startsWith("/")) return location.origin + u;
    if(!/^https?:\/\//i.test(u)) return location.origin + "/" + u.replace(/^\/+/, "");
    return u.replace(/\/+$/,"");
  }
  function stNow(){
    const st = load();
    st.base = normalizeBase(st.base || "/ams/v1");
    st.token = st.token || "";
    st.mock = !!st.mock;
    return st;
  }
  function apply(st){
    if(gwUrl) gwUrl.value = st.base || "";
    if(gwKey) gwKey.value = st.token || "";
    if(btnMock) btnMock.textContent = "Mock: " + (st.mock ? "ON" : "OFF");
  }
  async function fetchJson(url, init={}){
    const st = stNow();
    if(st.mock){
      // mock mode: no server calls (minimal simulation)
      return { ok:true, mock:true, url, note:"Mock mode is enabled. No network request performed." };
    }
    const headers = new Headers(init.headers || {});
    headers.set("accept", "application/json");
    if(init.json){
      headers.set("content-type", "application/json");
      init.body = JSON.stringify(init.json);
      delete init.json;
    }
    const tok = st.token || "";
    if(tok && !headers.has("authorization")) headers.set("authorization", "Bearer " + tok);
    const res = await fetch(url, { ...init, headers, cf: { cacheTtl: 0 }});
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw:text }; }
    if(!res.ok){
      throw Object.assign(new Error("HTTP " + res.status), { status: res.status, data });
    }
    return data;
  }
  function api(path){
    const st = stNow();
    const base = normalizeBase(st.base || "/ams/v1");
    return base.replace(/\/+$/,"") + "/" + String(path || "").replace(/^\/+/,"");
  }

  function renderMiniList(target, items, pick){
    if(!target) return;
    if(!items || !items.length){ target.innerHTML = '<div class="muted">empty</div>'; return; }
    target.innerHTML = items.slice(0,20).map((x)=>{
      const t = pick(x);
      return `<div style="padding:.35rem .25rem;border-bottom:1px dashed rgba(0,0,0,.08)"><code>${escapeHtml(t)}</code></div>`;
    }).join("");
  }

  async function loadSpec(){
    const st = stNow();
    const specUrl = location.origin + "/.well-known/ams-gateway-spec.json";
    try{
      const spec = await fetchJson(specUrl, { method:"GET" });
      // Prefer our canonical base:
      st.base = location.origin + "/ams/v1";
      save(st); apply(st);
      logOut({ ok:true, loaded_spec_from: specUrl, applied_base: st.base, spec });
    }catch(e){
      logOut({ ok:false, error: String(e.message||e), detail: e.data||null });
    }
  }

  async function health(){
    try{
      const data = await fetchJson(api("health"), { method:"GET" });
      logOut(data);
    }catch(e){
      logOut({ ok:false, error: String(e.message||e), detail: e.data||null });
    }
  }

  async function listEnvelopes(){
    try{
      const data = await fetchJson(api("envelopes?limit=50"), { method:"GET" });
      logOut(data);
      renderMiniList(listBox, data.items || [], (e)=>`${e.updated_at || e.created_at || ""} :: ${e.type} :: ${e.id}`);
    }catch(e){
      logOut({ ok:false, error: String(e.message||e), detail: e.data||null });
    }
  }

  async function listThreads(){
    try{
      const data = await fetchJson(api("threads?limit=50"), { method:"GET" });
      logOut(data);
    }catch(e){
      logOut({ ok:false, error: String(e.message||e), detail: e.data||null });
    }
  }

  async function listArtifacts(){
    try{
      const data = await fetchJson(api("artifacts?limit=50"), { method:"GET" });
      logOut(data);
      renderMiniList(artifactsBox, data.items || [], (a)=>`${a.ts_updated || ""} :: ${a.key} :: ${a.sha256?.slice(0,10)}`);
    }catch(e){
      logOut({ ok:false, error: String(e.message||e), detail: e.data||null });
    }
  }

  async function listNotary(){
    try{
      const data = await fetchJson(location.origin + "/notary/v1/records?limit=50", { method:"GET" });
      logOut(data);
    }catch(e){
      logOut({ ok:false, error: String(e.message||e), detail: e.data||null });
    }
  }

  async function audit(){
    try{
      const data = await fetch(location.origin + "/audit/v1/events.ndjson?limit=200", {
        headers: (()=>{
          const st = stNow();
          const h = new Headers({ "accept":"application/x-ndjson" });
          if(st.token) h.set("authorization", "Bearer " + st.token);
          return h;
        })(),
        cf:{ cacheTtl:0 }
      });
      const txt = await data.text();
      logOut(txt);
    }catch(e){
      logOut({ ok:false, error: String(e.message||e) });
    }
  }

  async function pull(){
    // Pull latest envelopes (public). For real inbox filtering, pass ?to=<entityId>.
    await listEnvelopes();
  }

  async function pushLocal(){
    const st = stNow();
    if(st.mock){ logOut({ ok:true, mock:true, note:"Mock push. Nothing sent."}); return; }

    const queued = (state && state.vault && Array.isArray(state.vault.outbox)) ? state.vault.outbox : [];
    if(!queued.length){ logOut({ ok:true, note:"Local outbox is empty."}); return; }

    const push = queued.slice(0, 50).map((e)=>{
      // best-effort normalize
      return {
        id: e.id || ("env_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16)),
        type: e.type || e.kind || "notice",
        from: e.from || e.sender || null,
        to: e.to || e.recipient || null,
        thread: e.thread || e.thread_id || null,
        status: e.status || "queued",
        payload: e.payload || e.body || e.data || {},
        meta: e.meta || {}
      };
    });

    try{
      const resp = await fetchJson(api("sync"), { method:"POST", json: { pull:false, push } });
      logOut(resp);

      // Mark local items as "sent" (non-destructive: we keep them, just flag)
      const acceptedIds = new Set((resp.accepted || []).map(x=>x.id));
      for(const e of queued){
        if(acceptedIds.has(e.id)){
          e.status = "sent";
          e.meta = e.meta || {};
          e.meta.gateway = e.meta.gateway || {};
          e.meta.gateway.sent_at = new Date().toISOString();
        }
      }
      saveVault();
    }catch(e){
      logOut({ ok:false, error: String(e.message||e), detail: e.data||null });
    }
  }

  async function sendOnline(){
    const type = (el("gwComposeType")?.value || "notice").trim();
    const thread = (el("gwComposeThread")?.value || "").trim() || null;
    const from = (el("gwComposeFrom")?.value || "").trim() || null;
    const to = (el("gwComposeTo")?.value || "").trim() || null;
    const payloadRaw = el("gwComposePayload")?.value || "{}";
    let payload = {};
    try { payload = JSON.parse(payloadRaw || "{}"); } catch (e) { return alert("Payload must be valid JSON: " + e.message); }

    try{
      const data = await fetchJson(api("envelopes"), { method:"POST", json: { type, thread, from, to, payload, meta:{ ui:"ams.html", mode:"online" } } });
      logOut(data);
      await listEnvelopes();
    }catch(e){
      logOut({ ok:false, error: String(e.message||e), detail: e.data||null });
    }
  }

  function queueLocal(){
    const type = (el("gwComposeType")?.value || "notice").trim();
    const thread = (el("gwComposeThread")?.value || "").trim() || null;
    const from = (el("gwComposeFrom")?.value || "").trim() || null;
    const to = (el("gwComposeTo")?.value || "").trim() || null;
    const payloadRaw = el("gwComposePayload")?.value || "{}";
    let payload = {};
    try { payload = JSON.parse(payloadRaw || "{}"); } catch (e) { return alert("Payload must be valid JSON: " + e.message); }

    const envl = {
      id: ("env_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16)),
      type,
      from,
      to,
      thread,
      status: "queued",
      payload,
      meta: { ui:"ams.html", mode:"offline", queued_at: new Date().toISOString() }
    };
    state.vault.outbox = state.vault.outbox || [];
    state.vault.outbox.unshift(envl);
    state.vault.log = state.vault.log || [];
    state.vault.log.unshift({ ts: new Date().toISOString(), kind:"outbox.queue", id: envl.id, type: envl.type });
    saveVault();
    logOut({ ok:true, queued_local: envl });
  }

  async function roomSend(){
    const room = (el("gwRoomName")?.value || "lobby").trim() || "lobby";
    const from = (el("gwRoomFrom")?.value || "").trim() || null;
    const body = (el("gwRoomBody")?.value || "").trim();
    try{
      const data = await fetchJson(location.origin + "/room/v1/messages?room=" + encodeURIComponent(room), {
        method:"POST",
        json: { from, kind:"text", body: { text: body } }
      });
      logOut(data);
    }catch(e){
      logOut({ ok:false, error: String(e.message||e), detail: e.data||null });
    }
  }

  async function roomRead(){
    const room = (el("gwRoomName")?.value || "lobby").trim() || "lobby";
    try{
      const data = await fetchJson(location.origin + "/room/v1/messages?room=" + encodeURIComponent(room) + "&limit=100", {
        method:"GET"
      });
      logOut(data);
    }catch(e){
      logOut({ ok:false, error: String(e.message||e), detail: e.data||null });
    }
  }

  async function notaryCreate(){
    const subject = (el("gwNotarySubject")?.value || "").trim();
    const sha = (el("gwNotarySha")?.value || "").trim();
    const metaRaw = (el("gwNotaryMeta")?.value || "{}");
    let meta = {};
    try{ meta = JSON.parse(metaRaw || "{}"); } catch(e){ return alert("Meta must be valid JSON: " + e.message); }
    try{
      const data = await fetchJson(location.origin + "/notary/v1/records", {
        method:"POST",
        json: { kind:"artifact", subject, sha256: sha, meta }
      });
      logOut(data);
    }catch(e){
      logOut({ ok:false, error: String(e.message||e), detail: e.data||null });
    }
  }

  async function loadPolicy(){
    try{
      const data = await fetchJson(api("policy"), { method:"GET" });
      if(policyOut) policyOut.textContent = JSON.stringify(data.policy || data, null, 2);
      else logOut(data);
    }catch(e){
      logOut({ ok:false, error: String(e.message||e), detail: e.data||null });
    }
  }

  // Persist inputs
  if(gwUrl){
    gwUrl.addEventListener("change", ()=>{
      const st = stNow();
      st.base = gwUrl.value.trim();
      save(st);
      apply(st);
    });
  }
  if(gwKey){
    gwKey.addEventListener("change", ()=>{
      const st = stNow();
      st.token = gwKey.value.trim();
      save(st);
      apply(st);
    });
  }

  btnLoadSpec && (btnLoadSpec.onclick = loadSpec);
  btnHealth && (btnHealth.onclick = health);
  btnPull && (btnPull.onclick = pull);
  btnPush && (btnPush.onclick = pushLocal);
  btnListInbox && (btnListInbox.onclick = listEnvelopes);
  btnListThreads && (btnListThreads.onclick = listThreads);
  btnListArtifacts && (btnListArtifacts.onclick = listArtifacts);
  btnListNotary && (btnListNotary.onclick = listNotary);
  btnAudit && (btnAudit.onclick = audit);
  btnSend && (btnSend.onclick = sendOnline);
  btnQueueLocal && (btnQueueLocal.onclick = queueLocal);
  btnRoomSend && (btnRoomSend.onclick = roomSend);
  btnRoomRead && (btnRoomRead.onclick = roomRead);
  btnNotaryCreate && (btnNotaryCreate.onclick = notaryCreate);
  btnPolicy && (btnPolicy.onclick = loadPolicy);

  btnMock && (btnMock.onclick = ()=>{
    const st = stNow();
    st.mock = !st.mock;
    save(st);
    apply(st);
    logOut({ ok:true, mock: st.mock });
  });

  // init
  const st0 = stNow();
  apply(st0);
  // Load policy preview on first open
  policyOut && (policyOut.textContent = "");
  listEnvelopes().catch(()=>{});

  // ===== QUORUM / CONSENSUS (unchanged mock) =====
  const qInfo = el("quorumInfo");
  const btnAdd = el("qAddPeer");
  const btnProp = el("qPropose");
  const btnYes = el("qVoteYes");
  const btnNo = el("qVoteNo");
  const btnDecide = el("qDecide");
  const btnReset = el("qReset");

  function qLoad(){
    try { return JSON.parse(localStorage.getItem("ams_quorum_state_v1") || "{}"); } catch { return {}; }
  }
  function qSave(st){
    localStorage.setItem("ams_quorum_state_v1", JSON.stringify(st));
    renderQuorum(st, qInfo);
  }
  function getRoom(){
    return (document.getElementById("qRoom")?.value || "room:demo").trim();
  }
  function env(kind, from, toArr, payload, thread){
    return envDefault(kind, from, toArr, payload, thread);
  }

  btnAdd && (btnAdd.onclick = ()=>{
    const host = (document.getElementById("qPeerHost")?.value || "").trim();
    if(!host) return alert("peer host required");
    const st = qLoad();
    st.peers = st.peers || [];
    if(!st.peers.includes(host)) st.peers.push(host);
    qSave(st);
  });

  btnProp && (btnProp.onclick = ()=>{
    const st = qLoad();
    st.threshold = parseInt(document.getElementById("qThreshold")?.value || "2",10) || 2;
    st.votes = [];
    st.decided = false;
    st.proposal = env("proposal", "agent:conductor", [getRoom()], {
      title: (document.getElementById("qTitle")?.value || "Proposal").trim(),
      body: (document.getElementById("qBody")?.value || "Demo body").trim()
    });
    qSave(st);
  });

  btnYes && (btnYes.onclick = ()=>{
    const st = qLoad();
    if(!st.proposal) return alert("Create proposal first");
    st.votes = st.votes || [];
    st.votes.push(env("vote","agent:reviewer",[getRoom()],{ choice:"yes" }, { root: st.proposal.thread.root, prev: st.votes.at(-1)?.id || st.proposal.id }));
    qSave(st);
  });

  btnNo && (btnNo.onclick = ()=>{
    const st = qLoad();
    if(!st.proposal) return alert("Create proposal first");
    st.votes = st.votes || [];
    st.votes.push(env("vote","agent:reviewer",[getRoom()],{ choice:"no" }, { root: st.proposal.thread.root, prev: st.votes.at(-1)?.id || st.proposal.id }));
    qSave(st);
  });

  btnDecide && (btnDecide.onclick = ()=>{
    const st = qLoad();
    if(!st.proposal) return alert("Create proposal first");
    const d = quorumComputeDecision(st);
    st.decision = env("decision","agent:conductor",[getRoom()],{
      threshold: st.threshold,
      tally: d,
      result: d.result,
      proposal_id: st.proposal.id,
      votes: (st.votes||[]).map(v=>({id:v.id, choice:v.payload?.choice}))
    }, { root: st.proposal.thread.root, prev: st.votes.at(-1)?.id || st.proposal.id, policy:{score:90,tags:["decision","quorum"],reasons:["mock deterministic decision"]} });
    st.decided = (d.result !== "undecided");
    qSave(st);
  });

  btnReset && (btnReset.onclick = ()=>{
    localStorage.removeItem("ams_quorum_state_v1");
    renderQuorum({}, qInfo);
  });

  // initial render
  renderQuorum(qLoad(), qInfo);
}


document.addEventListener("DOMContentLoaded", wireGatewayAndQuorum);





/* ============================
   AMS_PANEL_ROUTER_V1
   Shows special panels: gateway/quorum
   without touching existing list renderer.
============================ */
function __amsRoutePanels(tab){
  const panels = Array.from(document.querySelectorAll("section.panel[data-panel]"));
  for (const p of panels){
    p.style.display = (p.dataset.panel === tab) ? "block" : "none";
  }

  // Hide main AMS grid when opening special panels
  const grid = document.querySelector(".amsGrid");
  if (grid){
    grid.style.display = (tab === "gateway" || tab === "quorum") ? "none" : "";
  }

  // Smooth scroll to panel if opened
  if (tab === "gateway"){
    const el = document.getElementById("panelGateway");
    el && el.scrollIntoView({ behavior:"smooth", block:"start" });
  }
  if (tab === "quorum"){
    const el = document.getElementById("panelQuorum");
    el && el.scrollIntoView({ behavior:"smooth", block:"start" });
  }
}

// Lightweight hook: runs alongside existing tab logic
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".amsTabs [data-tab]");
  if (!btn) return;
  __amsRoutePanels(btn.dataset.tab);
});

// On load: ensure special panels are hidden
document.addEventListener("DOMContentLoaded", () => {
  const active = document.querySelector(".amsTabs .active")?.dataset?.tab || "inbox";
  __amsRoutePanels(active);
});

(() => {
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
