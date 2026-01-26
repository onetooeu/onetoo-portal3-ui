import { getAcceptedSet } from "./api.js";
import { getConfig } from "./config.js";
import { esc, pill, fmtTs } from "./ui.js";

const u = new URL(window.location.href);
const id = u.searchParams.get("id") || "";

const elCrumb=document.getElementById("crumb");
const elPanel=document.getElementById("panel");
const elProofs=document.getElementById("proofs");
const elVerify=document.getElementById("verify");
const elRaw=document.getElementById("raw");

function entityId(it){
  const base=`${it?.url||""}|${it?.title||""}|${it?.repo||""}`;
  let h=0; for(let i=0;i<base.length;i++) h=((h<<5)-h)+base.charCodeAt(i), h|=0;
  return "e"+Math.abs(h);
}

async function init(){
  const cfg=getConfig();
  const acc=await getAcceptedSet({force:false});
  const items=Array.isArray(acc.items)?acc.items:[];
  const rows=items.map(it=>({it,id:it.id||entityId(it)}));
  const found=rows.find(r=>r.id===id);

  elCrumb.innerHTML = `<a href="./entities.html">Registry</a> <span class="muted">/</span> <span>${esc(id||"(no id)")}</span>`;
  if(!found){ elPanel.innerHTML=`<div class="card"><h2>Not found</h2><p class="muted">Entity id not in accepted-set.</p></div>`; return; }

  const it=found.it;
  document.title = `${it?.title||"Entity"} — ONETOO Portal`;

  elPanel.innerHTML = `
    <div class="card">
      <h1 style="margin:0 0 8px 0;">${esc(it?.title||"(untitled)")}</h1>
      <div class="muted">${esc(it?.description||"")}</div>
      <div class="metaRow" style="margin-top:10px;">
        <span class="pill">${esc(it?.kind||it?.type||"entity")}</span>
        ${it?.timestamp?`<span class="pill">ts ${esc(fmtTs(it.timestamp))}</span>`:""}
        ${it?.url?`<a class="link" href="${esc(it.url)}" target="_blank" rel="noreferrer">site</a>`:""}
        ${it?.repo?`<a class="link" href="${esc(it.repo)}" target="_blank" rel="noreferrer">repo</a>`:""}
        ${it?.wellKnown?`<a class="link" href="${esc(it.wellKnown)}" target="_blank" rel="noreferrer">.well-known</a>`:""}
      </div>
      <div class="tags" style="margin-top:10px;">
        ${(Array.isArray(it?.topics)?it.topics:[]).map(pill).join("")}
        ${(Array.isArray(it?.languages)?it.languages:[]).map(pill).join("")}
      </div>
    </div>
  `;

  const acceptedUrl=cfg.acceptedSet;
  const sha=cfg.trustRoot+"/.well-known/sha256.json";
  const mini=cfg.trustRoot+"/.well-known/minisign.pub";
  elProofs.innerHTML = `
    <h2>Proofs</h2>
    <ul>
      <li><a href="${esc(acceptedUrl)}" target="_blank" rel="noreferrer">accepted-set dump</a></li>
      <li><a href="${esc(sha)}" target="_blank" rel="noreferrer">sha256.json</a></li>
      <li><a href="${esc(sha+".minisig")}" target="_blank" rel="noreferrer">sha256.json.minisig</a></li>
      <li><a href="${esc(mini)}" target="_blank" rel="noreferrer">minisign.pub</a></li>
    </ul>
  `;

  const cmds = [
    "# Verify sha256.json signature (minisign required)",
    `curl -sS "${sha}" -o sha256.json`,
    `curl -sS "${sha}.minisig" -o sha256.json.minisig`,
    `curl -sS "${mini}" -o minisign.pub`,
    "minisign -V -p minisign.pub -m sha256.json -x sha256.json.minisig",
  ].join("\n");
  elVerify.innerHTML = `<h2>Verify (helpers)</h2><pre class="code">${esc(cmds)}</pre>`;
  elRaw.innerHTML = `<h2>Raw entity JSON</h2><pre class="code">${esc(JSON.stringify(it,null,2))}</pre>`;
}
init();
