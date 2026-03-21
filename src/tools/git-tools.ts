import { execSync } from 'child_process';

export const gitToolDefinitions = [
  {
    name: 'git_status',
    description: 'Get the current git status of the project',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'git_diff',
    description: 'Get git diff to see what has changed',
    input_schema: {
      type: 'object',
      properties: {
        staged: { type: 'boolean', description: 'Show staged changes only' }
      }
    }
  },
  {
    name: 'git_log',
    description: 'Get recent git commit history',
    input_schema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of commits to show (default 10)' }
      }
    }
  },
  {
    name: 'git_pull',
    description: 'Pull latest changes from the remote repository (uses --rebase to avoid merge commits)',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'git_commit_and_push',
    description: 'Stage all changes, commit with a message, pull latest remote changes (rebase), then push to remote',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Commit message' }
      },
      required: ['message']
    }
  },
  {
    name: 'git_create_branch',
    description: 'Create and switch to a new git branch',
    input_schema: {
      type: 'object',
      properties: {
        branch_name: { type: 'string', description: 'Name for the new branch' }
      },
      required: ['branch_name']
    }
  }
];

export function executeGitTool(toolName: string, toolInput: Record<string, string | boolean | number>, projectPath: string): string {
  const exec = (cmd: string) => {
    try {
      return execSync(cmd, { cwd: projectPath, encoding: 'utf-8' }).trim();
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  };

  switch (toolName) {
    case 'git_status':
      return exec('git status');

    case 'git_diff':
      return toolInput.staged ? exec('git diff --staged') : exec('git diff');

    case 'git_log': {
      const count = toolInput.count || 10;
      return exec(`git log --oneline -${count}`);
    }

    case 'git_pull': {
      return exec('git pull --rebase');
    }

    case 'git_commit_and_push': {
      const addResult = exec('git add -A');
      if (addResult.startsWith('Error')) return addResult;
      const commitResult = exec(`git commit -m "${toolInput.message}\n\nCo-Authored-By: Forge Agent <forge@upcoretech.com>"`);
      if (commitResult.startsWith('Error')) return commitResult;
      // Pull latest remote changes before pushing to avoid rejected pushes
      const pullResult = exec('git pull --rebase');
      if (pullResult.startsWith('Error')) return `Commit succeeded but pull failed: ${pullResult}`;
      const pushResult = exec('git push');
      return `${commitResult}\n${pullResult}\n${pushResult}`;
    }

    case 'git_create_branch': {
      return exec(`git checkout -b ${toolInput.branch_name}`);
    }

    default:
      return `Unknown git tool: ${toolName}`;
  }
}
