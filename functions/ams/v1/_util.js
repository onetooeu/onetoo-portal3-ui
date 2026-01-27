// Shared utilities for ONETOO Portal online gateways (Pages Functions)

export function json(data, init = {}) {
  const h = new Headers(init.headers || {});
  if (!h.has("content-type")) h.set("content-type", "application/json; charset=utf-8");
  if (!h.has("cache-control")) h.set("cache-control", "no-store");
  return new Response(JSON.stringify(data, null, 2) + "\n", { ...init, headers: h });
}

export function text(data, init = {}) {
  const h = new Headers(init.headers || {});
  if (!h.has("content-type")) h.set("content-type", "text/plain; charset=utf-8");
  if (!h.has("cache-control")) h.set("cache-control", "no-store");
  return new Response(String(data), { ...init, headers: h });
}

export function badRequest(msg, extra = {}) {
  return json({ ok: false, error: "bad_request", message: msg, ...extra }, { status: 400 });
}
export function unauthorized(msg = "missing or invalid token") {
  return json({ ok: false, error: "unauthorized", message: msg }, { status: 401 });
}
export function forbidden(msg = "forbidden") {
  return json({ ok: false, error: "forbidden", message: msg }, { status: 403 });
}
export function notFound(msg = "not_found") {
  return json({ ok: false, error: "not_found", message: msg }, { status: 404 });
}
export function methodNotAllowed(method, allow = "GET") {
  return json(
    { ok: false, error: "method_not_allowed", method, allow },
    { status: 405, headers: { Allow: allow } }
  );
}

export async function readJson(request, maxBytes = 512 * 1024) {
  const ct = request.headers.get("content-type") || "";
  if (!ct.includes("application/json")) throw new Error("content-type must be application/json");
  const buf = await request.arrayBuffer();
  if (buf.byteLength > maxBytes) throw new Error("payload too large");
  const txt = new TextDecoder("utf-8").decode(buf);
  return JSON.parse(txt);
}

export function nowIso() {
  return new Date().toISOString();
}

export function randId(prefix = "id") {
  // stable-enough id for demo usage
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export function getBearerToken(request) {
  const a = request.headers.get("authorization") || "";
  const m = a.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  const x = request.headers.get("x-ams-token");
  return x ? String(x).trim() : "";
}

export function requireWriteAuth(request, env) {
  // Write token can be set as AMS_WRITE_TOKEN or AMS_ADMIN_TOKEN
  const want = (env && (env.AMS_WRITE_TOKEN || env.AMS_ADMIN_TOKEN)) ? String(env.AMS_WRITE_TOKEN || env.AMS_ADMIN_TOKEN) : "";
  if (!want) return { ok: false, why: "server_write_token_not_configured" };
  const got = getBearerToken(request);
  if (!got) return { ok: false, why: "missing_token" };
  if (got !== want) return { ok: false, why: "invalid_token" };
  return { ok: true };
}

export function requireAdminAuth(request, env) {
  const want = (env && env.AMS_ADMIN_TOKEN) ? String(env.AMS_ADMIN_TOKEN) : "";
  if (!want) return { ok: false, why: "server_admin_token_not_configured" };
  const got = getBearerToken(request);
  if (!got) return { ok: false, why: "missing_token" };
  if (got !== want) return { ok: false, why: "invalid_token" };
  return { ok: true };
}

export async function sha256Hex(input) {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function stableStringify(obj) {
  // deterministic JSON stringify (sorted keys)
  const seen = new WeakSet();
  const norm = (v) => {
    if (v && typeof v === "object") {
      if (seen.has(v)) return null;
      seen.add(v);
      if (Array.isArray(v)) return v.map(norm);
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = norm(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(norm(obj));
}

export async function maybeSign(env, payloadObj) {
  // Experimental. We try Ed25519 if available. If not, we fall back to HMAC-SHA256.
  // Keys are optional; if nothing is configured we return null.
  // env.AMS_ED25519_PKCS8_B64 (private) + env.AMS_ED25519_SPKI_B64 (public)
  // env.AMS_HMAC_SECRET (base64 or raw)
  const ts = nowIso();
  const canonical = stableStringify(payloadObj);
  const msgBytes = new TextEncoder().encode(canonical);

  try {
    const pkcs8b64 = env && env.AMS_ED25519_PKCS8_B64 ? String(env.AMS_ED25519_PKCS8_B64) : "";
    const spkib64  = env && env.AMS_ED25519_SPKI_B64  ? String(env.AMS_ED25519_SPKI_B64)  : "";
    if (pkcs8b64 && spkib64 && crypto.subtle && crypto.subtle.importKey) {
      const pkcs8 = Uint8Array.from(atob(pkcs8b64), (c) => c.charCodeAt(0));
      const spki  = Uint8Array.from(atob(spkib64), (c) => c.charCodeAt(0));
      const priv = await crypto.subtle.importKey("pkcs8", pkcs8.buffer, { name: "Ed25519" }, false, ["sign"]);
      const pub  = await crypto.subtle.importKey("spki",  spki.buffer,  { name: "Ed25519" }, true,  ["verify"]);
      const sig = await crypto.subtle.sign({ name: "Ed25519" }, priv, msgBytes);
      const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
      const pubB64 = btoa(String.fromCharCode(...new Uint8Array(spki)));
      return { type: "ed25519", ts, canonical_sha256: await sha256Hex(msgBytes), public_key_spki_b64: pubB64, signature_b64: sigB64 };
    }
  } catch (_e) {
    // continue
  }

  try {
    const secret = env && env.AMS_HMAC_SECRET ? String(env.AMS_HMAC_SECRET) : "";
    if (secret && crypto.subtle && crypto.subtle.importKey) {
      const keyBytes = /^[A-Za-z0-9+/=]+$/.test(secret)
        ? Uint8Array.from(atob(secret), (c) => c.charCodeAt(0))
        : new TextEncoder().encode(secret);

      const key = await crypto.subtle.importKey(
        "raw",
        keyBytes,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const mac = await crypto.subtle.sign("HMAC", key, msgBytes);
      const macB64 = btoa(String.fromCharCode(...new Uint8Array(mac)));
      return { type: "hmac-sha256", ts, canonical_sha256: await sha256Hex(msgBytes), mac_b64: macB64 };
    }
  } catch (_e) {}

  return null;
}
