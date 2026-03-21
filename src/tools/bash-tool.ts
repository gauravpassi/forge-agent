import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Electron strips PATH to bare minimum — expand it to include npm/git/brew locations
function buildExpandedPath(): string {
  const extras: string[] = ['/usr/local/bin', '/opt/homebrew/bin', '/opt/homebrew/sbin'];
  // Add active nvm node version bin if present
  const nvmDir = path.join(process.env.HOME || '', '.nvm', 'versions', 'node');
  try {
    if (fs.existsSync(nvmDir)) {
      const versions = fs.readdirSync(nvmDir).filter(v => v.startsWith('v')).sort((a, b) => {
        const pa = a.replace(/\D/g, '').padStart(20, '0');
        const pb = b.replace(/\D/g, '').padStart(20, '0');
        return pb.localeCompare(pa);
      });
      if (versions[0]) extras.unshift(path.join(nvmDir, versions[0], 'bin'));
    }
  } catch { /* ignore */ }
  return [...extras, process.env.PATH || ''].join(':');
}
const EXPANDED_PATH = buildExpandedPath();

export const bashToolDefinitions = [
  {
    name: 'run_command',
    description: 'Run a shell command in the project directory. Use for npm commands, builds, tests etc.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to run' },
        timeout_seconds: { type: 'number', description: 'Timeout in seconds (default 60)' }
      },
      required: ['command']
    }
  }
];

// Allowlist of safe command prefixes
const ALLOWED_COMMANDS = [
  'npm ', 'npx ', 'node ', 'tsc', 'ls', 'cat', 'echo', 'pwd', 'which',
  'git ', 'vercel ', 'curl '
];

export function executeBashTool(toolInput: Record<string, string | number>, projectPath: string): string {
  const { command, timeout_seconds = 60 } = toolInput;
  const cmd = String(command).trim();

  // Safety check
  const isAllowed = ALLOWED_COMMANDS.some(prefix => cmd.startsWith(prefix));
  if (!isAllowed) {
    return `Error: Command not allowed for safety reasons. Allowed prefixes: ${ALLOWED_COMMANDS.join(', ')}`;
  }

  try {
    const result = execSync(cmd, {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: Number(timeout_seconds) * 1000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: EXPANDED_PATH },
    });
    return result || '(command completed with no output)';
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    const output = [error.stdout, error.stderr, error.message].filter(Boolean).join('\n');
    return `Command failed:\n${output}`;
  }
}
