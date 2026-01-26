import { qs, qsa, getConfig, fetchJson, fmtTs, downloadText, safeJson, humanBytes } from "./app.js";

async function sha256Bytes(buf){
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

function nowIso(){ return new Date().toISOString(); }

export async function hashFile(file){
  const buf = await file.arrayBuffer();
  const hex = await sha256Bytes(buf);
  return { sha256: hex, size: file.size, name: file.name, type: file.type||"application/octet-stream" };
}

export function makeReceipt({subject, hash, meta={}, issuer={name:"ONETOO", url:"https://onetoo.eu"}}){
  return {
    "@context": "https://onetoo.eu/.well-known/tfws/context/v1",
    type: "tfws.receipt.v1",
    issuer,
    createdAt: nowIso(),
    subject,
    hash,
    meta,
    note: "Experimental receipt. For long-term verification, publish the receipt + sha256 manifest + minisign signature under your trust-root.",
  };
}

export function renderJson(preEl, obj){
  preEl.textContent = JSON.stringify(obj, null, 2);
}

export function roomKey(){ return "onetoo_room_v1"; }

export async function roomLoad(){
  return safeJson(localStorage.getItem(roomKey())||"{}", {});
}

export async function roomSave(data){
  const txt = JSON.stringify(data, null, 2);
  // soft 12MB cap
  const bytes = new TextEncoder().encode(txt).length;
  if (bytes > 12 * 1024 * 1024) throw new Error("Room limit exceeded (12MB). Remove something and try again.");
  localStorage.setItem(roomKey(), txt);
  return bytes;
}

export async function roomExport(){
  const data = await roomLoad();
  downloadText("onetoo-room.json", JSON.stringify(data, null, 2));
}

export async function roomImport(file){
  const txt = await file.text();
  const obj = safeJson(txt, null);
  if (!obj) throw new Error("Invalid JSON");
  await roomSave(obj);
  return obj;
}

export { sha256Bytes, humanBytes };
