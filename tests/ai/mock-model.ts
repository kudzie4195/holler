import { MockLanguageModelV4 } from 'ai/test';

/** Record ids in the prompt the code sent (the JSON lines inside <records>). */
export function idsInPrompt(prompt: unknown): number[] {
  const text = JSON.stringify(prompt);
  return [...text.matchAll(/\\"id\\":(\d+)/g)].map((m) => Number(m[1]));
}

export interface MockCall {
  prompt: unknown;
  maxOutputTokens?: number;
  ids: number[];
}

/**
 * A mock gateway model. `answer` gets the record ids of each call and returns the model's JSON (object or raw string).
 * Usage defaults to 1000 input / 500 output tokens.
 */
export function mockModel(
  answer: (ids: number[], call: number) => unknown,
  opts: {
    /** null: the provider reports no usage numbers at all. */
    usage?: { input: number; output: number } | null;
    /** Cost the AI Gateway reports in providerMetadata.gateway.cost (USD, as a string like the gateway sends it). */
    gatewayCost?: number;
    delayMs?: number;
    throwError?: Error;
  } = {},
) {
  const calls: MockCall[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (o) => {
      const ids = idsInPrompt(o.prompt);
      calls.push({ prompt: o.prompt, maxOutputTokens: o.maxOutputTokens, ids });
      if (opts.delayMs) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, opts.delayMs);
          o.abortSignal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(o.abortSignal?.reason ?? new Error('aborted'));
          });
        });
      }
      if (opts.throwError) throw opts.throwError;
      const out = answer(ids, calls.length);
      const text = typeof out === 'string' ? out : JSON.stringify(out);
      const u = opts.usage === null ? null : (opts.usage ?? { input: 1000, output: 500 });
      return {
        content: [{ type: 'text', text }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: u?.input, noCache: u?.input, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: u?.output, text: u?.output, reasoning: undefined },
        },
        ...(opts.gatewayCost !== undefined ? { providerMetadata: { gateway: { cost: String(opts.gatewayCost) } } } : {}),
        warnings: [],
      };
    },
  });
  return { model, calls };
}

/** A well-behaved answer: roofing 0.9 with a clean note, auto-body 0.5. */
export function goodAnswer(ids: number[]) {
  return {
    results: ids.map((id) => ({
      id,
      trades: [
        { trade: 'roofing', p: 0.9 },
        { trade: 'auto-body', p: 0.5 },
      ],
      notes: [{ trade: 'roofing', why: 'Hail this size may leave roofs in need of an inspection soon.' }],
    })),
  };
}
