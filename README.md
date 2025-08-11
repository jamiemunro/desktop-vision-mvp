## Desktop Vision MVP

A local desktop vision prototype that captures your screen, stores frames and events, performs microphone ASR, and exposes tools via MCP so Claude Code/Claude Desktop can “see what you see.”

### Components
- **Electron app** (`app/main.js`): screen capture, writes frames to `sessions/<ISO>/frames/*.jpg`, logs events to `events.ndjson`.
- **Backend** (`backend/server.js`): HTTP on 6060 to serve frames, WebSocket `/timeline` to stream timeline events, `GET /mcp.json` descriptor.
- **ASR** (`asr/server.py`): mic capture + faster-whisper; appends `speech.final` events to the timeline; HTTP on 6061.
- **MCP adapter** (`mcp-adapter/server.mjs`): stdio MCP server for Claude Code/Desktop.
- **MCP client (optional)** (`mcp-client/client.ts`): example client that listens to the timeline and fetches the latest frame on interesting events.

Data is written to `sessions/<ISO>/` with subfolders `frames/`, `audio/chunks/`, and files `events.ndjson`, `meta.json`.

---

## Quick start (macOS)
1) Prereqs
   - Node.js 20+
   - Python 3.9+
   - ffmpeg (`brew install ffmpeg`)

2) Install deps (root and optional client)
```bash
cd /Users/jamiemunro/desktop-vision-mvp
npm install
cd mcp-client && npm install && cd ..
```

3) Start everything (Electron + Backend + ASR)
```bash
npm run start:all
```
   - macOS will prompt for Screen Recording and Microphone. Grant them, then in the Electron window click “Start Capture”.

4) Verify
```bash
curl -s http://127.0.0.1:6060/mcp.json | jq .name,.version
open sessions && ls -1dt sessions/*/ | head -1
```

---

## Services and ports
- Backend: http://127.0.0.1:6060
  - `GET /frame/:id` → JPEG
  - WebSocket `ws://127.0.0.1:6060/timeline?since=<ms>` → NDJSON events
- ASR: http://127.0.0.1:6061 (development Flask server)

### Event examples (events.ndjson)
```ndjson
{"t": 1754930345001, "etype": "ui.frame", "frame_id": "1754930345001"}
{"t": 1754930357830, "etype": "speech.final", "text": "So what's going on?"}
{"t": 1754930409000, "etype": "marker.bookmark", "label": "Interesting"}
```

---

## MCP adapter (Claude Code / Desktop)
The adapter is a local stdio server: `node /Users/jamiemunro/desktop-vision-mvp/mcp-adapter/server.mjs`

### Add to Claude Code (CLI)
Use Claude Code’s MCP commands (see Anthropic docs: Connect Claude Code to tools via MCP).
```bash
claude mcp add desktop-vision \
  --env TRACKER_BASE_URL=http://127.0.0.1:6060 \
  --env SESSIONS_DIR=/Users/jamiemunro/desktop-vision-mvp/sessions \
  -- node /Users/jamiemunro/desktop-vision-mvp/mcp-adapter/server.mjs

claude mcp list
claude mcp get desktop-vision
```

### Add to Claude Desktop (config JSON)
```json
{
  "mcpServers": {
    "desktop-vision": {
      "command": "node",
      "args": ["/Users/jamiemunro/desktop-vision-mvp/mcp-adapter/server.mjs"],
      "env": {
        "TRACKER_BASE_URL": "http://127.0.0.1:6060",
        "SESSIONS_DIR": "/Users/jamiemunro/desktop-vision-mvp/sessions"
      }
    }
  }
}
```

### Tools exposed
- `timeline_tail(limit?, since?)` → tail of timeline as NDJSON text
- `timeline_follow(since, max_duration_ms?, max_events?)` → blocks for up to `max_duration_ms` waiting for new events; returns NDJSON
- `get_frame(frame_id)` → returns `{frame_id}` text and the full image as MCP image content
- `latest_frame()` → most recent frame image + id
- `mark_bookmark(label)` → appends a bookmark event
- `summarize_frame(frame_id, width=512, quality=60)` → creates cached thumbnail and returns base64 thumbnail image + paths
- `summarize_latest_frame(width=512, quality=60)` → same as above for most recent frame

Thumbnails and metadata are stored in `sessions/<ISO>/summaries/` (small JPEGs and tiny JSON only).

### Example prompts for Claude
- “Use the desktop-vision MCP and call latest_frame. What’s on my screen?”
- “Follow the timeline for 5 seconds and summarize any new speech or bookmarks.”
- “Summarize the latest frame at width 512 and quality 60.”
- “Mark a bookmark with label ‘Todo’.”

---

## Optional: MCP client (example)
```bash
cd mcp-client
npx ts-node --transpile-only client.ts
```
Listens to the timeline and saves `mcp-client/latest.jpg` when it sees `speech.final` or a bookmark.

---

## Useful scripts
In `package.json`:
```json
{
  "scripts": {
    "start": "electron ./app/main.js",
    "backend": "node backend/server.js",
    "asr": "bash -lc 'cd asr && source .venv/bin/activate || python3 -m venv .venv && source .venv/bin/activate; pip install -q --upgrade pip && pip install -q flask sounddevice numpy faster-whisper pydub; python server.py'",
    "start:all": "npm-run-all -p start backend asr",
    "mcp:adapter": "node ./mcp-adapter/server.mjs"
  }
}
```

---

## Troubleshooting
- macOS permissions: grant Screen Recording + Microphone for Electron and your Terminal.
- No frames? Open the Electron window and click “Start Capture”.
- ASR not up? Ensure Python 3.9+, then run the ASR script or `npm run asr`. First run downloads the Whisper model.
- ffmpeg missing? `brew install ffmpeg` (required by `pydub`).
- MCP adapter not visible? Re-run `claude mcp add ...` and verify `claude mcp list`.
- Sharp installation issues: ensure recent Node; on macOS Apple Silicon, prebuilt binaries usually work. If needed: `brew install libvips`.

---

## Folder structure
```
app/            Electron UI (capture, IPC)
backend/        HTTP + WebSocket server (frames + timeline)
asr/            Flask mic ASR (faster-whisper)
mcp-adapter/    MCP stdio server for Claude Code/Desktop
mcp-client/     Example timeline client (optional)
sessions/       Per-run session folders with frames, audio, events, meta
```


