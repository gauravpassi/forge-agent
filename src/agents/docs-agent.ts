import Anthropic from '@anthropic-ai/sdk';
import { BaseAgent } from './base-agent';
import { DOCS_AGENT_PROMPT } from '../config/prompts';

export class DocsAgent extends BaseAgent {
  constructor(client: Anthropic, projectPath: string) {
    super(client, {
      name: 'Docs',
      systemPrompt: DOCS_AGENT_PROMPT,
      projectPath,
      tools: ['file', 'kb']
    });
  }
}
