export function getConfig() {
  const u = new URL(window.location.href);
  const trustRoot = u.searchParams.get("trustRoot") || "https://www.onetoo.eu";
  const acceptedSet = u.searchParams.get("acceptedSet") || `${trustRoot}/public/dumps/contrib-accepted.json`;
  const searchBase = u.searchParams.get("searchBase") || "https://search.onetoo.eu";
  return { trustRoot, acceptedSet, searchBase };
}
export function norm(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}
