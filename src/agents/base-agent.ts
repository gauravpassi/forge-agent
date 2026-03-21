import Anthropic from '@anthropic-ai/sdk';
import { fileToolDefinitions, executeFileTool } from '../tools/file-tools';
import { gitToolDefinitions, executeGitTool } from '../tools/git-tools';
import { bashToolDefinitions, executeBashTool } from '../tools/bash-tool';
import { kbToolDefinitions, executeKbTool } from '../tools/kb-tools';
import { logger } from '../utils/logger';

export interface AgentOptions {
  name: string;
  systemPrompt: string;
  projectPath: string;
  tools?: string[];
  model?: string;       // override model
  maxTokens?: number;   // override max_tokens
}

export interface AgentResult {
  success: boolean;
  output: string;
  error?: string;
}

// Model tiers
export const MODELS = {
  fast:    'claude-haiku-4-5',       // routing, git, simple Q&A
  balanced: 'claude-sonnet-4-5',     // planning, docs, testing
  powerful: 'claude-opus-4-6',       // complex coding only
};

// Different tools need different content budgets
const TOOL_MAX_LEN: Record<string, number> = {
  read_file:        3000,   // needs substantial file content
  write_file:       200,    // just confirm success
  edit_file:        200,    // just confirm success
  list_files:       800,    // filenames are compact
  search_in_files:  600,    // search results
  git_diff:        1200,    // needs context around changes
  git_status:       400,
  git_log:          500,
  git_commit_and_push: 300,
  run_command:      800,    // build output needs room for errors
  kb_read:          600,
  kb_write:         100,
};

function trimResult(result: string, toolName = 'default'): string {
  const maxLen = TOOL_MAX_LEN[toolName] ?? 600;
  if (result.length <= maxLen) return result;
  return result.slice(0, maxLen) + `\n… [truncated ${result.length - maxLen} chars]`;
}

// Compress old tool results in message history to prevent context bloat.
// After 16 messages (8 turns), old tool results are truncated to 60 chars.
function compressHistory(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (messages.length <= 16) return messages;
  // Keep first 2 messages (original instruction) and last 8 messages intact
  // Compress everything in between
  const head = messages.slice(0, 2);
  const tail = messages.slice(-8);
  const middle = messages.slice(2, -8).map(msg => {
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      const compressed = msg.content.map(block => {
        if (block.type === 'tool_result') {
          const content = typeof block.content === 'string' ? block.content : '';
          return {
            ...block,
            content: content.length > 60 ? content.slice(0, 60) + '…' : content
          };
        }
        return block;
      });
      return { ...msg, content: compressed };
    }
    return msg;
  });
  return [...head, ...middle, ...tail];
}

export class BaseAgent {
  private abortController: AbortController | null = null;

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
  protected client: Anthropic;
  protected options: AgentOptions;

  constructor(client: Anthropic, options: AgentOptions) {
    this.client = client;
    this.options = options;
  }

  protected getTools(): Anthropic.Tool[] {
    const toolGroups = this.options.tools || ['file', 'kb'];
    const tools: Anthropic.Tool[] = [];
    if (toolGroups.includes('file'))  tools.push(...fileToolDefinitions as Anthropic.Tool[]);
    if (toolGroups.includes('git'))   tools.push(...gitToolDefinitions as Anthropic.Tool[]);
    if (toolGroups.includes('bash'))  tools.push(...bashToolDefinitions as Anthropic.Tool[]);
    if (toolGroups.includes('kb'))    tools.push(...kbToolDefinitions as Anthropic.Tool[]);
    return tools;
  }

  protected async executeTool(toolName: string, toolInput: Record<string, unknown>): Promise<string> {
    logger.tool(toolName, JSON.stringify(toolInput).slice(0, 80));
    const input = toolInput as Record<string, string>;

    if (['read_file','write_file','edit_file','list_files','search_in_files'].includes(toolName))
      return executeFileTool(toolName, input, this.options.projectPath);

    if (['git_status','git_diff','git_log','git_commit_and_push','git_create_branch'].includes(toolName))
      return executeGitTool(toolName, input as Record<string, string | boolean | number>, this.options.projectPath);

    if (toolName === 'run_command')
      return executeBashTool(input as Record<string, string | number>, this.options.projectPath);

    if (['kb_read','kb_write'].includes(toolName))
      return executeKbTool(toolName, input);

    return `Unknown tool: ${toolName}`;
  }

