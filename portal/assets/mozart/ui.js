import { norm } from "./config.js";
export function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));}
export function pill(s){return s?`<span class="pill">${esc(s)}</span>`:"";}
export function stableSort(arr, cmp){return arr.map((v,i)=>({v,i})).sort((a,b)=>cmp(a.v,b.v)||(a.i-b.i)).map(x=>x.v);}
export function haystack(it){
  const topics=Array.isArray(it?.topics)?it.topics:[];
  const langs=Array.isArray(it?.languages)?it.languages:[];
  return [it?.title,it?.description,it?.url,it?.repo,it?.wellKnown,it?.kind,it?.notes,...topics,...langs].map(norm).join(" | ");
}
export function fmtTs(ts){
  try{const d=new Date(ts); if(isNaN(d.getTime())) return String(ts||""); return d.toISOString().replace(".000Z","Z");}
  catch{return String(ts||"");}
}
