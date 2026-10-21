import { createHash } from "node:crypto";
import type { Db, Tx } from "@erp/db";
import { withTenant } from "@erp/db";
import type { z } from "zod";
import { auditFor, recordAudit, type AuditEntry } from "./audit.ts";
import { can, type Actor } from "./context.ts";
import { AppError, forbidden, fromPgError, parseInput } from "./errors.ts";
import type { DomainEvents, EventType } from "./events.ts";
import { enqueueJob, type EnqueueOptions } from "./jobs.ts";
import { emitEvent } from "./outbox.ts";
import type { Permission } from "./permissions.ts";

export type RiskLevel = 1 | 2 | 3 | 4;

export interface ServiceContext {
  tx: Tx;
  actor: Actor;
  audit(entry: AuditEntry): Promise<string>;
  emit<T extends EventType>(type: T, payload: DomainEvents[T], aggregate?: { type: string; id: string }): Promise<string>;
  enqueue(opts: Omit<EnqueueOptions, "organizationId">): Promise<{ id: string; created: boolean }>;
}

// Uma operação de negócio. É a única implementação, usada pelo painel web,
// pela IA do Telegram, pela API e por integrações futuras (seção 23).
export interface ServiceDefinition<S extends z.ZodType, O> {
  name: string;
  description: string;
  // null: qualquer membro ativo da organização.
  permission: Permission | null;
  risk: RiskLevel;
  input: S;
  handler(ctx: ServiceContext, input: z.output<S>): Promise<O>;
}

export function defineService<S extends z.ZodType, O>(def: ServiceDefinition<S, O>): ServiceDefinition<S, O> {
  return def;
}

export interface RunOptions {
  // Chave de idempotência da operação. Reexecutar com a mesma chave devolve o
  // resultado original sem repetir efeitos.
  idempotencyKey?: string;
}

function hashInput(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input ?? null)).digest("hex");
}

export async function runService<S extends z.ZodType, O>(
  db: Db,
  service: ServiceDefinition<S, O>,
  actor: Actor,
  rawInput: z.input<S>,
  opts: RunOptions = {},
): Promise<O> {
  if (service.permission && !can(actor, service.permission)) throw forbidden();

  const input = parseInput(service.input, rawInput);

  try {
    return await withTenant(db, { organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
      if (opts.idempotencyKey) {
        const requestHash = hashInput(input);
        const inserted = await tx.query(
          `INSERT INTO erp.idempotency_keys (organization_id, scope, key, request_hash)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING key`,
          [actor.organizationId, service.name, opts.idempotencyKey, requestHash],
        );
        if (inserted.rowCount === 0) {
          // Outra execução com a mesma chave já foi confirmada (a inserção
          // acima espera a transação concorrente terminar).
          const prev = await tx.query<{ request_hash: string; response: { value: O } | null }>(
            "SELECT request_hash, response FROM erp.idempotency_keys WHERE organization_id = $1 AND scope = $2 AND key = $3",
            [actor.organizationId, service.name, opts.idempotencyKey],
          );
          const row = prev.rows[0]!;
          if (row.request_hash !== requestHash) {
            throw new AppError("conflict", "Esta chave de operação já foi usada com outros dados.");
          }
          return row.response!.value;
        }
      }

      const ctx: ServiceContext = {
        tx,
        actor,
        audit: (entry) => recordAudit(tx, auditFor(actor), entry),
        emit: (type, payload, aggregate) =>
          emitEvent(tx, actor.organizationId, {
            type,
            payload,
            aggregateType: aggregate?.type,
            aggregateId: aggregate?.id,
            actorUserId: actor.userId,
          }),
        enqueue: (job) => enqueueJob(tx, { ...job, organizationId: actor.organizationId }),
      };
      const result = await service.handler(ctx, input);

      if (opts.idempotencyKey) {
        await tx.query(
          "UPDATE erp.idempotency_keys SET response = $4 WHERE organization_id = $1 AND scope = $2 AND key = $3",
          [actor.organizationId, service.name, opts.idempotencyKey, JSON.stringify({ value: result ?? null })],
        );
      }
      return result;
    });
  } catch (err) {
    throw fromPgError(err);
  }
}
