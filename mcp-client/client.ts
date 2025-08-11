import WebSocket from "ws";
import { writeFileSync } from "fs";
import { setTimeout as sleep } from "timers/promises";
const TIMELINE_URL = "ws://localhost:6060/timeline";
const FRAME_URL = (id: string) => `http://localhost:6060/frame/${id}`;
let lastFrameId: string | null = null;
let pending: Promise<void> | null = null;
async function fetchFrame(id: string){
  const res = await fetch(FRAME_URL(id));
  if (!res.ok) { console.error("frame fetch failed", id); return; }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync("latest.jpg", buf);
}
async function trigger(reason: string, payload:any){
  if (!lastFrameId || pending) return;
  pending = (async()=>{ await sleep(120); await fetchFrame(lastFrameId!);
    console.log(JSON.stringify({ at:new Date().toISOString(), reason, payload, frame_id:lastFrameId, frame_saved_as:"latest.jpg" })); pending=null; })();
}
function start(){
  const since = Date.now() - 10_000;
  const ws = new WebSocket(`${TIMELINE_URL}?since=${since}`);
  ws.on("open", ()=> console.log("[timeline] connected"));
  ws.on("message", (data)=> {
    const line = data.toString().trim(); if (!line) return;
    let e:any; try{ e=JSON.parse(line);}catch{return;}
    if (e.etype==="ui.frame" && e.frame_id){ lastFrameId = String(e.frame_id); return; }
    if (e.etype==="speech.final") trigger("speech.final", { text:e.text });
    if (e.etype==="marker.bookmark") trigger("marker.bookmark", { label:e.label });
  });
  ws.on("close", ()=> console.log("[timeline] disconnected"));
  ws.on("error", (err)=> console.error("[timeline] error", err));
}
start();