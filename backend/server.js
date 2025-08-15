const express = require('express');
const fs = require('fs'); const path = require('path'); const WebSocket = require('ws');
const pty = require('node-pty');
const { spawn } = require('child_process');
const SESSIONS_DIR = path.join(__dirname,'..','sessions');

// Terminal session management
const terminalSessions = new Map();

function getLatestSessionDir() {
  const dirs = fs.readdirSync(SESSIONS_DIR)
    .filter(d => d !== 'archived')
    .map(n => path.join(SESSIONS_DIR, n))
    .filter(p => fs.existsSync(p) && fs.statSync(p).isDirectory())
    .sort();
  return dirs[dirs.length - 1];
}
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/frame/:id', (req,res)=> {
  const sessionDir = getLatestSessionDir();
  const p = path.join(sessionDir,'frames', `${req.params.id}.jpg`);
  if (!fs.existsSync(p)) return res.sendStatus(404);
  res.sendFile(p);
});
// Control state and process management
let serviceStatus = {
  vision: false,
  audio: false,
  backend: true
};

let asrProcess = null;
let electronProcess = null;

// Service control endpoints
app.post('/control/vision/start', (req, res) => {
  // This endpoint will be called by MCP
  // The actual vision control happens in Electron app
  serviceStatus.vision = true;
  res.json({ success: true, message: 'Vision start command sent' });
});

app.post('/control/vision/stop', (req, res) => {
  serviceStatus.vision = false;
  res.json({ success: true, message: 'Vision stop command sent' });
});

app.post('/control/audio/start', (req, res) => {
  serviceStatus.audio = true;
  res.json({ success: true, message: 'Audio start command sent' });
});

app.post('/control/audio/stop', (req, res) => {
  serviceStatus.audio = false;
  res.json({ success: true, message: 'Audio stop command sent' });
});

app.get('/status', (req, res) => {
  res.json(serviceStatus);
});

// Unified start/stop endpoints for Svelte UI
app.post('/api/start', async (req, res) => {
  try {
    console.log('Starting all services...');
    
    // Start ASR (Audio Speech Recognition)
    if (!asrProcess) {
      asrProcess = spawn('bash', ['-lc', `cd ${path.join(__dirname, '..', 'asr')} && source .venv/bin/activate || python3 -m venv .venv && source .venv/bin/activate; pip install -q --upgrade pip && pip install -q flask sounddevice numpy faster-whisper pydub; python server.py`], {
        stdio: 'pipe',
        cwd: path.join(__dirname, '..'),
        detached: true,
        killSignal: 'SIGTERM'
      });
      
      asrProcess.on('error', (err) => console.error('ASR process error:', err));
      asrProcess.unref();
      console.log('ASR process started');
    }
    
    // Start Electron (Vision capture)
    if (!electronProcess) {
      electronProcess = spawn('npm', ['start'], {
        stdio: 'pipe',
        cwd: path.join(__dirname, '..'),
        detached: true,
        killSignal: 'SIGTERM'
      });
      
      electronProcess.on('error', (err) => console.error('Electron process error:', err));
      electronProcess.unref();
      console.log('Electron process started');
    }
    
    // Update status
    serviceStatus.vision = true;
    serviceStatus.audio = true;
    
    res.json({ 
      success: true, 
      message: 'All services started successfully' 
    });
    
  } catch (error) {
    console.error('Failed to start services:', error);
    res.status(500).json({ 
      success: false, 
      message: `Failed to start services: ${error.message}` 
    });
  }
});

app.post('/api/stop', async (req, res) => {
  try {
    console.log('Stopping all services...');
    
    // Stop ASR process
    if (asrProcess) {
      try {
        process.kill(-asrProcess.pid, 'SIGTERM');
      } catch (e) {
        asrProcess.kill('SIGTERM');
      }
      asrProcess = null;
      console.log('ASR process stopped');
    }
    
    // Stop Electron process
    if (electronProcess) {
      try {
        process.kill(-electronProcess.pid, 'SIGTERM');
      } catch (e) {
        electronProcess.kill('SIGTERM');
      }
      electronProcess = null;
      console.log('Electron process stopped');
    }
    
    // Update status
    serviceStatus.vision = false;
    serviceStatus.audio = false;
    
    res.json({ 
      success: true, 
      message: 'All services stopped successfully' 
    });
    
  } catch (error) {
    console.error('Failed to stop services:', error);
    res.status(500).json({ 
      success: false, 
      message: `Failed to stop services: ${error.message}` 
    });
  }
});

