import type { Db } from "@erp/db";
import { withTenant } from "@erp/db";

// Custo de uso: cada chamada paga que o sistema faz por uma empresa fica em
// platform_usage, com o valor calculado na hora (em dólar), para a Plataforma
// mostrar quanto cada empresa custa. Preços por milhão de tokens (IA) e por
// minuto (transcrição); modelo desconhecido entra com custo zero.
const AI_PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

const TRANSCRIPTION_PER_MINUTE: Record<string, number> = {
  "gpt-4o-mini-transcribe": 0.003,
  "gpt-4o-transcribe": 0.006,
  "whisper-1": 0.006,
  "whisper-large-v3-turbo": 0.04 / 60,
  "whisper-large-v3": 0.111 / 60,
};

export interface AiUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Soma o uso de várias respostas do modelo (um turno da Netz pode ter vários passos). */
export function addAiUsage(total: Required<{ [K in keyof AiUsage]: number }>, u: AiUsage | null | undefined) {
  if (!u) return total;
  total.input_tokens += u.input_tokens ?? 0;
  total.output_tokens += u.output_tokens ?? 0;
  total.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;
  total.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;
  return total;
}

export function emptyAiUsage() {
  return { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
}

export function aiCostUsd(model: string, u: AiUsage): number {
  const p = AI_PRICES[model] ?? AI_PRICES[model.replace(/-\d{8}$/, "")];
  if (!p) return 0;
  return (
    ((u.input_tokens ?? 0) * p.input +
      (u.output_tokens ?? 0) * p.output +
      (u.cache_read_input_tokens ?? 0) * p.cacheRead +
      (u.cache_creation_input_tokens ?? 0) * p.cacheWrite) /
    1_000_000
  );
}

export function transcriptionCostUsd(model: string, seconds: number): number {
  return ((TRANSCRIPTION_PER_MINUTE[model] ?? 0) * seconds) / 60;
}

export type UsageFeature = "netz" | "improvements_analysis" | "telegram_audio" | "panel_audio";

/** Grava o uso de IA de uma empresa. Nunca derruba quem chamou. */
export async function recordAiUsage(
  db: Db,
  owner: { organizationId: string; userId: string | null },
  feature: UsageFeature,
  model: string,
  usage: AiUsage | null | undefined,
): Promise<void> {
  const u = usage ?? {};
  await insert(db, owner, {
    kind: "ai", feature, provider: "anthropic", model,
    input: u.input_tokens ?? 0, output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0,
    seconds: 0, cost: aiCostUsd(model, u),
  });
}

/** Grava o uso de transcrição de áudio de uma empresa. Nunca derruba quem chamou. */
export async function recordTranscriptionUsage(
  db: Db,
  owner: { organizationId: string; userId: string | null },
  feature: UsageFeature,
  t: { provider: string; model: string; seconds: number },
): Promise<void> {
  await insert(db, owner, {
    kind: "transcription", feature, provider: t.provider, model: t.model,
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, seconds: t.seconds, cost: transcriptionCostUsd(t.model, t.seconds),
  });
}

async function insert(
  db: Db,
  owner: { organizationId: string; userId: string | null },
  e: { kind: string; feature: string; provider: string; model: string; input: number; output: number; cacheRead: number; cacheWrite: number; seconds: number; cost: number },
) {
  try {
    await withTenant(db, { organizationId: owner.organizationId, userId: owner.userId }, (tx) =>
      tx.query(
        `INSERT INTO controle_vendas_estoque.platform_usage
           (organization_id, user_id, kind, feature, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, seconds, cost_usd)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [owner.organizationId, owner.userId, e.kind, e.feature, e.provider, e.model, e.input, e.output, e.cacheRead, e.cacheWrite,
          Math.round(e.seconds * 10) / 10, e.cost.toFixed(6)],
      ),
    );
  } catch (err) {
    console.error("platform usage", err instanceof Error ? err.message : err);
  }
}
