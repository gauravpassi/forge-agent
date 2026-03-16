import Anthropic from '@anthropic-ai/sdk';
import { BaseAgent } from './base-agent';
import { DEPLOYMENT_AGENT_PROMPT } from '../config/prompts';

export class DeploymentAgent extends BaseAgent {
  constructor(client: Anthropic, projectPath: string) {
    super(client, {
      name: 'Deployment',
      systemPrompt: DEPLOYMENT_AGENT_PROMPT,
      projectPath,
      tools: ['git', 'bash', 'kb']
    });
  }
}
