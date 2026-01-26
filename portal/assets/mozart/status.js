import { getConfig } from "./config.js";
import { esc } from "./ui.js";

const elTrust=document.getElementById("trust");
const elSearch=document.getElementById("search");
const elProofs=document.getElementById("proofs");
const elPortal=document.getElementById("portal");
const elCmds=document.getElementById("cmds");

async function ping(url){
  try{ const r=await fetch(url,{method:"GET"}); return r.status; }catch{ return 0; }
}
async function init(){
  const cfg=getConfig();
  const accepted=cfg.acceptedSet;
  const sha=cfg.trustRoot+"/.well-known/sha256.json";
  const mini=cfg.trustRoot+"/.well-known/minisign.pub";
  const openapi=cfg.searchBase+"/openapi.json";
  const health=cfg.searchBase+"/health";

  elTrust.innerHTML=`<h2>Trust root</h2><ul><li><a href="${esc(cfg.trustRoot)}" target="_blank" rel="noreferrer">${esc(cfg.trustRoot)}</a></li><li><a href="${esc(accepted)}" target="_blank" rel="noreferrer">accepted-set</a></li></ul>`;
  elSearch.innerHTML=`<h2>Search runtime</h2><ul><li><a href="${esc(cfg.searchBase)}" target="_blank" rel="noreferrer">${esc(cfg.searchBase)}</a></li><li><a href="${esc(openapi)}" target="_blank" rel="noreferrer">openapi.json</a></li></ul>`;
  elProofs.innerHTML=`<h2>Proof artifacts</h2><ul><li><a href="${esc(sha)}" target="_blank" rel="noreferrer">sha256.json</a></li><li><a href="${esc(sha+".minisig")}" target="_blank" rel="noreferrer">sha256.json.minisig</a></li><li><a href="${esc(mini)}" target="_blank" rel="noreferrer">minisign.pub</a></li></ul>`;
  elPortal.innerHTML=`<h2>Portal config</h2><pre class="code">${esc(JSON.stringify(cfg,null,2))}</pre>`;

  elCmds.textContent=[
    "# Verify sha256 signature",
    `curl -sS "${sha}" -o sha256.json`,
    `curl -sS "${sha}.minisig" -o sha256.json.minisig`,
    `curl -sS "${mini}" -o minisign.pub`,
    "minisign -V -p minisign.pub -m sha256.json -x sha256.json.minisig",
    "",
    "# Search quick check",
    `curl -sS "${openapi}" | head`,
    `curl -sS "${cfg.searchBase}/search/v1?q=hgp&limit=10" | head`,
  ].join("\n");

  const s1=await ping(accepted);
  const s2=await ping(openapi);
  const s3=await ping(health);
  const meta=document.createElement("div");
  meta.className="meta";
  meta.innerHTML=`<div><b>Live checks:</b> accepted ${s1||"n/a"} | openapi ${s2||"n/a"} | health ${s3||"n/a"}</div>`;
  document.querySelector("main.wrap").insertBefore(meta, document.querySelector("main.wrap").children[1]);
}
init();
