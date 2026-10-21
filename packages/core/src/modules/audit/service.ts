import { z } from "zod";
import { defineService } from "../../service.ts";

export interface AuditLog {
  id: string;
  createdAt: Date;
  channel: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  summary: string | null;
  actorName: string | null;
  beforeData: unknown;
  afterData: unknown;
}

export const listAuditLogs = defineService({
  name: "audit.list",
  description: "Consulta o histórico de auditoria da empresa",
  permission: "audit.view",
  risk: 1,
  input: z.object({
    action: z.string().trim().max(60).optional(),
    entityType: z.string().trim().max(60).optional(),
    entityId: z.string().trim().max(100).optional(),
    channel: z.enum(["web", "telegram", "api", "system", "whatsapp"]).optional(),
    before: z.coerce.number().int().positive().optional(), // cursor: id
    limit: z.number().int().min(1).max(200).default(50),
  }),
  async handler({ tx }, input) {
    const { rows } = await tx.query<AuditLog>(
      `SELECT a.id, a.created_at AS "createdAt", a.channel, a.action, a.entity_type AS "entityType",
              a.entity_id AS "entityId", a.summary, u.name AS "actorName",
              a.before_data AS "beforeData", a.after_data AS "afterData"
         FROM erp.audit_logs a
         LEFT JOIN erp.users u ON u.id = a.actor_user_id
        WHERE ($1::text IS NULL OR a.action LIKE $1 || '%')
          AND ($2::text IS NULL OR a.entity_type = $2)
          AND ($3::text IS NULL OR a.entity_id = $3)
          AND ($4::text IS NULL OR a.channel = $4)
          AND ($5::bigint IS NULL OR a.id < $5)
        ORDER BY a.id DESC
        LIMIT $6`,
      [input.action ?? null, input.entityType ?? null, input.entityId ?? null, input.channel ?? null, input.before ?? null, input.limit + 1],
    );
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit);
    return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
  },
});
