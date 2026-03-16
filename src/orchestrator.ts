import Anthropic from '@anthropic-ai/sdk';
import { CodingAgent } from './agents/coding-agent';
import { DeploymentAgent } from './agents/deployment-agent';
import { PlanningAgent } from './agents/planning-agent';
import { TestingAgent } from './agents/testing-agent';
import { DocsAgent } from './agents/docs-agent';
import { BaseAgent } from './agents/base-agent';
import { ORCHESTRATOR_SYSTEM_PROMPT, QUERY_AGENT_PROMPT } from './config/prompts';
import { KnowledgeBase } from './knowledge/kb-manager';
import { CheckpointManager, TaskCheckpoint } from './knowledge/checkpoint-manager';
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
  private cpManager: CheckpointManager;
  private agents: Record<string, BaseAgent>;

  constructor(apiKey: string, projectPath: string) {
    this.client = new Anthropic({ apiKey });
    this.projectPath = projectPath;
    this.kb = new KnowledgeBase(projectPath);
    this.cpManager = new CheckpointManager();

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

  private isResumeRequest(msg: string): boolean {
    return /resume|continue|pick up|where (we|you) left|checkpoint|unfinished|last task/i.test(msg);
  }

  async process(userMessage: string): Promise<string> {
    logger.forge(`Processing: "${userMessage.slice(0, 60)}..."`);
    logger.divider();

    if (this.isResumeRequest(userMessage)) {
      const latest = this.cpManager.getLatest();
      if (latest) {
        logger.info(`Resuming checkpoint: ${latest.id}`);
        return this.resumeFromCheckpoint(latest);
      }
      return 'No unfinished tasks found. Start a new task and I\'ll checkpoint progress automatically.';
    }

    if (/list checkpoints|show checkpoints|pending tasks/i.test(userMessage)) {
      return this.listCheckpoints();
    }

    const context = this.kb.getProjectContext();
    const cpId = this.cpManager.generateId();

    let plan: OrchestratorPlan;
    try {
      const planResponse = await this.client.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 1024,
        system: ORCHESTRATOR_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Project context:\n${context.slice(0, 500)}\n\nUser request: ${userMessage}` }]
      });

      const planText = planResponse.content
        .filter(b => b.type === 'text')
        .map(b => (b as Anthropic.TextBlock).text)
        .join('');

      const jsonMatch = planText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON plan');
      plan = JSON.parse(jsonMatch[0]);
    } catch (err) {
      logger.error(`Orchestration failed: ${err}`);
      plan = {
        intent: userMessage,
        tasks: [{ agent: 'query', instruction: userMessage }],
        summary_prompt: 'Answer the question'
      };
    }

    logger.info(`Intent: ${plan.intent}`);
    logger.info(`Tasks: ${plan.tasks.map(t => t.agent).join(' → ')}`);
    logger.divider();

    const checkpoint: TaskCheckpoint = {
      id: cpId,
      timestamp: new Date().toISOString(),
      userMessage,
      intent: plan.intent,
      totalTasks: plan.tasks.length,
      completedTasks: [],
      currentAgent: '',
      currentInstruction: '',
      completedOutputs: [],
      messageHistory: [],
      status: 'in_progress'
    };
    this.cpManager.save(checkpoint);

    const results: string[] = [];
    for (const task of plan.tasks) {
      const agent = this.agents[task.agent];
      if (!agent) { logger.error(`Unknown agent: ${task.agent}`); continue; }

      checkpoint.currentAgent = task.agent;
      checkpoint.currentInstruction = task.instruction;
      this.cpManager.save(checkpoint);

      try {
        const result = await agent.run(task.instruction, context);

        if (result.success) {
          const output = `[${task.agent.toUpperCase()}] ${result.output}`;
          results.push(output);
          checkpoint.completedTasks.push(task.agent);
          checkpoint.completedOutputs.push(output);
          logger.success(`${task.agent} completed`);
          this.cpManager.save(checkpoint);
        } else {
          checkpoint.status = 'error';
          checkpoint.errorMessage = result.error;
          this.cpManager.save(checkpoint);
          logger.error(`${task.agent} failed: ${result.error}`);
          break;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const isTokenLimit = /prompt is too long|token|context length|maximum context/i.test(errMsg);
        checkpoint.status = isTokenLimit ? 'token_limit' : 'error';
        checkpoint.errorMessage = errMsg;
        checkpoint.completedOutputs = results;
        this.cpManager.save(checkpoint);

        if (isTokenLimit) {
          const done = results.length > 0 ? `\n\nCompleted so far:\n${results.join('\n\n')}` : '';
          return `⚠️ Token limit reached — checkpoint saved as **${cpId}**.\n\nCompleted ${checkpoint.completedTasks.length}/${checkpoint.totalTasks} tasks.${done}\n\nSay **"resume"** to continue from where we left off.`;
        }
        throw err;
      }
    }

    checkpoint.status = 'completed';
    this.cpManager.save(checkpoint);
    logger.divider();
    return results.join('\n\n') || 'Task completed.';
  }

  private async resumeFromCheckpoint(cp: TaskCheckpoint): Promise<string> {
    logger.info(`Resuming: ${cp.intent}`);
    logger.info(`Completed: ${cp.completedTasks.join(', ') || 'none'}`);
    logger.divider();

    const context = this.kb.getProjectContext();

    let plan: OrchestratorPlan;
    try {
      const planResponse = await this.client.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 1024,
        system: ORCHESTRATOR_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Project context:\n${context.slice(0, 500)}\n\nUser request: ${cp.userMessage}` }]
      });
      const planText = planResponse.content.filter(b => b.type === 'text').map(b => (b as Anthropic.TextBlock).text).join('');
      const jsonMatch = planText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON');
      plan = JSON.parse(jsonMatch[0]);
    } catch {
      plan = {
        intent: cp.intent,
        tasks: [{ agent: cp.currentAgent || 'query', instruction: cp.currentInstruction || cp.userMessage }],
        summary_prompt: ''
      };
    }

    const remainingTasks = plan.tasks.filter(t => !cp.completedTasks.includes(t.agent));

    if (remainingTasks.length === 0) {
      this.cpManager.markCompleted(cp.id);
      return `All tasks already completed.\n\n${cp.completedOutputs.join('\n\n')}`;
    }

    logger.info(`Remaining: ${remainingTasks.map(t => t.agent).join(' → ')}`);

    const results: string[] = [...cp.completedOutputs];
    const resumeContext = cp.completedOutputs.length > 0
      ? `Previously completed:\n${cp.completedOutputs.join('\n\n')}\n\n${context}`
      : context;

    for (const task of remainingTasks) {
      const agent = this.agents[task.agent];
      if (!agent) continue;

      cp.currentAgent = task.agent;
      this.cpManager.save(cp);

      try {
        const result = await agent.run(task.instruction, resumeContext);
        if (result.success) {
          const output = `[${task.agent.toUpperCase()}] ${result.output}`;
          results.push(output);
          cp.completedTasks.push(task.agent);
          cp.completedOutputs.push(output);
          logger.success(`${task.agent} completed`);
          this.cpManager.save(cp);
        } else {
          cp.status = 'error';
          cp.errorMessage = result.error;
          this.cpManager.save(cp);
          break;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const isTokenLimit = /prompt is too long|token|context length|maximum context/i.test(errMsg);
        cp.status = isTokenLimit ? 'token_limit' : 'error';
        cp.errorMessage = errMsg;
        this.cpManager.save(cp);
        if (isTokenLimit) {
          return `⚠️ Token limit hit again. Checkpoint updated: **${cp.id}**\n\nCompleted ${cp.completedTasks.length}/${cp.totalTasks} tasks.\n\nSay **"resume"** to continue.`;
        }
        throw err;
      }
    }

    this.cpManager.markCompleted(cp.id);
    logger.divider();
    return results.join('\n\n') || 'Task completed.';
  }

  private listCheckpoints(): string {
    const all = this.cpManager.listAll();
    if (all.length === 0) return 'No checkpoints found.';

    const lines = all.slice(0, 10).map(cp => {
      const icon = cp.status === 'completed' ? '✅' : cp.status === 'token_limit' ? '⚠️' : cp.status === 'error' ? '❌' : '🔄';
      const date = new Date(cp.timestamp).toLocaleString();
      return `${icon} **${cp.id}** — ${cp.intent.slice(0, 60)}\n   ${cp.completedTasks.length}/${cp.totalTasks} tasks · ${date}`;
    });

    return `**Checkpoints (last 10):**\n\n${lines.join('\n\n')}\n\nSay "resume" to continue the latest unfinished task.`;
  }
}
