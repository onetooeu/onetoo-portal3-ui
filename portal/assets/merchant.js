import { qs, downloadText } from "./app.js";
import { makeReceipt, renderJson } from "./mozart-tools.js";

let lastOffer = null;
let lastReceipt = null;

function nowIso(){ return new Date().toISOString(); }

qs("#mBuild")?.addEventListener("click", ()=>{
  lastOffer = {
    "@context": "https://onetoo.eu/.well-known/tfws/context/v1",
    type: "tfws.offer.v1",
    createdAt: nowIso(),
    title: qs("#mTitle").value.trim(),
    counterparty: qs("#mParty").value.trim() || null,
    amount: qs("#mAmount").value.trim() || null,
    notes: qs("#mNotes").value.trim() || "",
    status: "draft",
  };
  renderJson(qs("#mOut"), lastOffer);
  qs("#mDownload").disabled = false;
});

qs("#mDownload")?.addEventListener("click", ()=>{
  if (!lastOffer) return;
  downloadText("tfws-offer.json", JSON.stringify(lastOffer, null, 2));
});

qs("#rBuild")?.addEventListener("click", ()=>{
  const h = qs("#rHash").value.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(h)) return alert("Enter a 64-hex SHA-256 hash.");
  lastReceipt = makeReceipt({ subject:{ kind:"document", ref:"sha256:"+h }, hash:{ sha256:h }, meta:{ purpose:"merchant receipt" } });
  renderJson(qs("#rOut"), lastReceipt);
  qs("#rDownload").disabled = false;
});

qs("#rDownload")?.addEventListener("click", ()=>{
  if (!lastReceipt) return;
  downloadText("tfws-merchant-receipt.json", JSON.stringify(lastReceipt, null, 2));
});
