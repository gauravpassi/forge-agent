import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { ForgeOrchestrator } from '../src/orchestrator';
import { setLogCallback } from '../src/utils/logger';
import { startPrototypeServer } from '../src/server/prototype-server';

// Load .env by reading and parsing directly — works inside asar
function loadEnv() {
  const candidates = [
    path.join(process.resourcesPath, '.env'),                    // packaged: Resources/.env
    path.join(path.dirname(path.dirname(__dirname)), '.env'),    // dev: project root
    path.join(__dirname, '../../../.env'),                       // fallback
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        for (const line of content.split('\n')) {
          const match = line.match(/^([^#=]+)=(.*)$/);
          if (match) {
            const key = match[1].trim();
            const val = match[2].trim().replace(/^["']|["']$/g, '');
            if (key && !process.env[key]) process.env[key] = val;
          }
        }
        return p; // loaded successfully
      }
    } catch { /* try next */ }
  }
  return null;
}

const loadedFrom = loadEnv();

let mainWindow: BrowserWindow | null = null;
let orchestrator: ForgeOrchestrator | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#09090b',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../../assets/icon.png'),
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, '../../electron/renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const projectPath = process.env.TARGET_PROJECT_PATH || '/Users/gauravpassi/Desktop/AgenticAI/agenticai-demo';

  startPrototypeServer();

  if (apiKey) {
    orchestrator = new ForgeOrchestrator(apiKey, projectPath);
  }

  // Wire logger → renderer IPC for live activity stream
  setLogCallback((type: string, message: string, meta?: Record<string, string>) => {
    mainWindow?.webContents.send('forge:log', { type, message, ...meta });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC: handle chat messages from renderer
ipcMain.handle(
  'forge:send',
  async (
    _event,
    message: string,
    image?: { base64: string; mediaType: string; name: string },
    doc?: { base64?: string; text?: string; name: string; docType: 'pdf' | 'text' }
  ) => {
    if (!orchestrator) {
      return { error: 'ANTHROPIC_API_KEY not configured. Please set it in your .env file.' };
    }
    try {
      const output = await orchestrator.process(message, image, doc);
      return { output };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
);

// IPC: get config/status
ipcMain.handle('forge:status', async () => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const projectPath = process.env.TARGET_PROJECT_PATH || '/Users/gauravpassi/Desktop/AgenticAI/agenticai-demo';
  return {
    configured: !!apiKey,
    projectPath,
    projectName: path.basename(projectPath),
    envSource: loadedFrom || 'not found'
  };
});

// IPC: cancel current task
ipcMain.handle('forge:cancel', async () => {
  if (orchestrator) {
    orchestrator.cancel();
    return { cancelled: true };
  }
  return { cancelled: false };
});

// IPC: open external URLs
ipcMain.handle('forge:open-external', async (_event, url: string) => {
  shell.openExternal(url);
});
