import * as readline from 'readline';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { ForgeOrchestrator } from './orchestrator';
import { logger } from './utils/logger';

dotenv.config({ path: path.join(__dirname, '../.env') });

const API_KEY = process.env.ANTHROPIC_API_KEY;
const PROJECT_PATH = process.env.TARGET_PROJECT_PATH || '/Users/gauravpassi/Desktop/AgenticAI/agenticai-demo';

async function main() {
  if (!API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set in .env file');
    console.error('Copy .env.example to .env and add your API key');
    process.exit(1);
  }

  const orchestrator = new ForgeOrchestrator(API_KEY, PROJECT_PATH);

  console.log('');
  console.log('🔨 \x1b[32mForge Agent\x1b[0m — Multi-Agent Development Platform');
  console.log('   Managing: \x1b[36m' + PROJECT_PATH + '\x1b[0m');
  console.log('');
  console.log('   Commands:');
  console.log('   \x1b[33m/exit\x1b[0m  — Exit Forge');
  console.log('   \x1b[33m/help\x1b[0m  — Show examples');
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\x1b[32m⟩\x1b[0m '
  });

  rl.prompt();

  rl.on('line', async (input: string) => {
    const line = input.trim();
    if (!line) { rl.prompt(); return; }

    if (line === '/exit' || line === '/quit') {
      console.log('\n👋 Forge shutting down...\n');
      process.exit(0);
    }

    if (line === '/help') {
      console.log('\n📖 Example commands:');
      console.log('  "Fix the build error on the GADSL checker page"');
      console.log('  "Add a dark mode toggle to the compliance hub"');
      console.log('  "Create a new agent called Healthcare Risk Analyzer"');
      console.log('  "What agents do we have in the education hub?"');
      console.log('  "Commit and deploy the latest changes"');
      console.log('  "Run the build and check for errors"');
      console.log('');
      rl.prompt();
      return;
    }

    try {
      const response = await orchestrator.process(line);
      console.log('');
      logger.response(response);
      console.log('');
    } catch (err) {
      logger.error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\n👋 Forge shutting down...\n');
    process.exit(0);
  });
}

main().catch(console.error);
