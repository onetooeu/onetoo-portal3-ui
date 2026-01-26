export interface Env {
  TRUST_ROOT_BASE: string;
  SEARCH_RUNTIME_BASE: string;
  ACCEPTED_SET_PATH: string;
  CORS_ALLOW_ORIGIN: string;
  CACHE_TTL_SECONDS?: string;
}

type Json = Record<string, unknown>;

const JSON_HEADERS: Record<string,string> = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function cors(env: Env): Record<string,string> {
  return {
    "access-control-allow-origin": env.CORS_ALLOW_ORIGIN || "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function json(env: Env, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2) + "\n", { status, headers: { ...JSON_HEADERS, ...cors(env) }});
}

function norm(x: unknown): string {
  return String(x || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// deterministic id: kind|url|title → FNV-1a 32-bit (same as portal)
function stableId(it: any): string {
  const s = `${norm(it?.kind)}|${norm(it?.url)}|${norm(it?.title)}`;
  let h = 2166136261;
  for (let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  const hex = (h >>> 0).toString(16);
  return ("id_" + hex).padEnd(11, "0");
}

function scoreItem(it: any, q: string): number {
  let score = 0;
  const qq = norm(q);

  if (norm(it?.title).includes(qq)) score += 5;
  if (norm(it?.description).includes(qq)) score += 3;
  if (Array.isArray(it?.topics) && it.topics.map(norm).includes(qq)) score += 4;
  if (Array.isArray(it?.languages) && it.languages.map(norm).includes(qq)) score += 1;
  if (norm(it?.url).includes(qq)) score += 1;

  return score;
}

function acceptedUrl(env: Env): string {
  const base = (env.TRUST_ROOT_BASE || "https://www.onetoo.eu").replace(/\/$/, "");
  const path = (env.ACCEPTED_SET_PATH || "/public/dumps/contrib-accepted.json");
  return base + (path.startsWith("/") ? path : "/" + path);
}

async function fetchJsonUpstream(url: string, cf: any): Promise<{ ok:boolean; status:number; data:any; }> {
  const resp = await fetch(url, { headers: { accept: "application/json" }, cf });
  const status = resp.status;
  let data: any = null;
  try { data = await resp.json(); } catch { data = null; }
  return { ok: resp.ok, status, data };
}

async function handleAccepted(request: Request, env: Env): Promise<Response> {
  const ttl = Math.max(1, Math.min(3600, parseInt(env.CACHE_TTL_SECONDS || "60", 10) || 60));
  const url = acceptedUrl(env);
  const r = await fetchJsonUpstream(url, { cacheTtl: ttl, cacheEverything: true });
  if (!r.ok) return json(env, 502, { ok:false, error:"upstream_fetch_failed", status:r.status, url });

  const items = Array.isArray(r.data?.items) ? r.data.items : [];
  // normalize: add stable ids (non-authoritative helper)
  const normalized = items.map((it: any) => ({ ...it, _id: stableId(it) }));
  return json(env, 200, {
    ok: true,
    source: url,
    meta: {
      schema: r.data?.schema || null,
      version: r.data?.version || null,
      updated_at: r.data?.updated_at || null,
      lane: r.data?.lane || null,
      note: r.data?.note || null,
      total_items: normalized.length,
      cache_ttl_seconds: ttl,
    },
    items: normalized,
  });
}

async function handleEntity(request: Request, env: Env, id: string): Promise<Response> {
  const acc = await handleAccepted(request, env);
  const body = await acc.json().catch(()=>null);
  const items = Array.isArray(body?.items) ? body.items : [];
  const match = items.find((it: any) => it?._id === id) || null;
  if (!match) return json(env, 404, { ok:false, error:"not_found", id });
  return json(env, 200, { ok:true, id, entity: match });
}

async function handleSearch(request: Request, env: Env, url: URL): Promise<Response> {
  const q = (url.searchParams.get("q") || "").trim();
  const limitRaw = parseInt(url.searchParams.get("limit") || "10", 10);
  const limit = Math.max(1, Math.min(50, Number.isFinite(limitRaw) ? limitRaw : 10));

  // Prefer proxying real runtime (single source of truth)
  const runtimeBase = (env.SEARCH_RUNTIME_BASE || "https://search.onetoo.eu").replace(/\/$/, "");
  const target = runtimeBase + "/search/v1?q=" + encodeURIComponent(q) + "&limit=" + encodeURIComponent(String(limit));
  const ttl = Math.max(1, Math.min(300, parseInt(env.CACHE_TTL_SECONDS || "60", 10) || 60));

  const resp = await fetch(target, { headers: { accept:"application/json" }, cf: { cacheTtl: ttl, cacheEverything: true } });
  const text = await resp.text();
  let data:any = null;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!resp.ok) return json(env, 502, { ok:false, error:"runtime_proxy_failed", status: resp.status, target, body: text.slice(0,1000) });

  // Attach helper stable ids to results (non-authoritative)
  const results = Array.isArray(data?.results) ? data.results : [];
  const withIds = results.map((r:any)=>({ ...r, _id: stableId(r) }));

  return json(env, 200, {
    ...data,
    meta: { ...(data?.meta||{}), proxied_via: "portal-edge", cache_ttl_seconds: ttl, target },
    results: withIds,
  });
}

async function handleExplain(request: Request, env: Env, url: URL): Promise<Response> {
  const q = (url.searchParams.get("q") || "").trim();
  const id = (url.searchParams.get("id") || "").trim();
  if (!q || !id) return json(env, 400, { ok:false, error:"missing_params", required:["q","id"] });

  const entResp = await handleEntity(request, env, id);
  const entBody = await entResp.json().catch(()=>null);
  if (!entResp.ok) return json(env, 404, { ok:false, error:"entity_not_found", id });

  const it = entBody?.entity;
  const qq = norm(q);
  const expl = {
    ok: true,
    id,
    q: qq,
    total: 0,
    rules: [] as any[],
  };

  const add = (points:number, why:string, ok:boolean) => {
    expl.rules.push({ points, why, ok: !!ok });
    if (ok) expl.total += points;
  };

  const title = norm(it?.title);
  const desc = norm(it?.description);
  const u = norm(it?.url);
  const topics = Array.isArray(it?.topics) ? it.topics.map(norm) : [];
  const langs = Array.isArray(it?.languages) ? it.languages.map(norm) : [];

  add(5, "title includes query", title.includes(qq));
  add(3, "description includes query", desc.includes(qq));
  add(4, "topics contain query", topics.includes(qq));
  add(1, "languages contain query", langs.includes(qq));
  add(1, "url includes query", u.includes(qq));

  return json(env, 200, expl);
}

async function handleStatus(env: Env): Promise<Response> {
  const trust = acceptedUrl(env);
  const search = (env.SEARCH_RUNTIME_BASE || "https://search.onetoo.eu").replace(/\/$/,"") + "/health";
  // lightweight HEAD checks
  const t0 = Date.now();
  const results:any[] = [];
  for (const [name, url] of [["trust.accepted", trust], ["search.health", search]]){
    const s = Date.now();
    try{
      const resp = await fetch(url, { method:"GET" });
      results.push({ name, url, status: resp.status, ok: resp.ok, ms: Date.now()-s });
    }catch(e:any){
      results.push({ name, url, status: "ERR", ok:false, ms: Date.now()-s, note: String(e).slice(0,120) });
    }
  }
  return json(env, 200, { ok:true, time_ms: Date.now()-t0, results });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors(env), "cache-control":"no-store", "x-content-type-options":"nosniff" }});
    }
    if (request.method !== "GET") return json(env, 405, { ok:false, error:"method_not_allowed" });

    if (path === "/openapi.json") return json(env, 200, buildOpenApi(env));

    if (path === "/api/health" || path === "/portal/v1/health") return json(env, 200, { ok:true, status:"ok" });
    if (path === "/api/time") return json(env, 200, { ok:true, utc:new Date().toISOString() });
    if (path === "/api/status" || path === "/portal/v1/status") return handleStatus(env);
    if (path === "/api/entities" || path === "/portal/v1/accepted") return handleAccepted(request, env);
    if (path.startsWith("/api/entity/") || path.startsWith("/portal/v1/entity/")) {
      const prefix = path.startsWith("/api/entity/") ? "/api/entity/" : "/portal/v1/entity/";
      const id = decodeURIComponent(path.slice(prefix.length));
      return handleEntity(request, env, id);
    }
    if (path === "/api/explain" || path === "/portal/v1/explain") return handleExplain(request, env, url);
    if (path === "/portal/v1/artifacts") return handleArtifacts(request, env, url);
    if (path === "/portal/v1/probe") return handleProbe(request, env, url);
    if (path === "/portal/v1/federated/search") return handleFederatedSearch(request, env, url);

    return json(env, 404, { ok:false, error:"not_found", path });
  }
};