// Session management endpoints
app.post('/control/session/create', (req, res) => {
  try {
    // Create new session directory
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sessionName = `session-${timestamp}`;
    const sessionPath = path.join(SESSIONS_DIR, sessionName);
    
    // Create session directories
    fs.mkdirSync(sessionPath, { recursive: true });
    fs.mkdirSync(path.join(sessionPath, 'frames'), { recursive: true });
    
    // Initialize events file
    const eventsPath = path.join(sessionPath, 'events.ndjson');
    const initEvent = {
      t: Date.now(),
      etype: 'session.created',
      session: sessionName
    };
    fs.writeFileSync(eventsPath, JSON.stringify(initEvent) + '\n');
    
    res.json({
      success: true,
      message: 'New session created',
      session: sessionName,
      path: sessionPath
    });
  } catch (error) {
    console.error('Failed to create session:', error);
    res.status(500).json({
      success: false,
      message: `Failed to create session: ${error.message}`
    });
  }
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
      { name: "mark_bookmark", input_schema: { type:"object", properties:{ label:{type:"string"} } } },
      { name: "start_vision", input_schema: { type:"object", properties:{} } },
      { name: "stop_vision", input_schema: { type:"object", properties:{} } },
      { name: "start_audio", input_schema: { type:"object", properties:{} } },
      { name: "stop_audio", input_schema: { type:"object", properties:{} } },
      { name: "get_status", input_schema: { type:"object", properties:{} } },
      { name: "start_recording_session", input_schema: { type:"object", properties:{} } },
      { name: "stop_recording_session", input_schema: { type:"object", properties:{} } },
      { name: "create_new_session", input_schema: { type:"object", properties:{} } }
    ]
  });
});
// Cleanup on process exit
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
process.on('exit', cleanup);

function cleanup() {
  console.log('Cleaning up processes...');
  if (asrProcess) {
    try { process.kill(-asrProcess.pid, 'SIGKILL'); } catch (e) {}
  }
  if (electronProcess) {
    try { process.kill(-electronProcess.pid, 'SIGKILL'); } catch (e) {}
  }
}

const server = app.listen(6060, ()=> console.log('HTTP on 6060'));

// Single WebSocket server with path-based routing
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  
  console.log(`WebSocket connection to ${pathname}`);
  
  if (pathname === '/timeline') {
    handleTimelineConnection(ws, req);
  } else if (pathname === '/live/vision') {
    handleLiveVisionConnection(ws, req);
  } else if (pathname === '/live/audio') {
    handleLiveAudioConnection(ws, req);
  } else if (pathname === '/live/combined') {
    handleLiveCombinedConnection(ws, req);
  } else if (pathname === '/terminal') {
    handleTerminalConnection(ws, req);
  } else {
    ws.close(4404, 'Unknown path');
  }
});

// Timeline connection handler (original functionality)
function handleTimelineConnection(ws, req) {
  const since = parseInt(new URL(req.url, 'http://x').searchParams.get('since')||'0',10);
  const sessionDir = getLatestSessionDir();
  const eventsPath = path.join(sessionDir, 'events.ndjson');
  const stream = fs.createReadStream(eventsPath, { encoding:'utf8' });
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
    const watcher = fs.watch(eventsPath, ()=> {
      const s = fs.readFileSync(eventsPath, 'utf8'); const last = s.trim().split('\n').pop();
      if (last) ws.send(last);
    });
    ws.on('close', ()=> watcher.close());
  });
}

// Live Vision connection handler
function handleLiveVisionConnection(ws, req) {
  console.log('Live vision client connected');
  
  let isActive = true;
  let lastFrameTime = 0;
  const minInterval = 1000; // Max 1 frame per second for live streaming
  
  // Function to send latest frame
  const sendLatestFrame = () => {
    if (!isActive) return;
    
    try {
      const sessionDir = getLatestSessionDir();
      const framesDir = path.join(sessionDir, 'frames');
      
      if (!fs.existsSync(framesDir)) return;
      
      const frames = fs.readdirSync(framesDir)
        .filter(f => f.endsWith('.jpg'))
        .sort()
        .slice(-1);
      
      if (frames.length > 0) {
        const latestFrame = frames[0];
        const frameId = latestFrame.replace('.jpg', '');
        const framePath = path.join(framesDir, latestFrame);
        const frameBuffer = fs.readFileSync(framePath);
        const base64 = frameBuffer.toString('base64');
        
        ws.send(JSON.stringify({
          type: 'frame',
          frame_id: frameId,
          timestamp: parseInt(frameId),
          data: base64,
          format: 'jpeg'
        }));
      }
    } catch (error) {
      console.error('Live vision error:', error);
    }
  };
  
  // Send initial frame
  sendLatestFrame();
  
  // Watch for new frames
  const sessionDir = getLatestSessionDir();
  const eventsPath = path.join(sessionDir, 'events.ndjson');
  const watcher = fs.watch(eventsPath, () => {
    const now = Date.now();
    if (now - lastFrameTime > minInterval) {
      lastFrameTime = now;
      sendLatestFrame();
    }
  });
  
  ws.on('close', () => {
    isActive = false;
    try { watcher.close(); } catch (e) {}
    console.log('Live vision client disconnected');
  });
  
  ws.on('error', (error) => {
    console.error('Live vision WebSocket error:', error);
    isActive = false;
  });
}

