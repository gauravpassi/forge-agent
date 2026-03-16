import Anthropic from '@anthropic-ai/sdk';
import { BaseAgent } from './base-agent';
import { TESTING_AGENT_PROMPT } from '../config/prompts';

export class TestingAgent extends BaseAgent {
  constructor(client: Anthropic, projectPath: string) {
    super(client, {
      name: 'Testing',
      systemPrompt: TESTING_AGENT_PROMPT,
      projectPath,
      tools: ['bash', 'file', 'kb']
    });
  }
}
