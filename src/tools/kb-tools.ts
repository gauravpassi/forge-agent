import * as fs from 'fs';
import * as path from 'path';

const KB_PATH = path.join(__dirname, '../../knowledge');

export const kbToolDefinitions = [
  {
    name: 'kb_read',
    description: 'Read from the Forge knowledge base (project context, decisions, task history)',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to read: project-context, decisions, task-history' }
      },
      required: ['key']
    }
  },
  {
    name: 'kb_write',
    description: 'Write/append to the Forge knowledge base',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to write: decisions, task-history' },
        content: { type: 'string', description: 'Content to append' }
      },
      required: ['key', 'content']
    }
  }
];

export function executeKbTool(toolName: string, toolInput: Record<string, string>): string {
  fs.mkdirSync(KB_PATH, { recursive: true });

  const fileMap: Record<string, string> = {
    'project-context': path.join(KB_PATH, 'project-context.md'),
    'decisions': path.join(KB_PATH, 'decisions.md'),
    'task-history': path.join(KB_PATH, 'task-history.json')
  };

  const filePath = fileMap[toolInput.key];
  if (!filePath) return `Unknown KB key: ${toolInput.key}. Use: ${Object.keys(fileMap).join(', ')}`;

  if (toolName === 'kb_read') {
    if (!fs.existsSync(filePath)) return `(empty — no entries yet)`;
    return fs.readFileSync(filePath, 'utf-8');
  }

  if (toolName === 'kb_write') {
    const timestamp = new Date().toISOString();
    if (toolInput.key === 'task-history') {
      let history: Array<{ timestamp: string; content: string }> = [];
      if (fs.existsSync(filePath)) {
        try { history = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { history = []; }
      }
      history.push({ timestamp, content: toolInput.content });
      fs.writeFileSync(filePath, JSON.stringify(history, null, 2));
    } else {
      fs.appendFileSync(filePath, `\n\n---\n*${timestamp}*\n${toolInput.content}`);
    }
    return `Successfully wrote to ${toolInput.key}`;
  }

  return `Unknown KB tool: ${toolName}`;
}
