import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load .env from resources in production, or project root in dev
const envPath = app.isPackaged
  ? path.join(process.resourcesPath, '.env')
  : path.join(__dirname, '../.env');
dotenv.config({ path: envPath });

import { ForgeOrchestrator } from '../src/orchestrator';
import { setLogCallback } from '../src/utils/logger';

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

  if (apiKey) {
    orchestrator = new ForgeOrchestrator(apiKey, projectPath);
  }

  // Wire logger → renderer IPC for live activity stream
  setLogCallback((type: string, message: string) => {
    mainWindow?.webContents.send('forge:log', { type, message });
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
ipcMain.handle('forge:send', async (_event, message: string) => {
  if (!orchestrator) {
    return { error: 'ANTHROPIC_API_KEY not configured. Please set it in your .env file.' };
  }

  try {
    const output = await orchestrator.process(message);
    return { output };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
});

// IPC: get config/status
ipcMain.handle('forge:status', async () => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const projectPath = process.env.TARGET_PROJECT_PATH || '/Users/gauravpassi/Desktop/AgenticAI/agenticai-demo';
  return {
    configured: !!apiKey,
    projectPath,
    projectName: path.basename(projectPath)
  };
});

// IPC: open external URLs
ipcMain.handle('forge:open-external', async (_event, url: string) => {
  shell.openExternal(url);
});
