import { json, badRequest, methodNotAllowed, unauthorized, readJson, requireWriteAuth } from "../../../ams/v1/_util.js";
import { createRoomMessage, listRoomMessages } from "../../../ams/v1/_store.js";

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const room = url.searchParams.get("room") || "lobby";

  if (request.method === "GET") {
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 500);
    const cursor = url.searchParams.get("cursor");
    const dir = (url.searchParams.get("dir") || "desc").toLowerCase() === "asc" ? "asc" : "desc";
    const res = await listRoomMessages(env, room, { limit, cursor, direction: dir });
    return json({ ok: true, room, ...res });
  }

  if (request.method === "POST") {
    const auth = requireWriteAuth(request, env);
    if (!auth.ok) return unauthorized(auth.why);

    let body;
    try { body = await readJson(request, 256 * 1024); } catch (e) { return badRequest(String(e && e.message ? e.message : e)); }
    if (!body || typeof body !== "object") return badRequest("body must be json object");

    const msg = await createRoomMessage(env, room, {
      from: body.from ? String(body.from) : null,
      kind: body.kind ? String(body.kind) : "text",
      body: body.body ?? body.payload ?? body,
    });

    return json({ ok: true, message: msg }, { status: 201 });
  }

  return methodNotAllowed(request.method, "GET, POST, OPTIONS");
}
