import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

// Use userData (writable) in packaged app, local knowledge dir in dev
const KB_PATH = app.isPackaged
  ? path.join(app.getPath('userData'), 'knowledge')
  : path.join(__dirname, '../../knowledge');

export class KnowledgeBase {
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    fs.mkdirSync(KB_PATH, { recursive: true });
  }

  getProjectContext(): string {
    const filePath = path.join(KB_PATH, 'project-context.md');
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
    return this.buildInitialContext();
  }

  private buildInitialContext(): string {
    const pkgPath = path.join(this.projectPath, 'package.json');
    let techStack = 'Unknown';
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        techStack = Object.keys(deps).slice(0, 20).join(', ');
      } catch { /* ignore */ }
    }

    const context = `# AgenticAI Project Context

## Project Path
${this.projectPath}

## Tech Stack
${techStack}

## Key Directories
- src/app/templates/ — 48+ agent template pages
- src/app/api/agents/ — Backend API routes (streaming SSE)
- src/lib/ — Utilities, constants, helpers
- src/components/ — UI components

## Patterns
- Each agent = 1 page.tsx + 1 route.ts
- All agents use streaming SSE via createStreamResponse()
- System prompts live in src/app/api/agents/{hub}/{agent}/route.ts
- Agent constants/config in src/lib/constants.ts

## Deployment
- GitHub: https://github.com/gauravpassi/agenticai-demo
- Vercel: https://agenticai-demo-olive.vercel.app
- Auto-deploys on push to main

## Auth
- Password: UpCore@2025
- Cookie: upcore_session
`;
    const filePath = path.join(KB_PATH, 'project-context.md');
    fs.writeFileSync(filePath, context);
    return context;
  }

  updateContext(content: string): void {
    const filePath = path.join(KB_PATH, 'project-context.md');
    fs.writeFileSync(filePath, content);
  }
}
