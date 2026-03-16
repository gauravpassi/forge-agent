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
  tools?: string[]; // which tool groups to enable: 'file', 'git', 'bash', 'kb'
}

export interface AgentResult {
  success: boolean;
  output: string;
  error?: string;
}

export class BaseAgent {
  protected client: Anthropic;
  protected options: AgentOptions;

  constructor(client: Anthropic, options: AgentOptions) {
    this.client = client;
    this.options = options;
  }

  protected getTools(): Anthropic.Tool[] {
    const toolGroups = this.options.tools || ['file', 'kb'];
    const tools: Anthropic.Tool[] = [];

    if (toolGroups.includes('file')) {
      tools.push(...fileToolDefinitions as Anthropic.Tool[]);
    }
    if (toolGroups.includes('git')) {
      tools.push(...gitToolDefinitions as Anthropic.Tool[]);
    }
    if (toolGroups.includes('bash')) {
      tools.push(...bashToolDefinitions as Anthropic.Tool[]);
    }
    if (toolGroups.includes('kb')) {
      tools.push(...kbToolDefinitions as Anthropic.Tool[]);
    }

    return tools;
  }

  protected async executeTool(toolName: string, toolInput: Record<string, unknown>): Promise<string> {
    logger.tool(toolName, JSON.stringify(toolInput).slice(0, 80));

    const input = toolInput as Record<string, string>;

    // File tools
    if (['read_file', 'write_file', 'edit_file', 'list_files', 'search_in_files'].includes(toolName)) {
      return executeFileTool(toolName, input, this.options.projectPath);
    }

    // Git tools
    if (['git_status', 'git_diff', 'git_log', 'git_commit_and_push', 'git_create_branch'].includes(toolName)) {
      return executeGitTool(toolName, input as Record<string, string | boolean | number>, this.options.projectPath);
    }

    // Bash tool
    if (toolName === 'run_command') {
      return executeBashTool(input as Record<string, string | number>, this.options.projectPath);
    }

    // KB tools
    if (['kb_read', 'kb_write'].includes(toolName)) {
      return executeKbTool(toolName, input);
    }

    return `Unknown tool: ${toolName}`;
  }

  async run(instruction: string, context?: string): Promise<AgentResult> {
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: context
          ? `Context:\n${context}\n\nInstruction: ${instruction}`
          : instruction
      }
    ];

    const tools = this.getTools();

    logger.agent(this.options.name, instruction.slice(0, 80) + (instruction.length > 80 ? '...' : ''));

    try {
      let finalOutput = '';

      // Agentic loop
      while (true) {
        const response = await this.client.messages.create({
          model: 'claude-opus-4-5',
          max_tokens: 4096,
          system: this.options.systemPrompt,
          tools,
          messages
        });

        // Collect text output
        for (const block of response.content) {
          if (block.type === 'text') {
            finalOutput += block.text;
          }
        }

        // If done, break
        if (response.stop_reason === 'end_turn') {
          break;
        }

        // Handle tool use
        if (response.stop_reason === 'tool_use') {
          // Add assistant message with tool calls
          messages.push({ role: 'assistant', content: response.content });

          // Process each tool call
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of response.content) {
            if (block.type === 'tool_use') {
              const result = await this.executeTool(block.name, block.input as Record<string, unknown>);
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: result
              });
            }
          }

          // Add tool results
          messages.push({ role: 'user', content: toolResults });
          continue;
        }

        break;
      }

      return { success: true, output: finalOutput };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error(`${this.options.name} failed: ${error}`);
      return { success: false, output: '', error };
    }
  }
}
