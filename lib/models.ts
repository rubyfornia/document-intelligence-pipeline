// Model layer: Anthropic (generative) + Gemini (embeddings). Strict tools everywhere.
// Prices verified 2026-08-29 against current reference; restated in the README.
import Anthropic from "@anthropic-ai/sdk";

export const HAIKU = "claude-haiku-4-5";
export const SONNET = "claude-sonnet-5";
export const PRICES: Record<string, { in: number; out: number }> = {
  [HAIKU]: { in: 1.0, out: 5.0 },       // $/MTok
  [SONNET]: { in: 2.0, out: 10.0 },
};
export function costUSD(model: string, inTok: number, outTok: number): number {
  const key = Object.keys(PRICES).find(k => model.startsWith(k)) ?? HAIKU;
  const p = PRICES[key];
  return (inTok * p.in + outTok * p.out) / 1e6;
}

let _client: Anthropic | null = null;
const client = () => (_client ??= new Anthropic());

export interface ToolCallResult<T> {
  ok: boolean; data?: T; error?: string;
  model: string; inputTokens: number; outputTokens: number; ms: number; costUsd: number;
  escalated: boolean;
}

/**
 * One strict-tool call: the model is forced to call `emit` whose input must validate
 * against `schema` (additionalProperties:false + required). Retry once carrying the
 * error, then escalate once to Sonnet 5, then fail honestly.
 */
export async function strictCall<T>(opts: {
  system: string;
  content: Anthropic.MessageParam["content"];
  schema: Record<string, any>;
  maxTokens?: number;
  escalate?: boolean;          // allow the Sonnet 5 escalation path (default true)
}): Promise<ToolCallResult<T>> {
  const attempts: { model: string; extra?: string }[] = [
    { model: HAIKU },
    { model: HAIKU, extra: "Your previous output failed schema validation. Emit STRICTLY valid input for the tool." },
  ];
  if (opts.escalate !== false) attempts.push({ model: SONNET });
  let inputTokens = 0, outputTokens = 0, ms = 0, cost = 0, lastErr = "";
  for (let i = 0; i < attempts.length; i++) {
    const { model, extra } = attempts[i];
    const t0 = Date.now();
    try {
      const r = await client().messages.create({
        model,
        max_tokens: opts.maxTokens ?? 8192,
        system: opts.system + (extra ? `\n\n${extra}\nLast error: ${lastErr.slice(0, 300)}` : ""),
        messages: [{ role: "user", content: opts.content }],
        tools: [{ name: "emit", description: "Emit the extraction result.", input_schema: opts.schema as any, strict: true } as any],
        tool_choice: { type: "tool", name: "emit" },
      });
      ms += Date.now() - t0;
      inputTokens += r.usage.input_tokens; outputTokens += r.usage.output_tokens;
      cost += costUSD(model, r.usage.input_tokens, r.usage.output_tokens);
      const tu = r.content.find(c => c.type === "tool_use") as any;
      if (!tu) { lastErr = "no tool_use block"; continue; }
      return { ok: true, data: tu.input as T, model, inputTokens, outputTokens, ms, costUsd: cost, escalated: model === SONNET };
    } catch (e: any) {
      ms += Date.now() - t0;
      lastErr = String(e?.message ?? e);
      if (e?.status === 429 || e?.status >= 500) await new Promise(res => setTimeout(res, 1500));
    }
  }
  return { ok: false, error: lastErr, model: "", inputTokens, outputTokens, ms, costUsd: cost, escalated: false };
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY!;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 90) {
    const batch = texts.slice(i, i + 90);
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${key}`,
      {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requests: batch.map(t => ({
            model: "models/gemini-embedding-001",
            content: { parts: [{ text: t.slice(0, 8000) }] },
            outputDimensionality: 768,
          })),
        }),
      },
    );
    if (!r.ok) throw new Error(`embed ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    for (const e of j.embeddings) out.push(normalize(e.values));
  }
  return out;
}
// gemini truncated-dim embeddings are not pre-normalized; normalize so cosine works via inner product
function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map(x => x / n);
}
