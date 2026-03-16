import Anthropic from '@anthropic-ai/sdk';
import { CodingAgent } from './agents/coding-agent';
import { DeploymentAgent } from './agents/deployment-agent';
import { PlanningAgent } from './agents/planning-agent';
import { TestingAgent } from './agents/testing-agent';
import { DocsAgent } from './agents/docs-agent';
import { BaseAgent } from './agents/base-agent';
import { ORCHESTRATOR_SYSTEM_PROMPT, QUERY_AGENT_PROMPT } from './config/prompts';
import { KnowledgeBase } from './knowledge/kb-manager';
import { logger } from './utils/logger';

interface OrchestratorTask {
  agent: string;
  instruction: string;
}

interface OrchestratorPlan {
  intent: string;
  tasks: OrchestratorTask[];
  summary_prompt: string;
}

export class ForgeOrchestrator {
  private client: Anthropic;
  private projectPath: string;
  private kb: KnowledgeBase;
  private agents: Record<string, BaseAgent>;

  constructor(apiKey: string, projectPath: string) {
    this.client = new Anthropic({ apiKey });
    this.projectPath = projectPath;
    this.kb = new KnowledgeBase(projectPath);

    // Initialize all agents
    this.agents = {
      coding: new CodingAgent(this.client, projectPath),
      deployment: new DeploymentAgent(this.client, projectPath),
      planning: new PlanningAgent(this.client, projectPath),
      testing: new TestingAgent(this.client, projectPath),
      docs: new DocsAgent(this.client, projectPath),
      query: new BaseAgent(this.client, {
        name: 'Query',
        systemPrompt: QUERY_AGENT_PROMPT,
        projectPath,
        tools: ['file', 'kb']
      })
    };
  }

  async process(userMessage: string): Promise<string> {
    logger.forge(`Processing: "${userMessage.slice(0, 60)}..."`);
    logger.divider();

    // Step 1: Get project context
    const context = this.kb.getProjectContext();

    // Step 2: Classify and plan with orchestrator
    let plan: OrchestratorPlan;
    try {
      const planResponse = await this.client.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        system: ORCHESTRATOR_SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Project context:\n${context.slice(0, 500)}\n\nUser request: ${userMessage}`
        }]
      });

      const planText = planResponse.content
        .filter(b => b.type === 'text')
        .map(b => (b as Anthropic.TextBlock).text)
        .join('');

      // Parse JSON from response
      const jsonMatch = planText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Orchestrator did not return valid JSON');
      plan = JSON.parse(jsonMatch[0]);
    } catch (err) {
      logger.error(`Orchestration failed: ${err}`);
      // Fallback: treat as query
      plan = {
        intent: userMessage,
        tasks: [{ agent: 'query', instruction: userMessage }],
        summary_prompt: 'Answer the user question'
      };
    }

    logger.info(`Intent: ${plan.intent}`);
    logger.info(`Tasks: ${plan.tasks.map(t => t.agent).join(' → ')}`);
    logger.divider();

    // Step 3: Execute tasks in sequence
    const results: string[] = [];
    for (const task of plan.tasks) {
      const agent = this.agents[task.agent];
      if (!agent) {
        logger.error(`Unknown agent: ${task.agent}`);
        continue;
      }

      const result = await agent.run(task.instruction, context);
      if (result.success) {
        results.push(`[${task.agent.toUpperCase()}] ${result.output}`);
        logger.success(`${task.agent} agent completed`);
      } else {
        results.push(`[${task.agent.toUpperCase()}] Error: ${result.error}`);
        logger.error(`${task.agent} agent failed: ${result.error}`);
        break; // Stop on error
      }
    }

    // Step 4: Format final response
    const combinedOutput = results.join('\n\n');
    logger.divider();
    return combinedOutput || 'Task completed.';
  }
}
