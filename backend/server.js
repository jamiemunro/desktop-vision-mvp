const express = require('express');
const fs = require('fs'); const path = require('path'); const WebSocket = require('ws');
const SESSIONS_DIR = path.join(__dirname,'..','sessions');
const SESSION_DIR = fs.readdirSync(SESSIONS_DIR).map(n=>path.join(SESSIONS_DIR,n)).sort().pop();
const EVENTS = path.join(SESSION_DIR,'events.ndjson');
const app = express();
app.get('/frame/:id', (req,res)=> {
  const p = path.join(SESSION_DIR,'frames', `${req.params.id}.jpg`);
  if (!fs.existsSync(p)) return res.sendStatus(404);
  res.sendFile(p);
});
app.get('/mcp.json', (req,res)=> {
  res.json({
    name: "desktop-tracker",
    version: "0.1.0",
    resources: [
      { uri: "tracker://timeline", name: "Timeline stream (NDJSON)" },
      { uri: "tracker://frame/{frame_id}", name: "Frame by id (jpg)" }
    ],
    tools: [
      { name: "mark_bookmark", input_schema: { type:"object", properties:{ label:{type:"string"} } } }
    ]
  });
});
const server = app.listen(6060, ()=> console.log('HTTP on 6060'));
const wss = new WebSocket.Server({ server, path: '/timeline' });
wss.on('connection', (ws, req)=> {
  const since = parseInt(new URL(req.url, 'http://x').searchParams.get('since')||'0',10);
  const stream = fs.createReadStream(EVENTS, { encoding:'utf8' });
  let backlog = '';
  stream.on('data', chunk => {
    backlog += chunk;
    let idx; while ((idx = backlog.indexOf('\n')) >= 0) {
      const line = backlog.slice(0, idx); backlog = backlog.slice(idx+1);
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (!since || obj.t >= since) ws.send(line);
      } catch {}
    }
  });
  stream.on('end', ()=> {
    const watcher = fs.watch(EVENTS, ()=> {
      const s = fs.readFileSync(EVENTS, 'utf8'); const last = s.trim().split('\n').pop();
      if (last) ws.send(last);
    });
    ws.on('close', ()=> watcher.close());
  });
});