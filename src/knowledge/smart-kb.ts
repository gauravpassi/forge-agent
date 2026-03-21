import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

function getKBPath(): string {
  const base = (typeof app !== 'undefined' && app.isPackaged)
    ? app.getPath('userData')
    : path.join(__dirname, '../../knowledge');
  fs.mkdirSync(base, { recursive: true });
  return base;
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface FileEntry {
  path: string;          // relative to project root
  purpose: string;       // one-line description of what this file does
  lastModified: string;  // ISO date
  changedBy?: string;    // which task changed it
}

export interface TaskSummary {
  id: string;
  date: string;
  intent: string;
  filesChanged: string[];
  outcome: string;       // one-line summary of what was done
}

export interface ProjectMap {
  lastScanned: string;
  files: FileEntry[];
}

export interface SmartKBData {
  projectPath: string;
  techStack: string[];
  keyPatterns: string[];
  projectMap: ProjectMap;
  taskHistory: TaskSummary[];   // last 20 completed tasks (summarised)
  sessionNotes: string[];       // ephemeral notes for current session
}

// ─── SmartKB class ────────────────────────────────────────────────────────────

export class SmartKB {
  private projectPath: string;
  private kbPath: string;
  private dataFile: string;
  private data: SmartKBData;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.kbPath = getKBPath();
    this.dataFile = path.join(this.kbPath, 'smart-kb.json');
    this.data = this.load();
  }

  // ── Load / Save ────────────────────────────────────────────────────────────

  private load(): SmartKBData {
    if (fs.existsSync(this.dataFile)) {
      try {
        return JSON.parse(fs.readFileSync(this.dataFile, 'utf-8'));
      } catch { /* fall through */ }
    }
    return this.buildInitial();
  }

  private save(): void {
    this.dirty = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      if (this.dirty) {
        try {
          fs.writeFileSync(this.dataFile, JSON.stringify(this.data, null, 2), 'utf-8');
          this.dirty = false;
        } catch { /* ignore write errors */ }
      }
      this.saveTimer = null;
    }, 5000); // debounce: write at most once every 5 seconds
  }

  // Force immediate write (call on app exit or after critical updates)
  flushNow(): void {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (this.dirty) {
      try {
        fs.writeFileSync(this.dataFile, JSON.stringify(this.data, null, 2), 'utf-8');
        this.dirty = false;
      } catch { /* ignore */ }
    }
  }

  private buildInitial(): SmartKBData {
    const techStack = this.detectTechStack();
    return {
      projectPath: this.projectPath,
      techStack,
      keyPatterns: [
        'Each agent = 1 page.tsx (src/app/templates/{hub}/{name}/) + 1 route.ts (src/app/api/agents/{hub}/{name}/)',
        'All agents stream SSE via createStreamResponse() in route.ts',
        'Agent config registered in src/lib/constants.ts → AGENT_TEMPLATES array',
        'Auth: password=UpCore@2025, cookie=upcore_session',
        'Deploy: git push → Vercel auto-deploys main branch',
      ],
      projectMap: { lastScanned: '', files: [] },
      taskHistory: [],
      sessionNotes: [],
    };
  }

  private detectTechStack(): string[] {
    const pkgPath = path.join(this.projectPath, 'package.json');
    if (!fs.existsSync(pkgPath)) return ['Unknown'];
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      return Object.keys(deps).slice(0, 15);
    } catch { return ['Unknown']; }
  }

  // ── Project Map ────────────────────────────────────────────────────────────

  scanProjectMap(): void {
    const entries: FileEntry[] = [];

    // Scan template pages
    const templatesDir = path.join(this.projectPath, 'src/app/templates');
    if (fs.existsSync(templatesDir)) {
      this.walkDir(templatesDir, (filePath) => {
        const rel = path.relative(this.projectPath, filePath);
        const parts = rel.split(path.sep);
        // e.g. src/app/templates/compliance/gadsl-checker/page.tsx
        if (parts.length >= 5 && parts[parts.length-1] === 'page.tsx') {
          const hub = parts[3];
          const name = parts[4];
          entries.push({
            path: rel,
            purpose: `${name} agent UI page (${hub} hub)`,
            lastModified: this.getModTime(filePath),
          });
        }
      });
    }

    // Scan API routes
    const apiDir = path.join(this.projectPath, 'src/app/api/agents');
    if (fs.existsSync(apiDir)) {
      this.walkDir(apiDir, (filePath) => {
        const rel = path.relative(this.projectPath, filePath);
        const parts = rel.split(path.sep);
        if (parts[parts.length-1] === 'route.ts') {
          const hub = parts[4];
          const name = parts[5];
          if (hub && name) {
            entries.push({
              path: rel,
              purpose: `${name} agent API route (${hub} hub) — system prompt + streaming`,
              lastModified: this.getModTime(filePath),
            });
          }
        }
      });
    }

    // Scan key lib files
    const keyFiles = [
      'src/lib/constants.ts',
      'src/app/globals.css',
      'src/components/shared/AgentThinkingPanel.tsx',
      'src/hooks/useAgentStream.ts',
    ];
    for (const rel of keyFiles) {
      const full = path.join(this.projectPath, rel);
      if (fs.existsSync(full)) {
        entries.push({
          path: rel,
          purpose: rel.includes('constants') ? 'Agent registry — all agents defined here'
            : rel.includes('globals') ? 'Global CSS — light/dark theme overrides'
            : rel.includes('AgentThinking') ? 'Shared thinking panel component for tool call display'
            : 'Shared hook for agent SSE streaming',
          lastModified: this.getModTime(full),
        });
      }
    }

    this.data.projectMap = { lastScanned: new Date().toISOString(), files: entries };
    this.save();
  }

  private walkDir(dir: string, cb: (file: string) => void): void {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          this.walkDir(full, cb);
        } else if (entry.isFile()) {
          cb(full);
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  private getModTime(filePath: string): string {
    try { return new Date(fs.statSync(filePath).mtimeMs).toISOString().slice(0, 10); }
    catch { return ''; }
  }

  // ── After-task learning ────────────────────────────────────────────────────

  learnFromTask(taskId: string, intent: string, filesChanged: string[], agentOutput: string): void {
    // Create a compact task summary
    const outcome = agentOutput
      .replace(/\*\*/g, '')
      .split('\n')
      .find(l => l.trim().length > 20)
      ?.slice(0, 120) || intent;

    const summary: TaskSummary = {
      id: taskId,
      date: new Date().toISOString().slice(0, 10),
      intent,
      filesChanged,
      outcome,
    };

    // Update file entries in project map with changedBy
    for (const f of filesChanged) {
      const entry = this.data.projectMap.files.find(e => e.path.includes(f) || f.includes(e.path));
      if (entry) {
        entry.lastModified = new Date().toISOString().slice(0, 10);
        entry.changedBy = taskId;
      }
    }

    // Keep last 20 task summaries
    this.data.taskHistory.unshift(summary);
    if (this.data.taskHistory.length > 20) this.data.taskHistory = this.data.taskHistory.slice(0, 20);

    this.save();
  }

  // ── Targeted context per agent type ───────────────────────────────────────

  getContextFor(agentType: 'coding' | 'planning' | 'deployment' | 'testing' | 'query' | 'docs'): string {
    const { projectPath, techStack, keyPatterns, projectMap, taskHistory } = this.data;

    // Scan map if stale (older than 1 hour)
    const staleCutoff = Date.now() - 60 * 60 * 1000;
    if (!projectMap.lastScanned || new Date(projectMap.lastScanned).getTime() < staleCutoff) {
      this.scanProjectMap();
    }

    switch (agentType) {

      case 'deployment':
        // Minimal — just what's needed for git operations
        return [
          `Project: ${path.basename(projectPath)}`,
          `Path: ${projectPath}`,
          `GitHub: https://github.com/gauravpassi/agenticai-demo`,
          `Vercel: https://agenticai-demo-olive.vercel.app (auto-deploys on push to main)`,
          `Branch: main`,
        ].join('\n');

      case 'testing':
        // Just the project path and build command
        return [
          `Project path: ${projectPath}`,
          `Build command: npm run build`,
          `Check for TypeScript errors and failed imports`,
        ].join('\n');

      case 'planning':
        // File map + patterns — for understanding scope
        const fileList = projectMap.files
          .slice(0, 40)
          .map(f => `  ${f.path} — ${f.purpose}`)
          .join('\n');
        const recent = taskHistory.slice(0, 5)
          .map(t => `  [${t.date}] ${t.intent} → ${t.outcome}`)
          .join('\n');
        return [
          `# Project: ${path.basename(projectPath)}`,
          `Path: ${projectPath}`,
          `\n## Key Patterns`,
          keyPatterns.map(p => `- ${p}`).join('\n'),
          `\n## File Map (${projectMap.files.length} files)`,
          fileList,
          recent ? `\n## Recent Tasks\n${recent}` : '',
        ].filter(Boolean).join('\n');

      case 'coding':
        // File map + patterns + recent changes — most complete
        const codeFiles = projectMap.files
          .slice(0, 50)
          .map(f => `  ${f.path}${f.changedBy ? ' ✎' : ''} — ${f.purpose}`)
          .join('\n');
        const recentChanges = taskHistory.slice(0, 8)
          .map(t => `  [${t.date}] ${t.intent}: changed ${t.filesChanged.join(', ')}`)
          .join('\n');
        return [
          `# Project: ${path.basename(projectPath)}`,
          `Path: ${projectPath}`,
          `Tech: ${techStack.slice(0, 8).join(', ')}`,
          `\n## Key Patterns (follow these exactly)`,
          keyPatterns.map(p => `- ${p}`).join('\n'),
          `\n## File Map`,
          codeFiles,
          recentChanges ? `\n## Recently Changed Files\n${recentChanges}` : '',
        ].filter(Boolean).join('\n');

      case 'query':
        // Compact summary
        const queryFiles = projectMap.files
          .slice(0, 30)
          .map(f => `  ${f.path} — ${f.purpose}`)
          .join('\n');
        return [
          `# Project: ${path.basename(projectPath)} (${projectPath})`,
          `\n## Key Patterns`,
          keyPatterns.map(p => `- ${p}`).join('\n'),
          `\n## File Map`,
          queryFiles,
        ].join('\n');

      default:
        // docs, etc. — medium context
        return [
          `Project: ${path.basename(projectPath)} at ${projectPath}`,
          keyPatterns.map(p => `- ${p}`).join('\n'),
        ].join('\n');
    }
  }

  // ── Session notes ──────────────────────────────────────────────────────────

  addSessionNote(note: string): void {
    this.data.sessionNotes.push(`[${new Date().toISOString().slice(11,16)}] ${note}`);
    if (this.data.sessionNotes.length > 10) this.data.sessionNotes.shift();
    this.save();
  }

  clearSession(): void {
    this.data.sessionNotes = [];
    this.save();
  }

  getStats(): { files: number; tasks: number; lastScanned: string } {
    return {
      files: this.data.projectMap.files.length,
      tasks: this.data.taskHistory.length,
      lastScanned: this.data.projectMap.lastScanned?.slice(0, 16).replace('T', ' ') || 'never',
    };
  }

  // Return all file paths + purposes for subject matching
  getFilePaths(): Array<{ path: string; purpose: string }> {
    return this.data.projectMap.files.map(f => ({ path: f.path, purpose: f.purpose }));
  }

  // Check if any file path contains all given keywords
  fileMatchesKeywords(keywords: string[]): boolean {
    if (keywords.length === 0 || this.data.projectMap.files.length === 0) return false;
    return this.data.projectMap.files.some(f => {
      const haystack = (f.path + ' ' + f.purpose).toLowerCase();
      return keywords.every(kw => haystack.includes(kw));
    });
  }
}
