import { RealtimeAgent, RealtimeSession, tool } from '@openai/agents/realtime';
import { z } from 'zod';

export const REALTIME_SUPPORT_MODEL = 'gpt-realtime-2.1';

const SUPPORT_INSTRUCTIONS = `# Role and Objective
You are the AI Control Plane realtime customer support agent. Help callers use this application's governed multi-agent workflow features.

# Support Scope
Answer questions about AI Control Plane setup, runs, agents, capabilities, approval and verification gates, evidence, ledger behavior, CLI usage, and troubleshooting directly related to this app. Do not answer unrelated general-purpose requests. For an out-of-scope request, say it is outside AI Control Plane support and ask whether the caller has a product-support question.

# Conversation Behavior
- Greet the caller briefly when the call begins.
- Ask one clarifying question at a time when the issue is ambiguous.
- Keep spoken answers concise and practical.
- Never invent account, ticket, run, order, or system state.
- The available support actions are explicitly placeholders; say so when their result says placeholder=true.
- Before the call ends, summarize the next step the caller should take.

# Tools
Use lookup_support_context only when a caller needs app-specific support context. Use create_support_request only when the caller wants a follow-up request recorded. These currently call placeholder server routes and do not represent a production ticket system.`;

async function postJson(
  path: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch
): Promise<string> {
  const response = await fetchImpl(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    return JSON.stringify({
      ok: false,
      error: `Support action failed with status ${response.status}`
    });
  }

  return JSON.stringify(await response.json());
}

export function createSupportAgent(fetchImpl: typeof fetch = fetch): RealtimeAgent {
  const lookupSupportContext = tool({
    name: 'lookup_support_context',
    description:
      'Placeholder support lookup for AI Control Plane product questions. Returns clearly labeled non-production support context.',
    parameters: z.object({
      question: z.string().min(1).describe('The caller support question to look up.')
    }),
    async execute({ question }) {
      return postJson('/api/support/context', { question }, fetchImpl);
    }
  });

  const createSupportRequest = tool({
    name: 'create_support_request',
    description:
      'Placeholder follow-up request action. Use only when the caller asks for follow-up; the returned request is not persisted.',
    parameters: z.object({
      summary: z.string().min(1).describe('A concise summary of the caller issue and requested follow-up.')
    }),
    async execute({ summary }) {
      return postJson('/api/support/request', { summary }, fetchImpl);
    }
  });

  return new RealtimeAgent({
    name: 'AI Control Plane Support',
    instructions: SUPPORT_INSTRUCTIONS,
    tools: [lookupSupportContext, createSupportRequest]
  });
}

export function createSupportSession(agent = createSupportAgent()): RealtimeSession {
  return new RealtimeSession(agent, { model: REALTIME_SUPPORT_MODEL });
}

type TranscriptElement = HTMLElement & { textContent: string | null };

function historyLine(item: unknown): string | null {
  if (item === null || typeof item !== 'object') {
    return null;
  }

  const candidate = item as {
    role?: unknown;
    type?: unknown;
    content?: unknown;
    transcript?: unknown;
    text?: unknown;
  };
  const role = typeof candidate.role === 'string' ? candidate.role : undefined;

  if (typeof candidate.transcript === 'string' && candidate.transcript.trim()) {
    return `${role ?? 'voice'}: ${candidate.transcript.trim()}`;
  }
  if (typeof candidate.text === 'string' && candidate.text.trim()) {
    return `${role ?? 'voice'}: ${candidate.text.trim()}`;
  }
  if (!Array.isArray(candidate.content)) {
    return null;
  }

  const fragments = candidate.content
    .map((part) => {
      if (part === null || typeof part !== 'object') return null;
      const value = part as { transcript?: unknown; text?: unknown };
      if (typeof value.transcript === 'string') return value.transcript;
      if (typeof value.text === 'string') return value.text;
      return null;
    })
    .filter((value): value is string => Boolean(value?.trim()));

  return fragments.length > 0 ? `${role ?? 'voice'}: ${fragments.join(' ')}` : null;
}

export function initializeSupportApp(documentRef: Document = document): void {
  const startButton = documentRef.querySelector<HTMLButtonElement>('#start-call');
  const endButton = documentRef.querySelector<HTMLButtonElement>('#end-call');
  const status = documentRef.querySelector<HTMLElement>('#connection-status');
  const transcript = documentRef.querySelector<TranscriptElement>('#support-transcript');

  if (!startButton || !endButton || !status || !transcript) {
    throw new Error('Realtime support UI is missing required elements.');
  }

  let session: RealtimeSession | null = null;

  const setUiState = (state: 'idle' | 'connecting' | 'connected' | 'error') => {
    status.textContent =
      state === 'idle'
        ? 'Not connected'
        : state === 'connecting'
          ? 'Connecting…'
          : state === 'connected'
            ? 'Call connected'
            : 'Connection error';
    startButton.disabled = state === 'connecting' || state === 'connected';
    endButton.disabled = state !== 'connected';
  };

  startButton.addEventListener('click', async () => {
    setUiState('connecting');
    transcript.textContent = 'Starting support call…';

    try {
      const secretResponse = await fetch('/api/realtime/session', { method: 'POST' });
      if (!secretResponse.ok) {
        throw new Error(`Session request failed: ${secretResponse.status}`);
      }

      const payload = (await secretResponse.json()) as { client_secret?: unknown };
      if (typeof payload.client_secret !== 'string' || payload.client_secret.length === 0) {
        throw new Error('Session response did not include a client secret.');
      }

      const nextSession = createSupportSession();
      nextSession.on('history_updated', (history) => {
        const lines = history
          .map(historyLine)
          .filter((line): line is string => line !== null)
          .slice(-8);
        transcript.textContent = lines.length > 0 ? lines.join('\n') : 'Call connected.';
      });
      nextSession.on('error', () => setUiState('error'));

      await nextSession.connect({ apiKey: payload.client_secret });
      session = nextSession;
      setUiState('connected');
      nextSession.sendMessage(
        'The call has just started. Greet the caller briefly, explain that you support AI Control Plane, and ask what you can help with.'
      );
    } catch (error) {
      session?.close();
      session = null;
      setUiState('error');
      transcript.textContent = error instanceof Error ? error.message : 'Unable to start the support call.';
    }
  });

  endButton.addEventListener('click', () => {
    session?.close();
    session = null;
    setUiState('idle');
    transcript.textContent = transcript.textContent || 'Call ended.';
  });

  setUiState('idle');
}
