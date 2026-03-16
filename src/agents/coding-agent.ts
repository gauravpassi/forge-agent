import Anthropic from '@anthropic-ai/sdk';
import { BaseAgent } from './base-agent';
import { CODING_AGENT_PROMPT } from '../config/prompts';

export class CodingAgent extends BaseAgent {
  constructor(client: Anthropic, projectPath: string) {
    super(client, {
      name: 'Coding',
      systemPrompt: CODING_AGENT_PROMPT,
      projectPath,
      tools: ['file', 'bash', 'kb']
    });
  }
}
