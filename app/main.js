const { app, BrowserWindow, desktopCapturer, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const sessionTimestamp = new Date();
const sessionDir = path.join(__dirname, '..', 'sessions', sessionTimestamp.toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(path.join(sessionDir, 'frames'), { recursive: true });

// Enhanced metadata for date-based discovery and AI processing
const sessionMetadata = {
  version: "0.2.0",
  session_id: path.basename(sessionDir),
  session_dir: sessionDir,
  created_at: sessionTimestamp.toISOString(),
  created_timestamp: Date.now(),
  created_date: sessionTimestamp.toISOString().split('T')[0], // YYYY-MM-DD
  created_time: sessionTimestamp.toTimeString().split(' ')[0], // HH:MM:SS
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  purpose: "ai_app_building_capture",
  capture_types: ["screen", "audio", "speech"],
  status: "active",
  fps_baseline: 2,
  platform: process.platform,
  electron_version: process.versions.electron,
  node_version: process.versions.node
};

fs.writeFileSync(path.join(sessionDir,'meta.json'), JSON.stringify(sessionMetadata, null, 2));
const eventsPath = path.join(sessionDir, 'events.ndjson');

function appendEvent(o){ fs.appendFileSync(eventsPath, JSON.stringify(o)+"\n"); }

function updateSessionMetadata(updates) {
  const metaPath = path.join(sessionDir, 'meta.json');
  const currentMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const updatedMeta = { ...currentMeta, ...updates, last_updated: new Date().toISOString() };
  fs.writeFileSync(metaPath, JSON.stringify(updatedMeta, null, 2));
}

// Audio recording process management
let asrProcess = null;
let backendProcess = null;
async function createWindow() {
  const win = new BrowserWindow({ 
    width: 1400, 
    height: 1000,
    webPreferences: { preload: path.join(__dirname, 'preload.js') } 
  });
  await win.loadFile('index.html');
  win.webContents.openDevTools({ mode: 'undocked' });
}
// Cleanup function to finalize session metadata
function finalizeSession() {
  try {
    const endTime = Date.now();
    const totalDuration = lastFrameTime ? lastFrameTime - firstFrameTime : 0;
    
    updateSessionMetadata({
      status: "completed",
      ended_at: new Date().toISOString(),
      ended_timestamp: endTime,
      final_frame_count: frameCount,
      total_duration_ms: totalDuration,
      total_duration_readable: `${Math.floor(totalDuration / 60000)}:${String(Math.floor((totalDuration % 60000) / 1000)).padStart(2, '0')}`,
      final_fps: frameCount > 0 && totalDuration > 0 ? frameCount / (totalDuration / 1000) : 0,
      has_audio: fs.existsSync(path.join(sessionDir, 'audio')),
      has_frames: frameCount > 0,
      file_count: {
        frames: frameCount,
        audio_chunks: fs.existsSync(path.join(sessionDir, 'audio', 'chunks')) ? fs.readdirSync(path.join(sessionDir, 'audio', 'chunks')).length : 0
      }
    });
    
    console.log(`📊 Session finalized: ${frameCount} frames, ${Math.floor(totalDuration/1000)}s duration`);
  } catch (error) {
    console.error('Error finalizing session:', error);
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  finalizeSession();
  app.quit();
});

// Also finalize on process termination
process.on('SIGTERM', finalizeSession);
process.on('SIGINT', finalizeSession);
ipcMain.handle('get-sources', async ()=> {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 }});
  return sources.map(s=>({ id: s.id, name: s.name }));
});
// Recording statistics
let frameCount = 0;
let firstFrameTime = null;
let lastFrameTime = null;

ipcMain.on('frame', (e, { timestamp, jpgBuffer }) => {
  const fn = path.join(sessionDir, 'frames', `${timestamp}.jpg`);
  fs.writeFileSync(fn, Buffer.from(jpgBuffer));
  appendEvent({ t: timestamp, etype: 'ui.frame', frame_id: `${timestamp}` });
  
  // Update recording statistics
  frameCount++;
  if (!firstFrameTime) firstFrameTime = timestamp;
  lastFrameTime = timestamp;
  
  // Update session metadata every 50 frames to avoid excessive I/O
  if (frameCount % 50 === 0) {
    const duration = lastFrameTime - firstFrameTime;
    updateSessionMetadata({
      status: "recording",
      frame_count: frameCount,
      recording_duration_ms: duration,
      recording_duration_readable: `${Math.floor(duration / 60000)}:${String(Math.floor((duration % 60000) / 1000)).padStart(2, '0')}`,
      fps_actual: frameCount / (duration / 1000),
      last_frame_time: new Date(lastFrameTime).toISOString()
    });
  }
});
ipcMain.on('bookmark', (e, label) => { appendEvent({ t: Date.now(), etype:'marker.bookmark', label }); });