// Live Audio connection handler
function handleLiveAudioConnection(ws, req) {
  console.log('Live audio client connected');
  
  let isActive = true;
  const sessionDir = getLatestSessionDir();
  const eventsPath = path.join(sessionDir, 'events.ndjson');
  
  // Send recent speech events
  const sendRecentSpeech = () => {
    if (!isActive) return;
    
    try {
      if (!fs.existsSync(eventsPath)) return;
      
      const content = fs.readFileSync(eventsPath, 'utf8');
      const lines = content.trim().split('\n').slice(-10); // Last 10 events
      
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.etype === 'speech.final' && event.text) {
            ws.send(JSON.stringify({
              type: 'speech',
              timestamp: event.t,
              text: event.text,
              final: true
            }));
          }
        } catch (e) {}
      }
    } catch (error) {
      console.error('Live audio error:', error);
    }
  };
  
  // Send initial recent speech
  sendRecentSpeech();
  
  // Watch for new speech events
  const watcher = fs.watch(eventsPath, () => {
    if (!isActive) return;
    
    try {
      const content = fs.readFileSync(eventsPath, 'utf8');
      const lastLine = content.trim().split('\n').pop();
      if (lastLine) {
        const event = JSON.parse(lastLine);
        if (event.etype === 'speech.final' && event.text) {
          ws.send(JSON.stringify({
            type: 'speech',
            timestamp: event.t,
            text: event.text,
            final: true
          }));
        }
      }
    } catch (error) {
      console.error('Live audio watch error:', error);
    }
  });
  
  ws.on('close', () => {
    isActive = false;
    try { watcher.close(); } catch (e) {}
    console.log('Live audio client disconnected');
  });
  
  ws.on('error', (error) => {
    console.error('Live audio WebSocket error:', error);
    isActive = false;
  });
}

// Live Combined connection handler
function handleLiveCombinedConnection(ws, req) {
  console.log('Live combined client connected');
  
  let isActive = true;
  let lastFrameTime = 0;
  const minInterval = 2000; // Max 0.5 fps for combined stream
  const sessionDir = getLatestSessionDir();
  const eventsPath = path.join(sessionDir, 'events.ndjson');
  
  const sendUpdate = () => {
    if (!isActive) return;
    
    try {
      // Get latest frame
      const framesDir = path.join(sessionDir, 'frames');
      let frameData = null;
      
      if (fs.existsSync(framesDir)) {
        const frames = fs.readdirSync(framesDir)
          .filter(f => f.endsWith('.jpg'))
          .sort()
          .slice(-1);
        
        if (frames.length > 0) {
          const latestFrame = frames[0];
          const frameId = latestFrame.replace('.jpg', '');
          const framePath = path.join(framesDir, latestFrame);
          const frameBuffer = fs.readFileSync(framePath);
          const base64 = frameBuffer.toString('base64');
          
          frameData = {
            frame_id: frameId,
            timestamp: parseInt(frameId),
            data: base64,
            format: 'jpeg'
          };
        }
      }
      
      // Get recent speech
      let recentSpeech = [];
      if (fs.existsSync(eventsPath)) {
        const content = fs.readFileSync(eventsPath, 'utf8');
        const lines = content.trim().split('\n').slice(-5); // Last 5 events
        
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.etype === 'speech.final' && event.text) {
              recentSpeech.push({
                timestamp: event.t,
                text: event.text
              });
            }
          } catch (e) {}
        }
      }
      
      ws.send(JSON.stringify({
        type: 'combined',
        timestamp: Date.now(),
        vision: frameData,
        audio: recentSpeech
      }));
    } catch (error) {
      console.error('Live combined error:', error);
    }
  };
  
  // Send initial update
  sendUpdate();
  
  // Watch for updates
  const watcher = fs.watch(eventsPath, () => {
    const now = Date.now();
    if (now - lastFrameTime > minInterval) {
      lastFrameTime = now;
      sendUpdate();
    }
  });
  
  ws.on('close', () => {
    isActive = false;
    try { watcher.close(); } catch (e) {}
    console.log('Live combined client disconnected');
  });
  
  ws.on('error', (error) => {
    console.error('Live combined WebSocket error:', error);
    isActive = false;
  });
}

