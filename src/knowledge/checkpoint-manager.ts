import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export interface TaskCheckpoint {
  id: string;
  timestamp: string;
  userMessage: string;           // original user request
  intent: string;                // what orchestrator understood
  totalTasks: number;            // total tasks in plan
  completedTasks: string[];      // agents that finished
  currentAgent: string;          // agent running when interrupted
  currentInstruction: string;    // instruction given to that agent
  completedOutputs: string[];    // outputs collected so far
  messageHistory: Array<{ role: string; content: string }>; // compressed history
  status: 'in_progress' | 'token_limit' | 'error' | 'completed';
  errorMessage?: string;
}

function getCheckpointDir(): string {
  const base = (typeof app !== 'undefined' && app.isPackaged)
    ? app.getPath('userData')
    : path.join(__dirname, '../../knowledge');
  const dir = path.join(base, 'checkpoints');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export class CheckpointManager {
  private dir: string;

  constructor() {
    this.dir = getCheckpointDir();
  }

  save(checkpoint: TaskCheckpoint): void {
    const file = path.join(this.dir, `${checkpoint.id}.json`);
    fs.writeFileSync(file, JSON.stringify(checkpoint, null, 2), 'utf-8');
  }

  load(id: string): TaskCheckpoint | null {
    const file = path.join(this.dir, `${id}.json`);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch { return null; }
  }

  // Get most recent incomplete checkpoint
  getLatest(): TaskCheckpoint | null {
    try {
      const files = fs.readdirSync(this.dir)
        .filter(f => f.endsWith('.json'))
        .map(f => ({
          name: f,
          mtime: fs.statSync(path.join(this.dir, f)).mtimeMs
        }))
        .sort((a, b) => b.mtime - a.mtime);

      for (const f of files) {
        const cp = this.load(f.name.replace('.json', ''));
        if (cp && cp.status !== 'completed') return cp;
      }
    } catch { /* ignore */ }
    return null;
  }

  listAll(): TaskCheckpoint[] {
    try {
      return fs.readdirSync(this.dir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          try { return JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf-8')); }
          catch { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } catch { return []; }
  }

  markCompleted(id: string): void {
    const cp = this.load(id);
    if (cp) { cp.status = 'completed'; this.save(cp); }
  }

  delete(id: string): void {
    const file = path.join(this.dir, `${id}.json`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  generateId(): string {
    return `cp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  // Compress message history to keep token usage low
  compressHistory(messages: Array<{ role: string; content: string }>, maxMessages = 20): Array<{ role: string; content: string }> {
    if (messages.length <= maxMessages) return messages;
    // Keep first 2 (context) and last (maxMessages-2) messages
    const head = messages.slice(0, 2);
    const tail = messages.slice(-(maxMessages - 2));
    const summarySep = {
      role: 'user' as const,
      content: `[${messages.length - maxMessages} earlier messages summarized — continuing from checkpoint]`
    };
    return [...head, summarySep, ...tail];
  }
}
