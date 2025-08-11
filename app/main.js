const { app, BrowserWindow, desktopCapturer, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const sessionDir = path.join(__dirname, '..', 'sessions', new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(path.join(sessionDir, 'frames'), { recursive: true });
fs.writeFileSync(path.join(sessionDir,'meta.json'), JSON.stringify({ version:"0.1.0", session_dir: sessionDir, started_at: Date.now(), fps_baseline: 2 }, null, 2));
const eventsPath = path.join(sessionDir, 'events.ndjson');
function appendEvent(o){ fs.appendFileSync(eventsPath, JSON.stringify(o)+"\n"); }

// Audio recording process management
let asrProcess = null;
let backendProcess = null;
async function createWindow() {
  const win = new BrowserWindow({ width: 900, height: 700, webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  await win.loadFile('index.html');
  win.webContents.openDevTools({ mode: 'undocked' });
}
app.whenReady().then(createWindow);
app.on('window-all-closed', ()=> app.quit());
ipcMain.handle('get-sources', async ()=> {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 }});
  return sources.map(s=>({ id: s.id, name: s.name }));
});
ipcMain.on('frame', (e, { timestamp, jpgBuffer }) => {
  const fn = path.join(sessionDir, 'frames', `${timestamp}.jpg`);
  fs.writeFileSync(fn, Buffer.from(jpgBuffer));
  appendEvent({ t: timestamp, etype: 'ui.frame', frame_id: `${timestamp}` });
});
ipcMain.on('bookmark', (e, label) => { appendEvent({ t: Date.now(), etype:'marker.bookmark', label }); });

// Audio recording control
ipcMain.handle('start-audio', async () => {
  if (asrProcess) return { success: false, message: 'Audio recording already running' };
  
  try {
    // Start ASR Python server
    asrProcess = spawn('bash', ['-lc', `cd ${path.join(__dirname, '..', 'asr')} && source .venv/bin/activate || python3 -m venv .venv && source .venv/bin/activate; pip install -q --upgrade pip && pip install -q flask sounddevice numpy faster-whisper pydub; python server.py`], {
      stdio: 'pipe',
      cwd: path.join(__dirname, '..'),
      detached: false
    });
    
    // Start backend server
    backendProcess = spawn('node', ['backend/server.js'], {
      stdio: 'pipe', 
      cwd: path.join(__dirname, '..'),
      detached: false
    });
    
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
      asrProcess.kill('SIGTERM');
      asrProcess = null;
    }
    if (backendProcess) {
      backendProcess.kill('SIGTERM');
      backendProcess = null;
    }
    return { success: true, message: 'Audio recording stopped' };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

// Cleanup on app quit
app.on('before-quit', () => {
  if (asrProcess) {
    asrProcess.kill('SIGTERM');
    asrProcess = null;
  }
  if (backendProcess) {
    backendProcess.kill('SIGTERM');
    backendProcess = null;
  }
});