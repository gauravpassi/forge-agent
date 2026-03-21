import Anthropic from '@anthropic-ai/sdk';
import { BaseAgent, MODELS } from './base-agent';
import { CODING_AGENT_PROMPT } from '../config/prompts';

export type CodingComplexity = 'simple' | 'medium' | 'complex';

export class CodingAgent extends BaseAgent {
  constructor(client: Anthropic, projectPath: string, complexity: CodingComplexity = 'complex') {
    // Model selection based on complexity:
    // simple = 1-2 file bug fix / small tweak → Sonnet (~3x cheaper than Opus)
    // medium = multi-file enhancement → Sonnet
    // complex = new feature / new files / architectural changes → Opus
    const model = complexity === 'complex' ? MODELS.powerful : MODELS.balanced;
    // Higher token budgets so large file writes don't get truncated mid-file
    const maxTokens = complexity === 'complex' ? 8192 : 4096;

    super(client, {
      name: 'Coding',
      systemPrompt: CODING_AGENT_PROMPT,
      projectPath,
      tools: ['file', 'bash', 'kb'],
      model,
      maxTokens,
      continuousMode: true, // keep looping until ✅ Done — never stop mid-task
    });
  }
}
