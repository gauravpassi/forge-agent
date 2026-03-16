import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

export interface FileTool {
  name: string;
  description: string;
  input_schema: object;
}

export const fileToolDefinitions: FileTool[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative file path' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Write content to a file (creates or overwrites)',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to write to' },
        content: { type: 'string', description: 'Content to write' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'edit_file',
    description: 'Edit a file by replacing a specific string with new content',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to edit' },
        old_string: { type: 'string', description: 'Exact string to find and replace' },
        new_string: { type: 'string', description: 'Replacement string' }
      },
      required: ['path', 'old_string', 'new_string']
    }
  },
  {
    name: 'list_files',
    description: 'List files matching a glob pattern in the project',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern e.g. src/**/*.ts' },
        cwd: { type: 'string', description: 'Directory to search in' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'search_in_files',
    description: 'Search for a string/pattern across files',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'String or regex to search for' },
        directory: { type: 'string', description: 'Directory to search in' },
        file_pattern: { type: 'string', description: 'File glob filter e.g. *.ts' }
      },
      required: ['pattern', 'directory']
    }
  }
];

export async function executeFileTool(toolName: string, toolInput: Record<string, string>, projectPath: string): Promise<string> {
  const resolvePath = (p: string) => {
    if (path.isAbsolute(p)) return p;
    return path.join(projectPath, p);
  };

  try {
    switch (toolName) {
      case 'read_file': {
        const filePath = resolvePath(toolInput.path);
        if (!fs.existsSync(filePath)) return `Error: File not found: ${filePath}`;
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        // Return first 200 lines with line numbers to avoid token overflow
        const preview = lines.slice(0, 200).map((l, i) => `${i + 1}: ${l}`).join('\n');
        return lines.length > 200 ? preview + `\n... (${lines.length - 200} more lines)` : preview;
      }

      case 'write_file': {
        const filePath = resolvePath(toolInput.path);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, toolInput.content, 'utf-8');
        return `Successfully wrote ${toolInput.content.length} chars to ${filePath}`;
      }

      case 'edit_file': {
        const filePath = resolvePath(toolInput.path);
        if (!fs.existsSync(filePath)) return `Error: File not found: ${filePath}`;
        const content = fs.readFileSync(filePath, 'utf-8');
        if (!content.includes(toolInput.old_string)) {
          return `Error: old_string not found in file. Make sure it matches exactly.`;
        }
        const newContent = content.replace(toolInput.old_string, toolInput.new_string);
        fs.writeFileSync(filePath, newContent, 'utf-8');
        return `Successfully edited ${filePath}`;
      }

      case 'list_files': {
        const cwd = toolInput.cwd ? resolvePath(toolInput.cwd) : projectPath;
        const files = await glob(toolInput.pattern, { cwd, nodir: true });
        return files.length > 0 ? files.join('\n') : 'No files found matching pattern';
      }

      case 'search_in_files': {
        const directory = resolvePath(toolInput.directory);
        const filePattern = toolInput.file_pattern || '**/*';
        const files = await glob(filePattern, { cwd: directory, nodir: true });
        const results: string[] = [];
        const regex = new RegExp(toolInput.pattern, 'gi');

        for (const file of files.slice(0, 50)) {
          try {
            const filePath = path.join(directory, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');
            lines.forEach((line, idx) => {
              if (regex.test(line)) {
                results.push(`${file}:${idx + 1}: ${line.trim()}`);
              }
            });
          } catch {
            // skip binary files
          }
        }
        return results.length > 0 ? results.slice(0, 50).join('\n') : 'No matches found';
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}
