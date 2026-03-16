import * as path from 'path';
import { glob } from 'glob';

export async function indexProject(projectPath: string): Promise<string> {
  const summary: string[] = ['# Project File Index\n'];

  // Get all TypeScript files
  const tsFiles = await glob('src/**/*.ts', { cwd: projectPath, nodir: true });
  const tsxFiles = await glob('src/**/*.tsx', { cwd: projectPath, nodir: true });

  const allFiles = [...tsFiles, ...tsxFiles].sort();

  summary.push(`## File Count: ${allFiles.length} TypeScript files\n`);

  // Group by directory
  const byDir: Record<string, string[]> = {};
  for (const f of allFiles) {
    const dir = path.dirname(f);
    if (!byDir[dir]) byDir[dir] = [];
    byDir[dir].push(path.basename(f));
  }

  for (const [dir, files] of Object.entries(byDir)) {
    summary.push(`### ${dir}`);
    summary.push(files.map(f => `- ${f}`).join('\n'));
    summary.push('');
  }

  return summary.join('\n');
}
