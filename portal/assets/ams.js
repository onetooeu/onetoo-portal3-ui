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
  const gwLoad = document.getElementById("gwLoadSpec");
  const gwMock = document.getElementById("gwMockToggle");
  gwLoad && (gwLoad.onclick = loadGatewaySpec);
  gwMock && (gwMock.onclick = toggleMockGateway);

  const qRoom = document.getElementById("qRoom");
  const qThresh = document.getElementById("qThresh");
  const btnP = document.getElementById("qNewProposal");
  const btnY = document.getElementById("qVoteYes");
  const btnN = document.getElementById("qVoteNo");
  const btnD = document.getElementById("qDecide");

  function getRoom(){ return (qRoom?.value||"room:core").trim(); }

  function load(){
    const room = getRoom();
    const st = quorumLoad(room);
    st.threshold = (qThresh?.value||st.threshold);
    quorumRender(st);
    return st;
  }
  function save(st){
    const room = getRoom();
    st.threshold = (qThresh?.value||st.threshold);
    quorumSave(room, st);
    quorumRender(st);
  }

  btnP && (btnP.onclick = ()=>{
    const st = load();
    const root = "q-" + Math.random().toString(16).slice(2);
    st.proposal = env("proposal","agent:composer",[getRoom()],{ title:"Proposal", body:"Describe desired action / change." }, { root, thread:{root,prev:null}, policy:{score:80,tags:["proposal","quorum"],reasons:["mock proposal"]} });
    st.votes = [];
    st.decided = false;
    st.decision = null;
    save(st);
  });

  btnY && (btnY.onclick = ()=>{
    const st = load();
    if (!st.proposal) return alert("Create proposal first");
    st.votes.push(env("vote","agent:reviewer",[getRoom()],{ choice:"yes" }, { root: st.proposal.thread.root, prev: st.votes.at(-1)?.id || st.proposal.id }));
    save(st);
  });

  btnN && (btnN.onclick = ()=>{
    const st = load();
    if (!st.proposal) return alert("Create proposal first");
    st.votes.push(env("vote","agent:reviewer",[getRoom()],{ choice:"no" }, { root: st.proposal.thread.root, prev: st.votes.at(-1)?.id || st.proposal.id }));
    save(st);
  });

  btnD && (btnD.onclick = ()=>{
    const st = load();
    if (!st.proposal) return alert("Create proposal first");
    const d = quorumComputeDecision(st);
    st.decision = env("decision","agent:conductor",[getRoom()],{
      threshold: st.threshold,
      tally: d,
      result: d.result,
      proposal_id: st.proposal.id,
      votes: st.votes.map(v=>({id:v.id, choice:v.payload?.choice}))
    }, { root: st.proposal.thread.root, prev: st.votes.at(-1)?.id || st.proposal.id, policy:{score:90,tags:["decision","quorum"],reasons:["mock deterministic decision"]} });
    st.decided = (d.result !== "undecided");
    save(st);
  });

  // initial render
  load();
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

