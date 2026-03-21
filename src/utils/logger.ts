type LogCallback = (type: string, message: string, meta?: Record<string, string>) => void;

let logCallback: LogCallback | null = null;

export function setLogCallback(cb: LogCallback) {
  logCallback = cb;
}

function emit(type: string, message: string, meta?: Record<string, string>) {
  console.log(`[${type}] ${message}`);
  if (logCallback) logCallback(type, message, meta);
}

export const logger = {
  forge: (msg: string) => emit('forge', msg),
  agent: (name: string, msg: string) => emit('agent', msg, { agent: name }),
  tool: (name: string, input: string) => emit('tool_start', name, { tool: name, input: input.slice(0, 120) }),
  toolDone: (name: string, result: string) => emit('tool_done', name, { tool: name, result: result.slice(0, 120) }),
  success: (msg: string) => emit('success', msg),
  error: (msg: string) => emit('error', msg),
  info: (msg: string) => emit('info', msg),
  divider: () => emit('divider', ''),
  user: (msg: string) => emit('info', 'You: ' + msg),
  response: (msg: string) => emit('info', 'Forge: ' + msg),
};
