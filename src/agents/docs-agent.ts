import Anthropic from '@anthropic-ai/sdk';
import { BaseAgent, MODELS } from './base-agent';
import { DOCS_AGENT_PROMPT } from '../config/prompts';

export class DocsAgent extends BaseAgent {
  constructor(client: Anthropic, projectPath: string) {
    super(client, {
      name: 'Docs',
      systemPrompt: DOCS_AGENT_PROMPT,
      projectPath,
      tools: ['file', 'kb'],
      model: MODELS.fast,   // Haiku: simple writing tasks
      maxTokens: 1024,
    });
  }
}