// Audio recording control
ipcMain.handle('start-audio', async () => {
  if (asrProcess) return { success: false, message: 'Audio recording already running' };
  
  try {
    // Start ASR Python server with session directory passed as environment variable
    asrProcess = spawn('bash', ['-lc', `cd ${path.join(__dirname, '..', 'asr')} && source .venv/bin/activate || python3 -m venv .venv && source .venv/bin/activate; pip install -q --upgrade pip && pip install -q flask sounddevice numpy faster-whisper pydub; python server.py`], {
      stdio: 'pipe',
      cwd: path.join(__dirname, '..'),
      detached: true,  // Create new process group
      killSignal: 'SIGTERM',
      env: { ...process.env, SESSION_DIR: sessionDir }
    });
    
    // Ensure we can still track the process
    if (asrProcess.pid) {
      asrProcess.unref(); // Don't keep the event loop alive
    }
    
    // Start backend server with process group management
    backendProcess = spawn('node', ['backend/server.js'], {
      stdio: 'pipe', 
      cwd: path.join(__dirname, '..'),
      detached: true,  // Create new process group
      killSignal: 'SIGTERM'
    });
    
    // Ensure we can still track the process
    if (backendProcess.pid) {
      backendProcess.unref(); // Don't keep the event loop alive
    }
    
    asrProcess.on('error', (err) => console.error('ASR process error:', err));
    backendProcess.on('error', (err) => console.error('Backend process error:', err));
    
    return { success: true, message: 'Audio recording started' };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('stop-audio', async () => {
  if (!asrProcess && !backendProcess) return { success: false, message: 'No audio recording running' };
  
  try {
    if (asrProcess) {
      // Kill the entire process group to ensure child processes are terminated
      try {
        process.kill(-asrProcess.pid, 'SIGTERM');
      } catch (e) {
        // Fallback to killing just the main process
        asrProcess.kill('SIGTERM');
      }
      asrProcess = null;
    }
    if (backendProcess) {
      try {
        process.kill(-backendProcess.pid, 'SIGTERM');
      } catch (e) {
        backendProcess.kill('SIGTERM');
      }
      backendProcess = null;
    }
    return { success: true, message: 'Audio recording stopped' };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

// Session archiving function
function runArchiving() {
  const archiveScript = path.join(__dirname, '..', 'scripts', 'archive-sessions.js');
  const archiveProcess = spawn('node', [archiveScript], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
  });
  
  archiveProcess.on('error', (err) => {
    console.error('Archive process error:', err);
  });
  
  archiveProcess.on('close', (code) => {
    console.log(`Archive process completed with code ${code}`);
  });
}

// Run archiving on app startup (non-blocking)
setTimeout(() => {
  console.log('Running session archiving check...');
  runArchiving();
}, 5000); // Wait 5 seconds after app starts

// Run archiving periodically (every 6 hours)
setInterval(() => {
  console.log('Running periodic session archiving...');
  runArchiving();
}, 6 * 60 * 60 * 1000); // 6 hours

// Session archiving IPC handler
ipcMain.handle('archive-sessions', async () => {
  try {
    runArchiving();
    return { success: true, message: 'Archiving process started' };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

// Cleanup on app quit
app.on('before-quit', () => {
  console.log('App quitting - cleaning up processes...');
  if (asrProcess) {
    console.log('Terminating ASR process:', asrProcess.pid);
    try {
      process.kill(-asrProcess.pid, 'SIGTERM');
    } catch (e) {
      console.log('Fallback kill for ASR process');
      asrProcess.kill('SIGTERM');
    }
    asrProcess = null;
  }
  if (backendProcess) {
    console.log('Terminating backend process:', backendProcess.pid);
    try {
      process.kill(-backendProcess.pid, 'SIGTERM');
    } catch (e) {
      console.log('Fallback kill for backend process');
      backendProcess.kill('SIGTERM');
    }
    backendProcess = null;
  }
});

// Additional cleanup handlers
app.on('window-all-closed', () => {
  console.log('All windows closed - ensuring process cleanup');
  // Force cleanup of any remaining processes
  if (asrProcess) {
    try { process.kill(-asrProcess.pid, 'SIGKILL'); } catch (e) {}
    asrProcess = null;
  }
  if (backendProcess) {
    try { process.kill(-backendProcess.pid, 'SIGKILL'); } catch (e) {}
    backendProcess = null;
  }
  app.quit();
});