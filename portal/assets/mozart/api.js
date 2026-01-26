import { getConfig } from "./config.js";
const mem = { accepted: null, at: 0 };

export async function fetchJson(url, { timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { accept: "application/json" }, signal: ctrl.signal });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    return { ok: r.ok, status: r.status, data, text };
  } finally { clearTimeout(t); }
}

export async function getAcceptedSet({ force=false } = {}) {
  const { acceptedSet } = getConfig();
  const now = Date.now();
  if (!force && mem.accepted && (now - mem.at) < 60_000) return { source: acceptedSet, ...mem.accepted };
  const url = acceptedSet.includes("?") ? acceptedSet : `${acceptedSet}?cb=${Math.floor(now/1000)}`;
  const r = await fetchJson(url);
  const shape = (r.data && Array.isArray(r.data.items)) ? r.data : { items: [], note: "invalid_shape" };
  mem.accepted = shape; mem.at = now;
  return { source: acceptedSet, ...shape, _fetch: { ok: r.ok, status: r.status } };
}

export async function searchV1(q, limit=10) {
  const { searchBase } = getConfig();
  const u = new URL(searchBase + "/search/v1");
  if (q) u.searchParams.set("q", q);
  u.searchParams.set("limit", String(limit));
  const r = await fetchJson(u.toString());
  return { url: u.toString(), ...r };
}