  async run(
    instruction: string,
    context?: string,
    images?: Array<{ base64: string; mediaType: string; name: string }>,
    docs?: Array<{ base64?: string; text?: string; name: string; size?: number; docType: 'pdf' | 'text' }>
  ): Promise<AgentResult> {
    // Minimal context: only pass if agent actually needs project awareness
    const needsContext = ['file','kb','bash'].some(t => (this.options.tools || []).includes(t));
    const textContent = needsContext && context
      ? `Context:\n${context}\n\nInstruction: ${instruction}`
      : instruction;

    // Build first message — one block per image + one block per document
    let firstContent: Anthropic.MessageParam['content'];
    const contentBlocks: Anthropic.ContentBlockParam[] = [];

    // ── Images: one vision block per image ──
    if (images && images.length > 0) {
      if (images.length > 1) {
        contentBlocks.push({ type: 'text', text: `Attached images (${images.length}): ${images.map(i => i.name).join(', ')}\n` });
      }
      for (const img of images) {
        contentBlocks.push({
          type: 'image',
          source: { type: 'base64', media_type: img.mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp', data: img.base64 }
        });
        logger.info(`Image attached: ${img.name} (${img.mediaType})`);
      }
    }

    // ── Documents: one document block per file ──
    if (docs && docs.length > 0) {
      const manifest = docs.map((d, i) =>
        `[File ${i + 1}] ${d.name} (${d.docType === 'pdf' ? 'PDF' : 'text'})${d.size ? ` — ${Math.round(d.size / 1024)} KB` : ''}`
      ).join('\n');
      contentBlocks.push({ type: 'text', text: `Attached files:\n${manifest}\n` });

      for (const doc of docs) {
        if (doc.docType === 'pdf' && doc.base64) {
          contentBlocks.push({
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: doc.base64 }
          } as unknown as Anthropic.ContentBlockParam);
          logger.info(`PDF attached: ${doc.name}`);
        } else if (doc.docType === 'text' && doc.text) {
          contentBlocks.push({
            type: 'document',
            source: { type: 'text', media_type: 'text/plain', data: doc.text }
          } as unknown as Anthropic.ContentBlockParam);
          logger.info(`Text doc attached: ${doc.name} (${doc.text.length} chars)`);
        }
      }
    }

    contentBlocks.push({ type: 'text', text: textContent });

    if (contentBlocks.length > 1) {
      firstContent = contentBlocks;
    } else {
      firstContent = textContent;
    }

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: firstContent }];
    const tools = this.getTools();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    logger.agent(this.options.name, instruction.slice(0, 80) + (instruction.length > 80 ? '...' : ''));

    // Dynamic model & token selection
    const model     = this.options.model     || MODELS.balanced;
    const maxTokens = this.options.maxTokens || 1024;

    try {
      let finalOutput = '';

      while (true) {
        if (signal.aborted) throw new Error('CANCELLED');
        const compressedMessages = compressHistory(messages);

        // Retry on overloaded (529) with exponential backoff
        let response!: Anthropic.Message;
        for (let attempt = 1; attempt <= 4; attempt++) {
          try {
            response = await (this.client.messages.create({
              model,
              max_tokens: maxTokens,
              system: this.options.systemPrompt,
              tools,
              messages: compressedMessages
            }) as unknown as Promise<Anthropic.Message>);
            break; // success
          } catch (apiErr: unknown) {
            const status = (apiErr as { status?: number }).status;
            const msg = String(apiErr);
            const isOverloaded = status === 529 || msg.includes('overloaded_error');
            if (isOverloaded && attempt < 4) {
              const delay = attempt * 10000; // 10s, 20s, 30s
              logger.info(`API overloaded — retrying in ${delay / 1000}s (attempt ${attempt}/3)…`);
              await new Promise(r => setTimeout(r, delay));
              continue;
            }
            throw apiErr;
          }
        }

        // Reset each turn — we only want the FINAL text, not intermediate
        // "I'll analyze...", "Let me check..." narration between tool calls
        finalOutput = '';
        for (const block of response.content) {
          if (block.type === 'text') finalOutput += block.text;
        }

        if (response.stop_reason === 'end_turn') break;

        if (response.stop_reason === 'tool_use') {
          messages.push({ role: 'assistant', content: response.content });

          const toolBlocks = response.content.filter(b => b.type === 'tool_use') as Anthropic.ToolUseBlock[];

          // Execute all tool calls in parallel — significant speedup for multi-tool turns
          const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
            toolBlocks.map(async (block) => {
              const raw = await this.executeTool(block.name, block.input as Record<string, unknown>);
              const result = trimResult(raw, block.name);
              logger.toolDone(block.name, result);
              return { type: 'tool_result' as const, tool_use_id: block.id, content: result };
            })
          );

          messages.push({ role: 'user', content: toolResults });
          continue;
        }

        break;
      }

      return { success: true, output: finalOutput };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      if (error === 'CANCELLED' || error.includes('aborted')) {
        logger.info(`${this.options.name} cancelled by user`);
        return { success: false, output: '', error: 'CANCELLED' };
      }
      logger.error(`${this.options.name} failed: ${error}`);
      return { success: false, output: '', error };
    }
  }
}