// Terminal connection handler
function handleTerminalConnection(ws, req) {
  console.log('Terminal client connected');
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      if (message.type === 'init') {
        createTerminalSession(message.session, ws);
      } else if (message.type === 'input') {
        sendToTerminal(message.session, message.data);
      } else if (message.type === 'resize') {
        resizeTerminal(message.session, message.cols, message.rows);
      }
    } catch (error) {
      console.error('Terminal message error:', error);
    }
  });
  
  ws.on('close', () => {
    console.log('Terminal client disconnected');
    // Clean up terminal sessions associated with this WebSocket
    for (const [sessionId, session] of terminalSessions.entries()) {
      if (session.ws === ws) {
        session.ptyProcess.kill();
        terminalSessions.delete(sessionId);
        console.log(`Cleaned up terminal session: ${sessionId}`);
      }
    }
  });
  
  ws.on('error', (error) => {
    console.error('Terminal WebSocket error:', error);
  });
}

function createTerminalSession(sessionId, ws) {
  try {
    // Create a new PTY process
    const shell = process.platform === 'win32' ? 'cmd.exe' : 'bash';
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: process.cwd(), // Use project directory
      env: {
        ...process.env,
        TERM: 'xterm-color',
        PS1: '\\[\\033[01;32m\\]desktop-vision\\[\\033[00m\\]:\\[\\033[01;34m\\]\\w\\[\\033[00m\\]$ ',
        HISTCONTROL: 'ignoredups:erasedups'
      }
    });
    
    // Store the session
    terminalSessions.set(sessionId, {
      ptyProcess,
      ws
    });
    
    // Handle PTY output
    ptyProcess.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'output',
          session: sessionId,
          data: data
        }));
      }
    });
    
    // Handle PTY exit
    ptyProcess.onExit(({ exitCode, signal }) => {
      console.log(`Terminal session ${sessionId} exited with code ${exitCode}`);
      terminalSessions.delete(sessionId);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'exit',
          session: sessionId,
          exitCode
        }));
      }
    });
    
    // Send customized welcome message
    setTimeout(() => {
      if (sessionId === 'logs') {
        ptyProcess.write('clear\n');
        ptyProcess.write('echo "\033[1;36m=== Desktop Vision MVP - Logs Terminal ===\033[0m"\n');
        ptyProcess.write('echo "\033[0;33mUseful commands:\033[0m"\n');
        ptyProcess.write('echo "  tail -f logs/*.log        - Follow application logs"\n');
        ptyProcess.write('echo "  ls sessions/              - List recording sessions"\n');
        ptyProcess.write('echo "  curl localhost:6060/status - Check service status"\n');
        ptyProcess.write('echo ""\n');
      } else if (sessionId.startsWith('term-')) {
        ptyProcess.write('clear\n');
        ptyProcess.write('echo "\033[1;32m=== New Terminal Session ===\033[0m"\n');
        ptyProcess.write('pwd\n');
      } else {
        ptyProcess.write('clear\n');
        ptyProcess.write('echo "\033[1;36m=== Desktop Vision MVP Terminal ===\033[0m"\n');
        ptyProcess.write('echo "\033[0;33mQuick start commands:\033[0m"\n');
        ptyProcess.write('echo "  npm run start:all         - Start all services"\n');
        ptyProcess.write('echo "  npm run backend           - Backend server only"\n');
        ptyProcess.write('echo "  npm run asr               - Audio recognition only"\n');
        ptyProcess.write('echo "  npm start                 - Electron app only"\n');
        ptyProcess.write('echo ""\n');
      }
    }, 200);
    
    console.log(`Created terminal session: ${sessionId}`);
    
    // Notify client
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'session_created',
        session: sessionId
      }));
    }
    
  } catch (error) {
    console.error(`Failed to create terminal session ${sessionId}:`, error);
  }
}

function sendToTerminal(sessionId, data) {
  const session = terminalSessions.get(sessionId);
  if (session && session.ptyProcess) {
    session.ptyProcess.write(data);
  }
}

function resizeTerminal(sessionId, cols, rows) {
  const session = terminalSessions.get(sessionId);
  if (session && session.ptyProcess) {
    try {
      session.ptyProcess.resize(cols, rows);
    } catch (error) {
      console.error(`Failed to resize terminal ${sessionId}:`, error);
    }
  }
}