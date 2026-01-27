// Storage layer (D1 + optional R2) with safe fallbacks.
// Tables defined in /db/schema.sql

import { nowIso, randId, sha256Hex, stableStringify } from "./_util.js";

const MEM = globalThis.__ONETOO_MEMSTORE__ || (globalThis.__ONETOO_MEMSTORE__ = {
  envelopes: new Map(),
  artifacts: new Map(),
  rooms: new Map(),
  notary: new Map(),
  audit: [],
});

function hasD1(env) {
  return !!(env && env.DB && typeof env.DB.prepare === "function");
}

export async function initIfNeeded(env) {
  // No-op: schema creation should be done via Cloudflare D1 migrations.
  // But in dev / missing DB we fall back to in-memory.
  return { ok: true, mode: hasD1(env) ? "d1" : "memory" };
}

async function audit(env, type, data) {
  const event = { id: randId("evt"), ts: nowIso(), type, data };
  if (hasD1(env)) {
    await env.DB.prepare(
      "INSERT INTO audit_events (id, ts, type, data_json) VALUES (?1, ?2, ?3, ?4)"
    ).bind(event.id, event.ts, event.type, JSON.stringify(event.data)).run();
  } else {
    MEM.audit.push(event);
    if (MEM.audit.length > 5000) MEM.audit.shift();
  }
  return event;
}

