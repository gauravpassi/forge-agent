type LogCallback = (type: string, message: string) => void;

let logCallback: LogCallback | null = null;

export function setLogCallback(cb: LogCallback) {
  logCallback = cb;
}

function emit(type: string, message: string) {
  console.log(`[${type}] ${message}`);
  if (logCallback) logCallback(type, message);
}

export const logger = {
  forge: (msg: string) => emit('forge', msg),
  agent: (name: string, msg: string) => emit('agent', `[${name}] ${msg}`),
  tool: (name: string, msg: string) => emit('tool', `${name}: ${msg}`),
  success: (msg: string) => emit('success', msg),
  error: (msg: string) => emit('error', msg),
  info: (msg: string) => emit('info', msg),
  divider: () => emit('info', '────────────────────────────'),
  user: (msg: string) => emit('info', 'You: ' + msg),
  response: (msg: string) => emit('info', 'Forge: ' + msg),
};
