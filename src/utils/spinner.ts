import ora, { Ora } from 'ora';
import chalk from 'chalk';

export function createSpinner(text: string): Ora {
  return ora({ text: chalk.cyan(text), color: 'cyan' });
}
