import Anthropic from '@anthropic-ai/sdk';
import { BaseAgent, MODELS } from './base-agent';
import { TESTING_AGENT_PROMPT } from '../config/prompts';

export class TestingAgent extends BaseAgent {
  constructor(client: Anthropic, projectPath: string) {
    super(client, {
      name: 'Testing',
      systemPrompt: TESTING_AGENT_PROMPT,
      projectPath,
      tools: ['bash', 'file'],  // No kb needed
      model: MODELS.fast,       // Haiku: just runs npm build
      maxTokens: 512,
    });
  }
}
