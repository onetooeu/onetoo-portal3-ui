import { norm } from "./config.js";
export function scoreItem(it, qRaw){
  let score=0; const q=norm(qRaw); if(!q) return 0;
  if (norm(it?.title).includes(q)) score+=5;
  if (norm(it?.description).includes(q)) score+=3;
  if (Array.isArray(it?.topics) && it.topics.map(norm).includes(q)) score+=4;
  if (Array.isArray(it?.languages) && it.languages.map(norm).includes(q)) score+=1;
  if (norm(it?.url).includes(q)) score+=1;
  return score;
}
