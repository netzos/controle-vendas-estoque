import type { Db, Tx } from "@erp/db";
import { withTenant } from "@erp/db";
import type { DomainEvents, EventType } from "./events.ts";

export interface OutboxEvent<T extends EventType = EventType> {
  id: string;
  organizationId: string;
  eventType: T;
  aggregateType: string | null;
  aggregateId: string | null;
  payload: DomainEvents[T];
  actorUserId: string | null;
  attempts: number;
  createdAt: Date;
}

// Grava o evento na mesma transação do dado. O NOTIFY só é entregue no commit,
// então o worker nunca acorda para um evento que foi revertido.
export async function emitEvent<T extends EventType>(
  tx: Tx,
  organizationId: string,
  event: { type: T; payload: DomainEvents[T]; aggregateType?: string; aggregateId?: string; actorUserId?: string | null },
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO erp.outbox_events (organization_id, event_type, aggregate_type, aggregate_id, payload, actor_user_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      organizationId,
      event.type,
      event.aggregateType ?? null,
      event.aggregateId ?? null,
      JSON.stringify(event.payload),
      event.actorUserId ?? null,
    ],
  );
  await tx.query("SELECT pg_notify('erp_outbox', $1)", [rows[0]!.id]);
  return rows[0]!.id;
}

export interface EventConsumer<T extends EventType = EventType> {
  // Nome estável: identifica o consumidor em outbox_consumptions.
  name: string;
  events: readonly T[];
  handle(tx: Tx, event: OutboxEvent<T>): Promise<void>;
}

export class EventBus {
  private consumers: EventConsumer[] = [];

  subscribe<T extends EventType>(consumer: EventConsumer<T>): void {
    if (this.consumers.some((c) => c.name === consumer.name)) {
      throw new Error(`Consumidor duplicado: ${consumer.name}`);
    }
    this.consumers.push(consumer as unknown as EventConsumer);
  }

  consumersFor(type: string): EventConsumer[] {
    return this.consumers.filter((c) => (c.events as readonly string[]).includes(type));
  }
}

const MAX_EVENT_ATTEMPTS = 10;

function backoffSeconds(attempts: number): number {
  return Math.min(3600, 5 * 2 ** Math.max(0, attempts - 1));
}

// Processa um lote de eventos. Cada consumidor roda em transação própria e
// registra o consumo nela, então uma falha em um consumidor não repete os
// efeitos dos outros quando o evento volta para a fila.
export async function processOutboxBatch(db: Db, bus: EventBus, opts: { limit?: number; lockSeconds?: number } = {}) {
  const claimed = await db.query<{ id: string; organization_id: string }>(
    "SELECT id, organization_id FROM erp.claim_outbox_events($1, $2)",
    [opts.limit ?? 50, opts.lockSeconds ?? 60],
  );
  let done = 0;
  let failed = 0;
  for (const row of claimed.rows) {
    const ctx = { organizationId: row.organization_id, userId: null };
    const event = await withTenant(db, ctx, async (tx) => {
      const r = await tx.query(
        `SELECT id, organization_id, event_type, aggregate_type, aggregate_id, payload, actor_user_id, attempts, created_at
           FROM erp.outbox_events WHERE id = $1`,
        [row.id],
      );
      const e = r.rows[0];
      return e
        ? ({
            id: e.id,
            organizationId: e.organization_id,
            eventType: e.event_type,
            aggregateType: e.aggregate_type,
            aggregateId: e.aggregate_id,
            payload: e.payload,
            actorUserId: e.actor_user_id,
            attempts: e.attempts,
            createdAt: e.created_at,
          } as OutboxEvent)
        : null;
    });
    if (!event) continue;
    try {
      for (const consumer of bus.consumersFor(event.eventType)) {
        await withTenant(db, ctx, async (tx) => {
          const mark = await tx.query(
            `INSERT INTO erp.outbox_consumptions (event_id, consumer, organization_id)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING event_id`,
            [event.id, consumer.name, event.organizationId],
          );
          if (mark.rowCount === 0) return; // já consumido em tentativa anterior
          await consumer.handle(tx, event);
        });
      }
      await withTenant(db, ctx, (tx) =>
        tx.query(
          "UPDATE erp.outbox_events SET status = 'done', processed_at = now(), locked_until = NULL, last_error = NULL WHERE id = $1",
          [event.id],
        ),
      );
      done++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      await withTenant(db, ctx, (tx) =>
        tx.query(
          `UPDATE erp.outbox_events
              SET status = CASE WHEN attempts >= $2 THEN 'dead' ELSE 'pending' END,
                  available_at = now() + make_interval(secs => $3),
                  locked_until = NULL,
                  last_error = $4
            WHERE id = $1`,
          [event.id, MAX_EVENT_ATTEMPTS, backoffSeconds(event.attempts), message.slice(0, 2000)],
        ),
      );
    }
  }
  return { claimed: claimed.rowCount ?? 0, done, failed };
}