function normalizeWellKnown(input: string): string {
  let x = String(input || "").trim();
  if (!x) return "";
  x = x.replace(/\s+/g, "");
  x = x.replace(/\/+$/g, "");
  if (x.endsWith("/.well-known")) return x;
  if (x.includes("/.well-known/")) return x.replace(/\/+$/g, "").replace(/\/$/, "");
  // assume homepage
  return x + "/.well-known";
}

function expectedArtifacts(wk: string): string[] {
  const base = wk.replace(/\/+$/g, "");
  return [
    base + "/minisign.pub",
    base + "/sha256.json",
    base + "/sha256.json.minisig",
    base + "/ai-trust-hub.json",
    base + "/ai-governance.json",
    base + "/first-read.json",
    base + "/llms.txt",
    base + "/llms.txt.minisig",
  ];
}

async function handleArtifacts(request: Request, env: Env, url: URL): Promise<Response> {
  const u = (url.searchParams.get("url") || "").trim();
  if (!u) return json(env, 400, { ok:false, error:"missing_url" });
  const wk = normalizeWellKnown(u);
  return json(env, 200, { ok:true, input:u, wellKnown:wk, artifacts: expectedArtifacts(wk) });
}

async function handleProbe(request: Request, env: Env, url: URL): Promise<Response> {
  const target = (url.searchParams.get("url") || "").trim();
  if (!target) return json(env, 400, { ok:false, error:"missing_url" });

  // Basic SSRF guard: only allow http(s)
  if (!/^https?:\/\//i.test(target)) return json(env, 400, { ok:false, error:"invalid_scheme" });

  let resp: Response | null = null;
  try {
    resp = await fetch(target, {
      method: "GET",
      headers: { "accept": "*/*" },
      cf: { cacheTtl: 0, cacheEverything: false },
    });
  } catch (e: any) {
    return json(env, 200, { ok:false, error:"fetch_failed", message: String(e?.message || e) });
  }

  const headers: Record<string,string> = {};
  // Only expose a safe subset of headers
  for (const k of ["content-type","cache-control","etag","last-modified","server"]) {
    const v = resp.headers.get(k);
    if (v) headers[k] = v;
  }

  return json(env, 200, {
    ok: resp.ok,
    status: resp.status,
    url: target,
    headers,
  });
}

async function handleFederatedSearch(request: Request, env: Env, url: URL): Promise<Response> {
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return json(env, 400, { ok:false, error:"missing_q" });
  const limitRaw = parseInt(url.searchParams.get("limit") || "10", 10);
  const limit = Math.max(1, Math.min(50, Number.isFinite(limitRaw) ? limitRaw : 10));

  const sourcesParam = (url.searchParams.get("sources") || "").trim();
  const sources = (sourcesParam ? sourcesParam.split(",") : [env.SEARCH_RUNTIME_BASE])
    .map((s)=>String(s||"").trim().replace(/\/+$/g,""))
    .filter(Boolean)
    .slice(0, 8); // hard cap for safety

  const perSource: any[] = [];
  const merged: any[] = [];

  for (const base of sources) {
    const u = base + "/search/v1?q=" + encodeURIComponent(q) + "&limit=" + String(limit);
    const r = await fetchJsonCached(u, 30);
    perSource.push({ base, ok: r.ok, status: r.status });
    if (r.ok && r.data && Array.isArray((r.data as any).results)) {
      for (const it of (r.data as any).results) merged.push({ ...it, _source: base });
    }
  }

  merged.sort((a,b)=>{
    const da = Number(a.score||0), db = Number(b.score||0);
    if (db !== da) return db - da;
    return String(a._source||"").localeCompare(String(b._source||""));
  });

  return json(env, 200, { ok:true, query:q, limit, sources, perSource, results: merged.slice(0, limit * sources.length) });
}