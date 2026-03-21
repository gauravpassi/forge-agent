import Anthropic from '@anthropic-ai/sdk';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CodingAgent, CodingComplexity } from './agents/coding-agent';
import { DeploymentAgent } from './agents/deployment-agent';
import { PlanningAgent } from './agents/planning-agent';
import { TestingAgent } from './agents/testing-agent';
import { DocsAgent } from './agents/docs-agent';
import { BaseAgent, MODELS } from './agents/base-agent';
import { PrototypeAgent } from './agents/prototype-agent';
import { savePrototype } from './server/prototype-server';
import { ORCHESTRATOR_SYSTEM_PROMPT, QUERY_AGENT_PROMPT } from './config/prompts';
import { KnowledgeBase } from './knowledge/kb-manager';
import { SmartKB } from './knowledge/smart-kb';
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
  isNewFeature?: boolean;
}

// Agents that are "major steps" requiring confirmation before proceeding
const MAJOR_STEPS = ['planning', 'coding', 'testing', 'deployment', 'docs'];

// Step labels for human-readable confirmation prompts
const STEP_LABELS: Record<string, string> = {
  planning:   '📋 Planning',
  coding:     '💻 Coding',
  testing:    '🧪 Testing',
  deployment: '🚀 Deployment',
  docs:       '📝 Documentation',
  query:      '🔍 Query',
};

type TaskType = 'new_feature' | 'bug_fix' | 'enhancement' | 'query' | 'git';

export class ForgeOrchestrator {
  private client: Anthropic;
  private projectPath: string;
  private kb: KnowledgeBase;
  private smartKB: SmartKB;
  private cpManager: CheckpointManager;
  private agents: Record<string, BaseAgent>;
  private protoAgent: PrototypeAgent;

  // Pending continuation state — set when we pause for confirmation
  private pendingContinuation: {
    remainingTasks: OrchestratorTask[];
    completedOutputs: string[];
    intent: string;
    cpId: string;
  } | null = null;

  // Pending prototype state — awaiting user approval or change request
  private pendingPrototype: {
    plan: string;
    remainingTasks: OrchestratorTask[];
    protoId: string;
    featureTitle: string;
    intent: string;
    cpId: string;
  } | null = null;

  private currentAgent: import('./agents/base-agent').BaseAgent | null = null;
  private currentTaskType: TaskType = 'enhancement';

  cancel(): void {
    if (this.currentAgent) {
      (this.currentAgent as any).cancel?.();
      this.currentAgent = null;
    }
  }

  constructor(apiKey: string, projectPath: string) {
    this.client = new Anthropic({ apiKey });
    this.projectPath = projectPath;
    this.kb = new KnowledgeBase(projectPath);
    this.smartKB = new SmartKB(projectPath);
    // Scan project map on startup (async, non-blocking)
    setTimeout(() => this.smartKB.scanProjectMap(), 2000);
    this.cpManager = new CheckpointManager();
    this.protoAgent = new PrototypeAgent(this.client);

    this.agents = {
      coding:         new CodingAgent(this.client, projectPath, 'complex'),
      coding_simple:  new CodingAgent(this.client, projectPath, 'simple'),
      coding_medium:  new CodingAgent(this.client, projectPath, 'medium'),
      coding_complex: new CodingAgent(this.client, projectPath, 'complex'),
      deployment: new DeploymentAgent(this.client, projectPath),
      planning:   new PlanningAgent(this.client, projectPath),
      testing:    new TestingAgent(this.client, projectPath),
      docs:       new DocsAgent(this.client, projectPath),
      query: new BaseAgent(this.client, {
        name: 'Query',
        systemPrompt: QUERY_AGENT_PROMPT,
        projectPath,
        tools: ['file', 'git', 'kb'],
        model: MODELS.fast,
        maxTokens: 512,
      })
    };
  }

  // ── Task type detection ──
  private detectTaskType(msg: string): TaskType {
    if (/new (page|screen|agent|template|feature|component|section)|add.*agent|create.*page|build.*feature|new.*dashboard/i.test(msg)) return 'new_feature';
    if (/fix|bug|error|broken|crash|not working|issue|problem/i.test(msg)) return 'bug_fix';
    if (/push|deploy|commit|git|vercel|branch/i.test(msg)) return 'git';
    if (/what|how|show me|list|explain|where/i.test(msg)) return 'query';
    return 'enhancement';
  }

