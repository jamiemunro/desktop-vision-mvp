import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TRACKER_BASE_URL = process.env.TRACKER_BASE_URL || 'http://127.0.0.1:6060';
const SESSIONS_DIR = process.env.SESSIONS_DIR || path.join(path.dirname(__dirname), 'sessions');

function getLatestSessionDir() {
  if (!fs.existsSync(SESSIONS_DIR)) throw new Error(`SESSIONS_DIR not found: ${SESSIONS_DIR}`);
  const dirs = fs
    .readdirSync(SESSIONS_DIR)
    .map((d) => path.join(SESSIONS_DIR, d))
    .filter((p) => fs.existsSync(p) && fs.statSync(p).isDirectory())
    .sort();
  if (dirs.length === 0) throw new Error('No sessions available');
  return dirs[dirs.length - 1];
}

function getEventsPath() {
  return path.join(getLatestSessionDir(), 'events.ndjson');
}

function getFramesDir() {
  return path.join(getLatestSessionDir(), 'frames');
}

function tailFile(filePath, maxLines = 200) {
  const data = fs.readFileSync(filePath, 'utf8');
  const lines = data.trim().split('\n');
  const tail = lines.slice(Math.max(0, lines.length - maxLines));
  return tail.join('\n') + (tail.length ? '\n' : '');
}

async function toBase64(filePath) {
  const buf = await fs.promises.readFile(filePath);
  return buf.toString('base64');
}