export async function listAudit(env, limit = 200) {
  if (hasD1(env)) {
    const res = await env.DB.prepare(
      "SELECT id, ts, type, data_json FROM audit_events ORDER BY ts DESC LIMIT ?1"
    ).bind(limit).all();
    return (res.results || []).map((r) => ({
      id: r.id,
      ts: r.ts,
      type: r.type,
      data: safeParse(r.data_json),
    }));
  }
  return MEM.audit.slice(-limit).reverse();
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

export async function createEnvelope(env, envelope) {
  const id = envelope.id || randId("env");
  const ts = nowIso();
  const obj = { ...envelope, id, created_at: envelope.created_at || ts, updated_at: ts };
  const canonical = stableStringify(obj);
  const sha = await sha256Hex(canonical);

  const rec = { ...obj, sha256: sha };

  if (hasD1(env)) {
    await env.DB.prepare(
      "INSERT INTO ams_envelopes (id, ts_created, ts_updated, sha256, envelope_json, from_id, to_id, thread_id, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
    )
      .bind(
        id,
        rec.created_at,
        rec.updated_at,
        sha,
        JSON.stringify(rec),
        rec.from || null,
        rec.to || null,
        rec.thread || null,
        rec.status || "queued"
      )
      .run();
  } else {
    MEM.envelopes.set(id, rec);
  }

  await audit(env, "ams.envelope.created", { id, sha256: sha, from: rec.from, to: rec.to, thread: rec.thread, status: rec.status });
  return rec;
}

export async function getEnvelope(env, id) {
  if (hasD1(env)) {
    const res = await env.DB.prepare("SELECT envelope_json FROM ams_envelopes WHERE id=?1").bind(id).first();
    if (!res) return null;
    return safeParse(res.envelope_json);
  }
  return MEM.envelopes.get(id) || null;
}

export async function listEnvelopes(env, { limit = 50, cursor = null, direction = "desc", to = null, from = null, thread = null, status = null } = {}) {
  // Cursor = ts_updated or ts_created (ISO). For simplicity we use ts_updated.
  if (hasD1(env)) {
    const clauses = [];
    const binds = [];
    let i = 1;

    const cmp = direction === "asc" ? ">" : "<";
    const ord = direction === "asc" ? "ASC" : "DESC";

    if (cursor) { clauses.push(`ts_updated ${cmp} ?${i}`); binds.push(cursor); i++; }
    if (to) { clauses.push(`to_id = ?${i}`); binds.push(to); i++; }
    if (from) { clauses.push(`from_id = ?${i}`); binds.push(from); i++; }
    if (thread) { clauses.push(`thread_id = ?${i}`); binds.push(thread); i++; }
    if (status) { clauses.push(`status = ?${i}`); binds.push(status); i++; }

    const where = clauses.length ? ("WHERE " + clauses.join(" AND ")) : "";
    const sql = `SELECT id, ts_updated, envelope_json FROM ams_envelopes ${where} ORDER BY ts_updated ${ord} LIMIT ?${i}`;
    binds.push(limit);

    const res = await env.DB.prepare(sql).bind(...binds).all();
    const items = (res.results || []).map((r) => safeParse(r.envelope_json)).filter(Boolean);
    const nextCursor = items.length ? items[items.length - 1].updated_at : null;
    return { items, nextCursor };
  }

  let items = Array.from(MEM.envelopes.values());
  if (to) items = items.filter((e) => e.to === to);
  if (from) items = items.filter((e) => e.from === from);
  if (thread) items = items.filter((e) => e.thread === thread);
  if (status) items = items.filter((e) => e.status === status);

  items.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  if (cursor) items = items.filter((e) => direction === "asc" ? e.updated_at > cursor : e.updated_at < cursor);
  items = items.slice(0, limit);
  return { items, nextCursor: items.length ? items[items.length - 1].updated_at : null };
}

export async function updateEnvelopeStatus(env, id, status, extra = {}) {
  const envl = await getEnvelope(env, id);
  if (!envl) return null;
  const updated = { ...envl, ...extra, status, updated_at: nowIso() };
  const canonical = stableStringify(updated);
  const sha = await sha256Hex(canonical);
  updated.sha256 = sha;

  if (hasD1(env)) {
    await env.DB.prepare(
      "UPDATE ams_envelopes SET ts_updated=?2, sha256=?3, envelope_json=?4, status=?5 WHERE id=?1"
    )
      .bind(id, updated.updated_at, sha, JSON.stringify(updated), status)
      .run();
  } else {
    MEM.envelopes.set(id, updated);
  }
  await audit(env, "ams.envelope.updated", { id, status, sha256: sha });
  return updated;
}

export async function upsertArtifact(env, key, payload, meta = {}) {
  const ts = nowIso();
  const dataText = typeof payload === "string" ? payload : JSON.stringify(payload);
  const sha = await sha256Hex(dataText);
  const rec = {
    key,
    sha256: sha,
    ts_created: meta.ts_created || ts,
    ts_updated: ts,
    bytes: dataText.length,
    content_type: meta.content_type || "application/json",
    note: meta.note || "",
  };

  // Optional R2 for large blobs
  let stored = { mode: "inline" };
  const useR2 = env && env.ARTIFACTS && typeof env.ARTIFACTS.put === "function";
  if (useR2 && dataText.length > 128 * 1024) {
    const objKey = `artifact/${key}/${sha}`;
    await env.ARTIFACTS.put(objKey, dataText, { httpMetadata: { contentType: rec.content_type } });
    stored = { mode: "r2", object_key: objKey };
  } else {
    stored = { mode: "inline", data_text: dataText };
  }

  const row = { ...rec, stored };

  if (hasD1(env)) {
    await env.DB.prepare(
      "INSERT INTO artifacts (key, sha256, ts_created, ts_updated, bytes, content_type, note, stored_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(key) DO UPDATE SET sha256=excluded.sha256, ts_updated=excluded.ts_updated, bytes=excluded.bytes, content_type=excluded.content_type, note=excluded.note, stored_json=excluded.stored_json"
    )
      .bind(key, sha, row.ts_created, row.ts_updated, row.bytes, row.content_type, row.note, JSON.stringify(row.stored))
      .run();
  } else {
    MEM.artifacts.set(key, row);
  }

  await audit(env, "artifact.upserted", { key, sha256: sha, bytes: row.bytes, stored: stored.mode });
  return row;
}

export async function getArtifact(env, key) {
  if (hasD1(env)) {
    const res = await env.DB.prepare(
      "SELECT key, sha256, ts_created, ts_updated, bytes, content_type, note, stored_json FROM artifacts WHERE key=?1"
    ).bind(key).first();
    if (!res) return null;
    return {
      key: res.key,
      sha256: res.sha256,
      ts_created: res.ts_created,
      ts_updated: res.ts_updated,
      bytes: res.bytes,
      content_type: res.content_type,
      note: res.note,
      stored: safeParse(res.stored_json),
    };
  }
  return MEM.artifacts.get(key) || null;
}

export async function readArtifactPayload(env, artifact) {
  if (!artifact) return null;
  const stored = artifact.stored || {};
  if (stored.mode === "r2") {
    if (!(env && env.ARTIFACTS && typeof env.ARTIFACTS.get === "function")) return null;
    const obj = await env.ARTIFACTS.get(stored.object_key);
    if (!obj) return null;
    return await obj.text();
  }
  return stored.data_text ?? null;
}

export async function listArtifacts(env, { limit = 100 } = {}) {
  if (hasD1(env)) {
    const res = await env.DB.prepare(
      "SELECT key, sha256, ts_created, ts_updated, bytes, content_type, note FROM artifacts ORDER BY ts_updated DESC LIMIT ?1"
    ).bind(limit).all();
    return (res.results || []).map((r) => ({ ...r }));
  }
  const arr = Array.from(MEM.artifacts.values());
  arr.sort((a, b) => (a.ts_updated < b.ts_updated ? 1 : -1));
  return arr.slice(0, limit).map((r) => ({ ...r, stored: undefined }));
}

export async function createRoomMessage(env, room, msg) {
  const id = randId("msg");
  const ts = nowIso();
  const rec = { id, room, ts, ...msg };
  if (hasD1(env)) {
    await env.DB.prepare(
      "INSERT INTO room_messages (id, room, ts, from_id, kind, body_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
    )
      .bind(id, room, ts, rec.from || null, rec.kind || "text", JSON.stringify(rec.body || rec))
      .run();
  } else {
    if (!MEM.rooms.has(room)) MEM.rooms.set(room, []);
    MEM.rooms.get(room).push(rec);
    if (MEM.rooms.get(room).length > 5000) MEM.rooms.get(room).shift();
  }
  await audit(env, "room.message", { room, id, from: rec.from, kind: rec.kind });
  return rec;
}

export async function listRoomMessages(env, room, { limit = 200, cursor = null, direction = "desc" } = {}) {
  if (hasD1(env)) {
    const cmp = direction === "asc" ? ">" : "<";
    const ord = direction === "asc" ? "ASC" : "DESC";
    const binds = [room];
    let where = "WHERE room=?1";
    let idx = 2;
    if (cursor) { where += ` AND ts ${cmp} ?${idx}`; binds.push(cursor); idx++; }
    const sql = `SELECT id, room, ts, from_id, kind, body_json FROM room_messages ${where} ORDER BY ts ${ord} LIMIT ?${idx}`;
    binds.push(limit);
    const res = await env.DB.prepare(sql).bind(...binds).all();
    const items = (res.results || []).map((r) => ({
      id: r.id,
      room: r.room,
      ts: r.ts,
      from: r.from_id,
      kind: r.kind,
      body: safeParse(r.body_json),
    }));
    const nextCursor = items.length ? items[items.length - 1].ts : null;
    return { items, nextCursor };
  }
  const arr = (MEM.rooms.get(room) || []).slice();
  arr.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  let items = arr;
  if (cursor) items = items.filter((m) => direction === "asc" ? m.ts > cursor : m.ts < cursor);
  items = items.slice(0, limit);
  return { items, nextCursor: items.length ? items[items.length - 1].ts : null };
}

export async function notarize(env, record) {
  const id = randId("notary");
  const ts = nowIso();
  const rec = { id, ts, ...record };
  if (hasD1(env)) {
    await env.DB.prepare(
      "INSERT INTO notary_records (id, ts, kind, subject, sha256, meta_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
    )
      .bind(id, ts, rec.kind || "artifact", rec.subject || "", rec.sha256 || "", JSON.stringify(rec.meta || {}))
      .run();
  } else {
    MEM.notary.set(id, rec);
  }
  await audit(env, "notary.record", { id, kind: rec.kind, subject: rec.subject, sha256: rec.sha256 });
  return rec;
}

export async function listNotary(env, { limit = 200 } = {}) {
  if (hasD1(env)) {
    const res = await env.DB.prepare(
      "SELECT id, ts, kind, subject, sha256, meta_json FROM notary_records ORDER BY ts DESC LIMIT ?1"
    ).bind(limit).all();
    return (res.results || []).map((r) => ({ ...r, meta: safeParse(r.meta_json) }));
  }
  return Array.from(MEM.notary.values()).slice(-limit).reverse();
}

export async function federationStoreHandshake(env, handshake) {
  const id = randId("fed");
  const ts = nowIso();
  const rec = { id, ts, ...handshake };
  if (hasD1(env)) {
    await env.DB.prepare(
      "INSERT INTO federation_handshakes (id, ts, remote, snapshot_json) VALUES (?1, ?2, ?3, ?4)"
    ).bind(id, ts, rec.remote || "", JSON.stringify(rec.snapshot || rec)).run();
  } else {
    // keep last 200
    MEM.fed = MEM.fed || [];
    MEM.fed.push(rec);
    if (MEM.fed.length > 200) MEM.fed.shift();
  }
  await audit(env, "federation.handshake", { id, remote: rec.remote });
  return rec;
}

export async function listFederationHandshakes(env, { limit = 50 } = {}) {
  if (hasD1(env)) {
    const res = await env.DB.prepare(
      "SELECT id, ts, remote, snapshot_json FROM federation_handshakes ORDER BY ts DESC LIMIT ?1"
    ).bind(limit).all();
    return (res.results || []).map((r) => ({ id: r.id, ts: r.ts, remote: r.remote, snapshot: safeParse(r.snapshot_json) }));
  }
  return (MEM.fed || []).slice(-limit).reverse();
}