  private isConfirmation(msg: string): boolean {
    return /^(yes|y|ok|okay|sure|go|proceed|continue|next|deploy|do it|yep|yup|confirm|go ahead|sounds good|👍)/i.test(msg.trim());
  }

  private isDecline(msg: string): boolean {
    return /^(no|nope|stop|cancel|skip|don't|dont|not now|hold|wait)/i.test(msg.trim());
  }

  private isResumeRequest(msg: string): boolean {
    return /resume|pick up|where (we|you) left|checkpoint|unfinished|last task/i.test(msg);
  }

  private isPrototypeApproval(msg: string): boolean {
    return /yes|looks good|proceed|go ahead|approve|ship it|good|nice|perfect|continue/i.test(msg.trim());
  }

  private isPrototypeChangeRequest(msg: string): boolean {
    return /change|update|modify|make|add|remove|different|instead|actually/i.test(msg.trim());
  }

  async process(
    userMessage: string,
    images?: Array<{ base64: string; mediaType: string; name: string }>,
    docs?: Array<{ base64?: string; text?: string; name: string; size?: number; docType: 'pdf' | 'text' }>
  ): Promise<string> {
    const trimmed = userMessage.trim();
    logger.forge(`Processing: "${trimmed.slice(0, 60)}..."`);
    logger.divider();

    // ── Guard: bare affirmation/negation with no pending state is meaningless ──
    // Bare affirmation/negation with no pending state — ask what to do
    // Exclude action verbs that have real meaning ("deploy", "push", "resume", "build")
    const isActionVerb = /^(deploy|push|build|run|test|resume|rollback)$/i.test(trimmed);
    const isBareWord = !isActionVerb && /^(yes|yeah|yep|ok|okay|sure|go|proceed|continue|yup|confirm|approved|no|nope|stop|pause|cancel|nah|nevermind|skip|👍|✅)$/i.test(trimmed);
    const hasPendingState = !!(this.pendingContinuation || this.pendingPrototype);
    if (isBareWord && !hasPendingState) {
      return `I'm ready to help! What would you like me to build, fix, or deploy?\n\nFor example:\n- "Add a lead generation agent to the outreach hub"\n- "Fix the GADSL chat response format"\n- "Build a new customer onboarding dashboard"`;
    }

    // ── Handle prototype approval/change flow ──
    if (this.pendingPrototype) {
      if (this.isPrototypeApproval(trimmed) && !this.isPrototypeChangeRequest(trimmed)) {
        return this.resumeAfterPrototypeApproval();
      }
      if (this.isPrototypeChangeRequest(trimmed)) {
        return this.regeneratePrototype(trimmed);
      }
      // Not clearly approval or change — treat as new task, clear pending prototype
      this.pendingPrototype = null;
    }

    // ── Handle confirmation for pending continuation ──
    if (this.pendingContinuation) {
      if (this.isDecline(trimmed)) {
        const pending = this.pendingContinuation;
        this.pendingContinuation = null;
        return `Paused. Completed: ${pending.completedOutputs.length} step(s).\n\nSay **"resume"** to continue from where we left off, or start a new task.`;
      }
      if (this.isConfirmation(trimmed)) {
        return this.continuePendingPlan();
      }
      // User typed a real instruction — clear pending, treat as new task
      this.pendingContinuation = null;
    }

    // ── Special commands ──
    if (this.isResumeRequest(userMessage)) {
      const latest = this.cpManager.getLatest();
      if (latest) {
        logger.info(`Resuming checkpoint: ${latest.id}`);
        return this.resumeFromCheckpoint(latest);
      }
      return 'No unfinished tasks found.';
    }

    if (/list checkpoints|show checkpoints|pending tasks/i.test(userMessage)) {
      return this.listCheckpoints();
    }

    // ── Route and plan ──
    const context = this.kb.getProjectContext();
    const cpId = this.cpManager.generateId();
    const taskType = this.detectTaskType(userMessage);
    this.currentTaskType = taskType;

    // ── Deterministic routing — no LLM JSON parsing, no JSON errors ──
    const plan: OrchestratorPlan = this.buildPlan(userMessage, taskType, context);

    // ── Override routing based on deterministic task type detection ──
    // Deployment is NOT included automatically — user must explicitly say "deploy" / "push"
    if (taskType === 'new_feature' && !plan.tasks.some(t => t.agent === 'coding')) {
      plan.tasks = [
        { agent: 'planning',   instruction: `Plan the implementation: ${userMessage}` },
        { agent: 'coding',     instruction: userMessage },
        { agent: 'testing',    instruction: 'Run npm run build and check for errors' },
      ];
      plan.intent = plan.intent || userMessage;
    } else if ((taskType === 'bug_fix' || taskType === 'enhancement') && !plan.tasks.some(t => t.agent === 'coding')) {
      plan.tasks = [
        { agent: 'planning',   instruction: `Plan the fix: ${userMessage}` },
        { agent: 'coding',     instruction: userMessage },
        { agent: 'testing',    instruction: 'Run npm run build and check for errors' },
      ];
      plan.intent = plan.intent || userMessage;
    } else if (taskType === 'git' && !plan.tasks.some(t => t.agent === 'deployment')) {
      plan.tasks = [{ agent: 'deployment', instruction: userMessage }];
    }

    logger.info(`Intent: ${plan.intent}`);
    logger.info(`Tasks: ${plan.tasks.map(t => STEP_LABELS[t.agent] || t.agent).join(' → ')}`);
    logger.divider();

    // ── Prototype-first flow — only for clearly UI-centric new features ──
    // Backend tasks (new agent, new route, new tool, etc.) skip prototype and go straight to coding
    const isUiFeature = taskType === 'new_feature' &&
      /new\s+(page|screen|dashboard|ui|view|panel|tab|modal|widget|chart|form|layout|section)|add\s+(page|screen|dashboard|ui|view|tab|modal)|build\s+(page|screen|dashboard)/i.test(userMessage);
    if (isUiFeature) {
      return this.runPrototypeFirstFlow(userMessage, plan, cpId, context, images, docs);
    }

    // Save checkpoint
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

    return this.runTasks(plan.tasks, [], checkpoint, context, images, docs);
  }

  // ── Prototype-first flow: planning → prototype → await approval → coding/testing/deployment ──
  private async runPrototypeFirstFlow(
    userMessage: string,
    plan: OrchestratorPlan,
    cpId: string,
    context: string,
    images?: Array<{ base64: string; mediaType: string; name: string }>,
    docs?: Array<{ base64?: string; text?: string; name: string; size?: number; docType: 'pdf' | 'text' }>
  ): Promise<string> {
    const checkpoint: TaskCheckpoint = {
      id: cpId,
      timestamp: new Date().toISOString(),
      userMessage,
      intent: plan.intent,
      totalTasks: plan.tasks.length + 1, // +1 for prototype step
      completedTasks: [],
      currentAgent: '',
      currentInstruction: '',
      completedOutputs: [],
      messageHistory: [],
      status: 'in_progress'
    };
    this.cpManager.save(checkpoint);

    // Run planning agent first
    const planningTask = plan.tasks.find(t => t.agent === 'planning');
    let planOutput = '';
    if (planningTask) {
      logger.info('Running planning agent before prototype...');
      const planAgent = this.agents['planning'];
      const agentContext = this.getContextForAgent('planning', context);
      const planResult = await planAgent.run(planningTask.instruction, agentContext, images, docs);
      if (!planResult.success) {
        return `❌ Planning failed: ${planResult.error}`;
      }
      planOutput = planResult.output;
      checkpoint.completedTasks.push('planning');
      checkpoint.completedOutputs.push(planOutput);
      logger.success('planning completed');
      this.cpManager.save(checkpoint);
    }

    // Run prototype agent
    logger.info('Generating UI prototype...');
    const featureTitle = plan.intent || userMessage.slice(0, 60);
    const protoComplexity = (planOutput.split('\n').filter(l => l.trim().startsWith('-')).length >= 5) ? 'complex' : 'simple';
    const protoResult = await this.protoAgent.generate(featureTitle, planOutput || userMessage, protoComplexity);

    if (!protoResult.success || !protoResult.html) {
      logger.error(`Prototype generation failed: ${protoResult.error}`);
      // Store remaining tasks so user can confirm to proceed without prototype
      const remainingTasks = plan.tasks.filter(t => t.agent !== 'planning');
      this.pendingContinuation = {
        remainingTasks,
        completedOutputs: planOutput ? [planOutput] : [],
        intent: plan.intent,
        cpId,
      };
      const planSection = planOutput ? `${planOutput}\n\n---\n\n` : '';
      return `${planSection}⚠️ Prototype generation failed (${protoResult.error}).\n\n---CONFIRM_START---\nstep_done: 📋 Planning\nnext_step: 💻 Coding\nremaining: 💻 Coding → 🧪 Testing → 🚀 Deployment\n---CONFIRM_END---`;
    }

    // Save prototype and get URL
    const protoId = `proto-${cpId}`;
    const protoUrl = savePrototype(protoId, protoResult.html);
    logger.success(`Prototype saved: ${protoUrl}`);

    // Store pending prototype state
    const remainingAfterProto = plan.tasks.filter(t => t.agent !== 'planning');
    this.pendingPrototype = {
      plan: planOutput,
      remainingTasks: remainingAfterProto,
      protoId,
      featureTitle,
      intent: plan.intent,
      cpId,
    };

    checkpoint.status = 'in_progress';
    this.cpManager.save(checkpoint);

    // Return the special prototype-ready marker for the renderer
    const planSection = planOutput ? `${planOutput}\n\n---\n` : '';
    return `${planSection}---PROTOTYPE_READY---\nurl: ${protoUrl}\ntitle: ${featureTitle}\n---PROTOTYPE_END---`;
  }

  // ── Resume coding after prototype approval ──
  private async resumeAfterPrototypeApproval(): Promise<string> {
    const pending = this.pendingPrototype!;
    this.pendingPrototype = null;

    logger.forge('Prototype approved — proceeding to coding...');
    logger.divider();

    const context = this.kb.getProjectContext();

    const checkpoint: TaskCheckpoint = {
      id: pending.cpId,
      timestamp: new Date().toISOString(),
      userMessage: pending.intent,
      intent: pending.intent,
      totalTasks: pending.remainingTasks.length,
      completedTasks: [],
      currentAgent: '',
      currentInstruction: '',
      completedOutputs: pending.plan ? [pending.plan] : [],
      messageHistory: [],
      status: 'in_progress'
    };
    this.cpManager.save(checkpoint);

    return this.runTasks(pending.remainingTasks, pending.plan ? [pending.plan] : [], checkpoint, context);
  }

  // ── Regenerate prototype with changes ──
  private async regeneratePrototype(changeDescription: string): Promise<string> {
    const pending = this.pendingPrototype!;

    logger.forge(`Regenerating prototype with changes: ${changeDescription}`);
    logger.info('Re-generating UI prototype with requested changes...');

    const updatedPlan = `${pending.plan}\n\nRequested changes: ${changeDescription}`;
    const protoResult = await this.protoAgent.generate(pending.featureTitle, updatedPlan);

    if (!protoResult.success || !protoResult.html) {
      return `❌ Could not regenerate prototype: ${protoResult.error}\n\nWould you like to proceed with coding anyway?`;
    }

    const protoUrl = savePrototype(pending.protoId, protoResult.html);
    logger.success(`Updated prototype saved: ${protoUrl}`);

    // Update pending prototype with new plan description
    this.pendingPrototype = {
      ...pending,
      plan: updatedPlan,
    };

    return `---PROTOTYPE_READY---\nurl: ${protoUrl}\ntitle: ${pending.featureTitle}\n---PROTOTYPE_END---`;
  }

  // ── Run tasks with step-by-step confirmation ──
  private async runTasks(
    tasks: OrchestratorTask[],
    previousOutputs: string[],
    checkpoint: TaskCheckpoint,
    context: string,
    images?: Array<{ base64: string; mediaType: string; name: string }>,
    docs?: Array<{ base64?: string; text?: string; name: string; size?: number; docType: 'pdf' | 'text' }>
  ): Promise<string> {
    if (tasks.length === 0) {
      checkpoint.status = 'completed';
      this.cpManager.save(checkpoint);
      logger.divider();
      const lastOutput = previousOutputs[previousOutputs.length - 1] || '';
      // If last step was testing AND build actually passed → show deploy card
      const lastWasTesting = checkpoint.completedTasks[checkpoint.completedTasks.length - 1] === 'testing';
      const buildFailed = /build fail|npm.*not found|command not found|error TS\d|❌|cannot find module/i.test(lastOutput);
      if (lastWasTesting && !buildFailed) {
        const deployMarker = `\n\n---DEPLOY_PROMPT---\nsummary: All checks passed. Click Deploy now to push to GitHub and go live on Vercel.\nbranch: main\n---DEPLOY_END---`;
        return lastOutput + deployMarker;
      }
      return lastOutput || 'Task completed.';
    }

    const task = tasks[0];
    const remainingAfter = tasks.slice(1);

    // OPT 4: Complexity-aware coding agent selection
    const agentKey = task.agent === 'coding'
      ? (this.currentTaskType === 'new_feature' ? 'coding_complex'
         : this.currentTaskType === 'bug_fix' ? 'coding_simple'
         : 'coding_medium')
      : task.agent;
    const agent = this.agents[agentKey] || this.agents[task.agent];

    if (!agent) {
      logger.error(`Unknown agent: ${task.agent}`);
      return this.runTasks(remainingAfter, previousOutputs, checkpoint, context, images);
    }

    checkpoint.currentAgent = task.agent;
    checkpoint.currentInstruction = task.instruction;
    this.cpManager.save(checkpoint);

    let result;
    try {
      const agentContext = this.getContextForAgent(task.agent, context);

      // OPT 8: Testing fast-path — run build directly, skip LLM if it passes
      if (task.agent === 'testing') {
        result = await this.runBuildDirectly();
      } else {
        // Only pass docs to first agent (planning/coding) — don't re-send on every task
        const isFirstTask = previousOutputs.length === 0;
        result = await agent.run(task.instruction, agentContext, images, isFirstTask ? docs : undefined);

        // Guard: coding agent sometimes asks questions instead of writing code.
        // Detect this and force a re-run with an explicit override instruction.
        if (task.agent.startsWith('coding') && result.success) {
          const out = result.output || '';
          const isQuestion =
            /should i proceed|would you like|shall i|do you want|please confirm|haven.t been built|not been built|not yet implemented|before i (start|proceed|build)/i.test(out)
            || (out.trim().endsWith('?') && !/✅/.test(out));
          if (isQuestion) {
            logger.info('Coding agent asked a question — forcing code generation...');
            const forceInstruction = `STOP ASKING QUESTIONS. Your previous response asked for confirmation instead of writing code. That is wrong.\n\nYou MUST write the code now. No questions, no clarifications, no "should I proceed".\n\nOriginal task: ${task.instruction}\n\nStart immediately: use list_files to explore, then write_file/edit_file to create all necessary files. Go.`;
            result = await agent.run(forceInstruction, agentContext, images, undefined);
          }
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const isTokenLimit = /prompt is too long|token|context length|maximum context/i.test(errMsg);
      checkpoint.status = isTokenLimit ? 'token_limit' : 'error';
      checkpoint.errorMessage = errMsg;
      checkpoint.completedOutputs = previousOutputs;
      this.cpManager.save(checkpoint);

      if (isTokenLimit) {
        return `⚠️ Token limit reached — checkpoint **${checkpoint.id}** saved.\nCompleted ${checkpoint.completedTasks.length}/${checkpoint.totalTasks} tasks.\nSay **"resume"** to continue.`;
      }
      throw err;
    }

    if (!result.success) {
      checkpoint.status = 'error';
      checkpoint.errorMessage = result.error;
      this.cpManager.save(checkpoint);
      logger.error(`${task.agent} failed: ${result.error}`);
      return [...previousOutputs, `❌ ${STEP_LABELS[task.agent] || task.agent} failed: ${result.error}`].join('\n\n');
    }

    const stepLabel = STEP_LABELS[task.agent] || task.agent;
    const output = result.output;
    const allOutputs = [...previousOutputs, output];

    checkpoint.completedTasks.push(task.agent);
    checkpoint.completedOutputs.push(output);
    logger.success(`${task.agent} completed`);
    this.cpManager.save(checkpoint);

    // ── If this is a major step AND there are more steps → pause and ask ──
    const isMajor = MAJOR_STEPS.includes(task.agent);
    const hasMore = remainingAfter.filter(t => MAJOR_STEPS.includes(t.agent)).length > 0;

    if (isMajor && hasMore) {
      const nextStep = STEP_LABELS[remainingAfter[0].agent] || remainingAfter[0].agent;
      const remainingStepsList = remainingAfter
        .map(t => STEP_LABELS[t.agent] || t.agent)
        .join(' → ');

      // Save pending continuation
      this.pendingContinuation = {
        remainingTasks: remainingAfter,
        completedOutputs: allOutputs,
        intent: checkpoint.intent,
        cpId: checkpoint.id,
      };

      logger.info(`Pausing — waiting for confirmation to proceed to ${nextStep}`);

      const nextLabel = STEP_LABELS[remainingAfter[0]?.agent] || remainingAfter[0]?.agent || nextStep;
      return `${output}\n\n---CONFIRM_START---\nstep_done: ${stepLabel}\nnext_step: ${nextLabel}\nremaining: ${remainingStepsList}\n---CONFIRM_END---`;
    }

    // Single-step task or query — run all remaining without pausing
    return this.runTasks(remainingAfter, allOutputs, checkpoint, context, images, docs);
  }

  // ── Continue pending plan after user confirms ──
  private async continuePendingPlan(): Promise<string> {
    const pending = this.pendingContinuation!;
    this.pendingContinuation = null;

    logger.forge('Continuing from confirmation...');
    logger.divider();

    const context = this.kb.getProjectContext();

    // Restore checkpoint
    const checkpoint: TaskCheckpoint = {
      id: pending.cpId,
      timestamp: new Date().toISOString(),
      userMessage: pending.intent,
      intent: pending.intent,
      totalTasks: pending.remainingTasks.length + pending.completedOutputs.length,
      completedTasks: [],
      currentAgent: '',
      currentInstruction: '',
      completedOutputs: pending.completedOutputs,
      messageHistory: [],
      status: 'in_progress'
    };
    this.cpManager.save(checkpoint);

    return this.runTasks(pending.remainingTasks, pending.completedOutputs, checkpoint, context);
  }

  private async resumeFromCheckpoint(cp: TaskCheckpoint): Promise<string> {
    logger.info(`Resuming: ${cp.intent}`);
    logger.divider();

    const context = this.kb.getProjectContext();

    let plan: OrchestratorPlan;
    try {
      const planResponse = await this.client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 600,
        system: ORCHESTRATOR_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Project: AgenticAI (Next.js/TypeScript on Vercel)\n\nUser request: ${cp.userMessage}` }]
      });
      const planText = planResponse.content.filter(b => b.type === 'text').map(b => (b as Anthropic.TextBlock).text).join('');
      const jsonMatch = planText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON');
      const jsonStr2 = jsonMatch[0]
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"');
      plan = JSON.parse(jsonStr2);
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

    logger.info(`Remaining: ${remainingTasks.map(t => STEP_LABELS[t.agent] || t.agent).join(' → ')}`);
    const resumeCtx = context.slice(0, 600);
    return this.runTasks(remainingTasks, cp.completedOutputs, cp, resumeCtx);
  }

  private listCheckpoints(): string {
    const all = this.cpManager.listAll();
    if (all.length === 0) return 'No checkpoints found.';
    const lines = all.slice(0, 10).map(cp => {
      const icon = cp.status === 'completed' ? '✅' : cp.status === 'token_limit' ? '⚠️' : cp.status === 'error' ? '❌' : '🔄';
      return `${icon} **${cp.id}** — ${cp.intent.slice(0, 60)}\n   ${cp.completedTasks.length}/${cp.totalTasks} tasks · ${new Date(cp.timestamp).toLocaleString()}`;
    });
    return `**Checkpoints:**\n\n${lines.join('\n\n')}\n\nSay "resume" to continue the latest unfinished task.`;
  }

  /** Resolve a PATH that includes npm regardless of Electron's stripped environment */
  private buildEnvPath(): string {
    const extra: string[] = [
      '/usr/local/bin',
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
    ];
    // Detect nvm: find the active/latest version directory
    const nvmDir = path.join(process.env.HOME || '', '.nvm', 'versions', 'node');
    try {
      if (fs.existsSync(nvmDir)) {
        const versions = fs.readdirSync(nvmDir)
          .filter(v => v.startsWith('v'))
          .sort((a, b) => {
            const [, ma, na, pa] = a.match(/v(\d+)\.(\d+)\.(\d+)/) || [];
            const [, mb, nb, pb] = b.match(/v(\d+)\.(\d+)\.(\d+)/) || [];
            return (+mb - +ma) || (+nb - +na) || (+pb - +pa);
          });
        if (versions.length > 0) extra.unshift(path.join(nvmDir, versions[0], 'bin'));
      }
    } catch { /* ignore */ }
    return [...extra, process.env.PATH || ''].join(':');
  }

  private async runBuildDirectly(): Promise<{ success: boolean; output: string; error?: string }> {
    const projectPath = '/Users/gauravpassi/Desktop/AgenticAI/agenticai-demo';
    logger.info('Running build directly (no LLM)...');

    const env = { ...process.env, PATH: this.buildEnvPath() };

    try {
      execSync('npm run build', {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 120000,
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });
      logger.success('Build passed');
      return { success: true, output: '✅ Build passed — no TypeScript errors found.' };
    } catch (err: unknown) {
      const error = err as { stdout?: string; stderr?: string; message?: string };
      const buildOutput = [error.stdout, error.stderr].filter(Boolean).join('\n').slice(0, 1500);
      logger.error('Build failed — running LLM analysis');

      // Pass explicit success: false so the deploy card is never shown after a build failure
      const agent = this.agents['testing'];
      if (agent) {
        const agentContext = this.getContextForAgent('testing', '');
        const result = await agent.run(
          `Build failed with these errors. Analyse, explain the root cause, and suggest the fix:\n\n${buildOutput}`,
          agentContext
        );
        // Always mark as failure regardless of whether the LLM agent itself succeeded
        return { success: false, output: result.output, error: 'Build failed' };
      }
      return { success: false, output: `❌ Build failed:\n\`\`\`\n${buildOutput}\n\`\`\``, error: 'Build failed' };
    }
  }

  private getContextForAgent(agentName: string, fullContext: string): string | undefined {
    switch (agentName) {
      case 'deployment': return undefined;
      case 'testing':    return undefined;
      case 'query':      return fullContext.slice(0, 400);
      case 'planning':   return fullContext.slice(0, 800);
      case 'coding':     return fullContext.slice(0, 1200);
      case 'docs':       return fullContext.slice(0, 400);
      default:           return fullContext.slice(0, 600);
    }
  }
  // ── Build plan deterministically from task type — no LLM, no JSON ──
  private buildPlan(userMessage: string, taskType: TaskType, _context: string): OrchestratorPlan {
    const msg = userMessage;

    // Git / deployment queries
    if (taskType === 'git') {
      return {
        intent: userMessage,
        tasks: [{ agent: 'deployment', instruction: msg }],
        summary_prompt: 'Git operation complete'
      };
    }

    // Simple questions / lookups
    if (taskType === 'query') {
      return {
        intent: userMessage,
        tasks: [{ agent: 'query', instruction: msg }],
        summary_prompt: 'Question answered'
      };
    }

    // Testing only
    if (/^(run|check|verify|validate)\s+(the\s+)?(build|tests?|npm)/i.test(msg.trim())) {
      return {
        intent: userMessage,
        tasks: [{ agent: 'testing', instruction: msg }],
        summary_prompt: 'Build check complete'
      };
    }

    // Docs only
    if (/^(document|write docs|update readme|generate docs)/i.test(msg.trim())) {
      return {
        intent: userMessage,
        tasks: [
          { agent: 'planning', instruction: msg },
          { agent: 'docs', instruction: msg }
        ],
        summary_prompt: 'Documentation updated'
      };
    }

    // New feature — planning → prototype (injected automatically) → coding → testing
    // Deployment is NOT automatic — user must explicitly say "deploy" or "push to GitHub"
    if (taskType === 'new_feature') {
      return {
        intent: userMessage,
        tasks: [
          { agent: 'planning', instruction: msg },
          { agent: 'coding',   instruction: msg },
          { agent: 'testing',  instruction: msg },
        ],
        summary_prompt: '✅ Build complete! Say "deploy" or "push to GitHub" when ready to go live.',
        isNewFeature: true
      };
    }

    // Bug fix or enhancement — planning → coding → testing (no auto-deploy)
    if (taskType === 'bug_fix' || taskType === 'enhancement') {
      return {
        intent: userMessage,
        tasks: [
          { agent: 'planning', instruction: msg },
          { agent: 'coding',   instruction: msg },
          { agent: 'testing',  instruction: msg },
        ],
        summary_prompt: '✅ Fix applied! Say "deploy" or "push to GitHub" when ready to go live.'
      };
    }

    // Fallback — query
    return {
      intent: userMessage,
      tasks: [{ agent: 'query', instruction: msg }],
      summary_prompt: 'Done'
    };
  }

}
