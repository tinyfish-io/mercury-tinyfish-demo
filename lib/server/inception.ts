// Inception's API: Mercury Decide for typed decisions (POST /v1/decisions) and Mercury 3 for the written answer
// (POST /v1/chat/completions, OpenAI-compatible). Plain fetch, no SDK: both are a single JSON request.

const BASE_URL = process.env.INCEPTION_BASE_URL || 'https://api.inceptionlabs.ai/v1';
export const DECIDE_MODEL = process.env.DECIDE_MODEL || 'mercury-decide';
export const ANSWER_MODEL = process.env.ANSWER_MODEL || 'mercury-3';
const DECIDE_TIMEOUT_MS = 15_000;
const ANSWER_TIMEOUT_MS = 60_000;

export type Noul = {
  type: 'noul';
  instructions: string | null;
  criteria?: { true?: string; false?: string };
};
export type Choice = {
  type: 'choice';
  instructions: string | null;
  criteria: Record<string, string | null>;
};
export type Question = Noul | Choice;

export type NoulAnswer = { type: 'noul'; noul: number };
export type ChoiceAnswer = {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};
export type DecideResponse = {
  model: string;
  answers: Record<string, NoulAnswer | ChoiceAnswer>;
  usage: { input_tokens: number; output_tokens: number };
};

export const noul = (instructions: string, criteria?: Noul['criteria']): Noul => ({
  type: 'noul',
  instructions,
  ...(criteria ? { criteria } : {}),
});
export const choice = (instructions: string, criteria: Choice['criteria']): Choice => ({
  type: 'choice',
  instructions,
  criteria,
});

export function hasKey(): boolean {
  return !!process.env.INCEPTION_API_KEY;
}

function headers() {
  return {
    Authorization: `Bearer ${process.env.INCEPTION_API_KEY ?? ''}`,
    'Content-Type': 'application/json',
  };
}

async function failure(res: Response, what: string): Promise<Error> {
  const body = await res.text().catch(() => '');
  return new Error(`${what} failed (HTTP ${res.status}): ${body.slice(0, 200)}`);
}

/** One Mercury Decide request: every question is answered independently against the shared state. */
export async function decide(
  state: unknown,
  questions: Record<string, Question>,
): Promise<DecideResponse> {
  const res = await fetch(`${BASE_URL}/decisions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ model: DECIDE_MODEL, state, questions }),
    signal: AbortSignal.timeout(DECIDE_TIMEOUT_MS),
  });
  if (!res.ok) throw await failure(res, 'Mercury Decide');
  return (await res.json()) as DecideResponse;
}

export type AnswerUsage = { input_tokens: number; output_tokens: number };

/**
 * Mercury 3, streamed in diffusion mode: every chunk is the whole answer at one denoising step, not a delta, so
 * `onStep` always gets the full text so far. Resolves with the final text and the token usage.
 */
export async function streamAnswer(opts: {
  system: string;
  user: string;
  onStep: (text: string) => void;
  signal?: AbortSignal;
}): Promise<{ text: string; steps: number; usage?: AnswerUsage }> {
  const signal = opts.signal
    ? AbortSignal.any([opts.signal, AbortSignal.timeout(ANSWER_TIMEOUT_MS)])
    : AbortSignal.timeout(ANSWER_TIMEOUT_MS);
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model: ANSWER_MODEL,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      reasoning_effort: process.env.ANSWER_REASONING_EFFORT || 'instant',
      max_completion_tokens: 1200,
      stream: true,
      diffusing: true,
      stream_options: { include_usage: true },
    }),
    signal,
  });
  if (!res.ok || !res.body) throw await failure(res, 'Mercury 3');

  let text = '';
  let steps = 0;
  let usage: AnswerUsage | undefined;
  let buf = '';
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data: {')) continue;
      let event: {
        choices?: { delta?: { content?: string | null } }[];
        usage?: { prompt_tokens: number; completion_tokens: number };
      };
      try {
        event = JSON.parse(line.slice(6));
      } catch {
        continue;
      }
      if (event.usage)
        usage = {
          input_tokens: event.usage.prompt_tokens,
          output_tokens: event.usage.completion_tokens,
        };
      const content = event.choices?.[0]?.delta?.content;
      if (content) {
        text = content;
        steps++;
        opts.onStep(text);
      }
    }
  }
  return { text, steps, usage };
}
