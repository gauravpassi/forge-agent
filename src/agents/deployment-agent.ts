import Anthropic from '@anthropic-ai/sdk';
import { BaseAgent, MODELS } from './base-agent';
import { DEPLOYMENT_AGENT_PROMPT } from '../config/prompts';

export class DeploymentAgent extends BaseAgent {
  constructor(client: Anthropic, projectPath: string) {
    super(client, {
      name: 'Deployment',
      systemPrompt: DEPLOYMENT_AGENT_PROMPT,
      projectPath,
      tools: ['git', 'bash'],   // No file/kb — deployment doesn't need them
      model: MODELS.fast,       // Haiku: just runs git commands
      maxTokens: 512,
    });
  }
}
