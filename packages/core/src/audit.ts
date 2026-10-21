import type { Tx } from "@erp/db";
import type { Actor, Channel } from "./context.ts";

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: string;
  summary?: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

export async function recordAudit(
  tx: Tx,
  who: { organizationId: string; userId: string | null; channel: Channel; requestId?: string },
  entry: AuditEntry,
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO erp.audit_logs
       (organization_id, actor_user_id, channel, action, entity_type, entity_id, summary,
        before_data, after_data, metadata, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      who.organizationId,
      who.userId,
      who.channel,
      entry.action,
      entry.entityType ?? null,
      entry.entityId ?? null,
      entry.summary ?? null,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      JSON.stringify(entry.metadata ?? {}),
      who.requestId ?? null,
    ],
  );
  return rows[0]!.id;
}

export function auditFor(actor: Actor) {
  return { organizationId: actor.organizationId, userId: actor.userId, channel: actor.channel, requestId: actor.requestId };
}
