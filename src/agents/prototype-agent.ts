import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from './base-agent';
import { logger } from '../utils/logger';

const PROTOTYPE_SYSTEM_PROMPT = `You are a UI prototype generator for the Forge development platform.

Given a feature description, generate a COMPLETE, beautiful, realistic HTML prototype.

Design system (match exactly):
- Background: #09090b (page), #18181b (cards), #27272a (inputs)
- Borders: #3f3f46
- Text: #fafafa (primary), #a1a1aa (secondary), #71717a (muted)
- Accent: #22c55e (green), #3b82f6 (blue), #f59e0b (amber)
- Font: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif
- Border radius: 8px cards, 6px inputs, 4px badges

Requirements:
- Complete standalone HTML file — no external CDN, no imports
- All CSS inline in <style> tag
- Realistic fake data (not "Lorem ipsum" — actual relevant content)
- Working interactions in pure JS (tabs, toggles, dropdowns, search filter)
- Responsive layout
- Sidebar or top nav matching the AgenticAI platform style
- Looks production-ready, not like a wireframe

Output format — wrap the HTML between these exact markers:
---PROTOTYPE_START---
<!DOCTYPE html>
... full HTML ...
</html>
---PROTOTYPE_END---

CRITICAL: Start your response IMMEDIATELY with ---PROTOTYPE_START--- on the very first line. No preamble, no explanation before or after the markers.`;

export class PrototypeAgent {
  private client: Anthropic;

  constructor(client: Anthropic) {
    this.client = client;
  }

  async generate(featureTitle: string, planDescription: string, complexity: 'simple' | 'complex' = 'complex'): Promise<{ html: string; success: boolean; error?: string }> {
    const maxTokens = complexity === 'simple' ? 4096 : 6000; // cap at 6k to avoid long hangs
    const TIMEOUT_MS = 90_000; // 90-second hard timeout

    logger.agent('Prototype', `Generating UI prototype for "${featureTitle.slice(0, 50)}"`);

    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Race between the API call and a hard timeout
        const apiCall = this.client.messages.create({
          model: MODELS.balanced,
          max_tokens: maxTokens,
          system: PROTOTYPE_SYSTEM_PROMPT,
          messages: [{
            role: 'user',
            content: `Feature: ${featureTitle}\n\nPlan:\n${planDescription}\n\nGenerate the prototype now.`
          }]
        });

        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('PROTOTYPE_TIMEOUT')), TIMEOUT_MS)
        );

        const response = await Promise.race([apiCall, timeoutPromise]) as Anthropic.Message;

        const text = response.content
          .filter(b => b.type === 'text')
          .map(b => (b as Anthropic.TextBlock).text)
          .join('');

        // Try strict marker match first
        const match = text.match(/---PROTOTYPE_START---([\s\S]*?)---PROTOTYPE_END---/);
        if (match) return { html: match[1].trim(), success: true };

        // Fallback: truncated response — grab everything after START marker
        const startIdx = text.indexOf('---PROTOTYPE_START---');
        if (startIdx !== -1) {
          const afterStart = text.slice(startIdx + '---PROTOTYPE_START---'.length).trim();
          if (afterStart.includes('<!DOCTYPE') || afterStart.includes('<html')) {
            logger.info('Prototype: using truncated fallback HTML');
            return { html: afterStart, success: true };
          }
        }

        return { html: '', success: false, error: 'No valid HTML in prototype response' };

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isTimeout = msg === 'PROTOTYPE_TIMEOUT';
        const isOverloaded = msg.includes('overloaded') || (err as { status?: number }).status === 529;

        if (isTimeout) {
          logger.error(`Prototype timed out after ${TIMEOUT_MS / 1000}s`);
          return { html: '', success: false, error: `Prototype timed out after ${TIMEOUT_MS / 1000}s` };
        }

        if (isOverloaded && attempt < MAX_RETRIES) {
          const delay = attempt * 10_000;
          logger.info(`Prototype API overloaded — retrying in ${delay / 1000}s (attempt ${attempt}/${MAX_RETRIES})…`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        return { html: '', success: false, error: msg };
      }
    }

    return { html: '', success: false, error: 'Prototype generation failed after retries' };
  }
}
