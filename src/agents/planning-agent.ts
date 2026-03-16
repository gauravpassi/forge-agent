import Anthropic from '@anthropic-ai/sdk';
import { BaseAgent } from './base-agent';
import { PLANNING_AGENT_PROMPT } from '../config/prompts';

export class PlanningAgent extends BaseAgent {
  constructor(client: Anthropic, projectPath: string) {
    super(client, {
      name: 'Planning',
      systemPrompt: PLANNING_AGENT_PROMPT,
      projectPath,
      tools: ['file', 'kb']
    });
  }
}
