import { execSync } from 'child_process';

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
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return result || '(command completed with no output)';
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    const output = [error.stdout, error.stderr, error.message].filter(Boolean).join('\n');
    return `Command failed:\n${output}`;
  }
}
