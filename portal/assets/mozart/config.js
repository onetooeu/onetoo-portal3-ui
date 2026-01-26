/**
 * Mozart Runtime Config (decade-stable)
 * Loads /config/runtime.json if present, otherwise falls back to defaults.
 * Back-compat exports: getConfig(), norm().
 */

const DEFAULTS = Object.freeze({
  trust_root: "https://www.onetoo.eu",
  search_runtime: "https://search.onetoo.eu",
  portal_ui: "https://portal.onetoo.eu",
  agents_service: "https://agents.onetoo.eu",
  discovery: {
    trust_root_index: "https://www.onetoo.eu/.well-known/index.json",
    search_openapi: "https://search.onetoo.eu/openapi.json",
    agents_index: "https://agents.onetoo.eu/.well-known/index.json"
  }
});

function canonicalize(url) {
  try {
    const u = new URL(url);
    u.protocol = "https:";
    if (u.hostname === "onetoo.eu") u.hostname = "www.onetoo.eu";
    if (u.pathname !== "/" && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    return url;
  }
}

export function norm(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * New: preferred runtime loader
 */
export async function loadRuntimeConfig() {
  try {
    const r = await fetch("/config/runtime.json", { cache: "no-store" });
    if (r.ok) {
      const cfg = await r.json();
      const merged = {
        ...DEFAULTS,
        ...cfg,
        discovery: { ...DEFAULTS.discovery, ...(cfg.discovery || {}) }
      };
      merged.trust_root = canonicalize(merged.trust_root);
      merged.search_runtime = canonicalize(merged.search_runtime);
      merged.portal_ui = canonicalize(merged.portal_ui);
      merged.agents_service = canonicalize(merged.agents_service);
      merged.discovery.trust_root_index = canonicalize(merged.discovery.trust_root_index);
      merged.discovery.search_openapi = canonicalize(merged.discovery.search_openapi);
      merged.discovery.agents_index = canonicalize(merged.discovery.agents_index);
      return merged;
    }
  } catch {
    // ignore
  }

  const d = JSON.parse(JSON.stringify(DEFAULTS));
  d.trust_root = canonicalize(d.trust_root);
  d.discovery.trust_root_index = canonicalize(d.discovery.trust_root_index);
  return d;
}

/**
 * Back-compat: previous API used by modules.
 * Returns the previous shape: { trustRoot, acceptedSet, searchBase }
 * but now powered by runtime config.
 */
export async function getConfig() {
  const cfg = await loadRuntimeConfig();
  const trustRoot = cfg.trust_root;
  // Keep legacy default acceptedSet (matches your old pattern)
  const acceptedSet =
    (new URL(window.location.href)).searchParams.get("acceptedSet") ||
    ${trustRoot}/public/dumps/contrib-accepted.json;
  const searchBase =
    (new URL(window.location.href)).searchParams.get("searchBase") ||
    cfg.search_runtime;
  return { trustRoot, acceptedSet, searchBase };
}