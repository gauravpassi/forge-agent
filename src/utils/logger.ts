import chalk from 'chalk';

export const logger = {
  forge: (msg: string) => console.log(chalk.green('🔨 Forge') + ' ' + msg),
  agent: (name: string, msg: string) => console.log(chalk.cyan(`  [${name}]`) + ' ' + msg),
  tool: (name: string, msg: string) => console.log(chalk.yellow(`    ⚙ ${name}`) + ' ' + chalk.gray(msg)),
  success: (msg: string) => console.log(chalk.green('  ✅ ' + msg)),
  error: (msg: string) => console.log(chalk.red('  ❌ ' + msg)),
  info: (msg: string) => console.log(chalk.gray('  ℹ ' + msg)),
  divider: () => console.log(chalk.gray('─'.repeat(60))),
  user: (msg: string) => console.log(chalk.white.bold('You: ') + msg),
  response: (msg: string) => console.log(chalk.green.bold('Forge: ') + msg),
};
