const { app, BrowserWindow, desktopCapturer, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const sessionDir = path.join(__dirname, '..', 'sessions', new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(path.join(sessionDir, 'frames'), { recursive: true });
fs.writeFileSync(path.join(sessionDir,'meta.json'), JSON.stringify({ version:"0.1.0", session_dir: sessionDir, started_at: Date.now(), fps_baseline: 2 }, null, 2));
const eventsPath = path.join(sessionDir, 'events.ndjson');
function appendEvent(o){ fs.appendFileSync(eventsPath, JSON.stringify(o)+"\n"); }
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