const server = new Server(
  { name: 'desktop-vision-mcp-adapter', version: '0.1.0' },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'timeline_tail',
        description:
          'Return the tail of the events timeline as NDJSON. Optional: limit (lines), since (ms since epoch).',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number' },
            since: { type: 'number' },
          },
        },
      },
      {
        name: 'get_frame',
        description: 'Return the JPEG image for a given frame_id as base64 image content.',
        inputSchema: {
          type: 'object',
          properties: {
            frame_id: { type: 'string' },
          },
          required: ['frame_id'],
        },
      },
      {
        name: 'latest_frame',
        description: 'Return the most recent frame image and its frame_id.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'mark_bookmark',
        description: 'Append a bookmark marker with a label to the current events.ndjson.',
        inputSchema: {
          type: 'object',
          properties: {
            label: { type: 'string' },
          },
          required: ['label'],
        },
      },
      {
        name: 'timeline_follow',
        description:
          'Block up to max_duration_ms while watching the timeline and return any new events since the given timestamp (ms). Returns NDJSON text. Use this to approximate streaming.',
        inputSchema: {
          type: 'object',
          properties: {
            since: { type: 'number', description: 'Only include events with t >= since (ms since epoch)' },
            max_duration_ms: { type: 'number', description: 'Maximum time to wait for new events', default: 5000 },
            max_events: { type: 'number', description: 'Stop after this many new events', default: 200 },
          },
          required: ['since'],
        },
      },
      {
        name: 'summarize_frame',
        description:
          'Create and cache a compressed thumbnail for the given frame_id and return base64 image plus metadata path. Avoids large files.',
        inputSchema: {
          type: 'object',
          properties: {
            frame_id: { type: 'string' },
            width: { type: 'number', description: 'Thumbnail width in px', default: 512 },
            quality: { type: 'number', description: 'JPEG quality 1-100', default: 60 },
          },
          required: ['frame_id'],
        },
      },
      {
        name: 'summarize_latest_frame',
        description: 'Like summarize_frame but operates on the latest frame.',
        inputSchema: {
          type: 'object',
          properties: {
            width: { type: 'number', default: 512 },
            quality: { type: 'number', default: 60 },
          },
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  if (name === 'timeline_tail') {
    const limit = typeof args?.limit === 'number' ? Math.max(1, Math.min(2000, args.limit)) : 200;
    const since = typeof args?.since === 'number' ? args.since : null;
    const eventsPath = getEventsPath();
    let text = tailFile(eventsPath, limit);
    if (since) {
      const filtered = text
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          try { return JSON.parse(l); } catch { return null; }
        })
        .filter((o) => o && typeof o.t === 'number' && o.t >= since)
        .map((o) => JSON.stringify(o))
        .join('\n');
      text = filtered + (filtered ? '\n' : '');
    }
    return {
      content: [
        { type: 'text', text },
      ],
    };
  }

  if (name === 'get_frame') {
    const frameId = String(args?.frame_id || '');
    if (!frameId) throw new Error('frame_id required');
    const jpgPath = path.join(getFramesDir(), `${frameId}.jpg`);
    if (!fs.existsSync(jpgPath)) throw new Error(`frame not found: ${jpgPath}`);
    const b64 = await toBase64(jpgPath);
    return {
      content: [
        { type: 'text', text: JSON.stringify({ frame_id: frameId }) },
        { type: 'image', data: b64, mimeType: 'image/jpeg' },
      ],
    };
  }

  if (name === 'timeline_follow') {
    const since = Number(args?.since);
    const maxDurationMs = Number(args?.max_duration_ms ?? 5000);
    const maxEvents = Number(args?.max_events ?? 200);
    if (!Number.isFinite(since)) throw new Error('since (ms) required');
    const eventsPath = getEventsPath();

    const readNew = () => {
      const text = fs.readFileSync(eventsPath, 'utf8');
      const out = [];
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (typeof obj?.t === 'number' && obj.t >= since) out.push(JSON.stringify(obj));
        } catch {}
      }
      return out;
    };

    const initial = readNew();
    const collected = [...initial];
    if (collected.length >= maxEvents || maxDurationMs <= 0) {
      return { content: [{ type: 'text', text: collected.join('\n') + (collected.length ? '\n' : '') }] };
    }

    let done = false;
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        done = true;
        try { watcher.close(); } catch {}
        resolve(null);
      }, maxDurationMs);
      const watcher = fs.watch(eventsPath, { persistent: false }, () => {
        if (done) return;
        const next = readNew();
        if (next.length > collected.length) {
          collected.splice(0, collected.length, ...next);
          if (collected.length >= maxEvents) {
            done = true;
            clearTimeout(timeout);
            try { watcher.close(); } catch {}
            resolve(null);
          }
        }
      });
    });

    return { content: [{ type: 'text', text: collected.join('\n') + (collected.length ? '\n' : '') }] };
  }

  if (name === 'summarize_frame' || name === 'summarize_latest_frame') {
    const sharp = (await import('sharp')).default;
    const framesDir = getFramesDir();
    let frameId = name === 'summarize_latest_frame' ? null : String(args?.frame_id || '');
    const width = Number(args?.width ?? 512);
    const quality = Number(args?.quality ?? 60);
    if (name === 'summarize_latest_frame') {
      const files = fs.readdirSync(framesDir).filter((f) => f.endsWith('.jpg')).sort();
      if (files.length === 0) throw new Error('no frames available');
      frameId = path.basename(files[files.length - 1], '.jpg');
    }
    if (!frameId) throw new Error('frame_id required');
    const sourcePath = path.join(framesDir, `${frameId}.jpg`);
    if (!fs.existsSync(sourcePath)) throw new Error(`frame not found: ${sourcePath}`);
    const sessionDir = getLatestSessionDir();
    const summariesDir = path.join(sessionDir, 'summaries');
    if (!fs.existsSync(summariesDir)) fs.mkdirSync(summariesDir);
    const thumbPath = path.join(summariesDir, `${frameId}-w${width}-q${quality}.jpg`);
    const metaPath = path.join(summariesDir, `${frameId}.json`);

    // Create thumbnail if missing
    if (!fs.existsSync(thumbPath)) {
      await sharp(sourcePath).resize({ width, withoutEnlargement: true }).jpeg({ quality }).toFile(thumbPath);
    }
    // Basic image stats for lightweight summary
    const { width: w, height: h, channels } = await sharp(sourcePath).metadata();
    const stats = await sharp(sourcePath).stats();
    const avg = stats.channels?.map((c) => Math.round(c.mean)) ?? [];
    const summary = { frame_id: frameId, width: w, height: h, channels, average_rgb: avg, thumb: path.basename(thumbPath) };
    try { fs.writeFileSync(metaPath, JSON.stringify(summary, null, 2)); } catch {}

    const b64 = await fs.promises.readFile(thumbPath).then((b) => b.toString('base64'));
    return {
      content: [
        { type: 'text', text: JSON.stringify({ frame_id: frameId, thumb_file: thumbPath, meta_file: metaPath }) },
        { type: 'image', data: b64, mimeType: 'image/jpeg' },
      ],
    };
  }

  if (name === 'latest_frame') {
    const framesDir = getFramesDir();
    const files = fs
      .readdirSync(framesDir)
      .filter((f) => f.endsWith('.jpg'))
      .sort();
    if (files.length === 0) throw new Error('no frames available');
    const fname = files[files.length - 1];
    const frameId = path.basename(fname, '.jpg');
    const b64 = await toBase64(path.join(framesDir, fname));
    return {
      content: [
        { type: 'text', text: JSON.stringify({ frame_id: frameId }) },
        { type: 'image', data: b64, mimeType: 'image/jpeg' },
      ],
    };
  }

  if (name === 'mark_bookmark') {
    const label = String(args?.label || '').trim();
    if (!label) throw new Error('label required');
    const eventsPath = getEventsPath();
    const ts = Date.now();
    fs.appendFileSync(eventsPath, JSON.stringify({ t: ts, etype: 'marker.bookmark', label }) + '\n');
    return {
      content: [
        { type: 'text', text: JSON.stringify({ ok: true, t: ts, label }) },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);


