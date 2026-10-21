import type { Db, Tx } from "@erp/db";
import { withTenant } from "@erp/db";

export interface EnqueueOptions {
  organizationId: string | null;
  jobType: string;
  payload?: Record<string, unknown>;
  scheduledFor?: Date;
  // Mesma chave + mesmo tipo = mesmo job. Uma segunda tentativa de agendar é ignorada.
  idempotencyKey?: string;
  maxAttempts?: number;
}

// Agenda um job. Deve ser chamado dentro da transação da operação que o
// originou, para que o job só exista se a operação for confirmada.
export async function enqueueJob(tx: Tx, opts: EnqueueOptions): Promise<{ id: string; created: boolean }> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO erp.scheduled_jobs (organization_id, job_type, payload, scheduled_for, idempotency_key, max_attempts)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (job_type, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      opts.organizationId,
      opts.jobType,
      JSON.stringify(opts.payload ?? {}),
      opts.scheduledFor ?? new Date(),
      opts.idempotencyKey ?? null,
      opts.maxAttempts ?? 8,
    ],
  );
  if (rows[0]) {
    await tx.query("SELECT pg_notify('erp_jobs', $1)", [rows[0].id]);
    return { id: rows[0].id, created: true };
  }
  const existing = await tx.query<{ id: string }>(
    "SELECT id FROM erp.scheduled_jobs WHERE job_type = $1 AND idempotency_key = $2",
    [opts.jobType, opts.idempotencyKey],
  );
  return { id: existing.rows[0]!.id, created: false };
}

export interface Job {
  id: string;
  organizationId: string | null;
  jobType: string;
  payload: Record<string, unknown>;
  scheduledFor: Date;
  attempts: number;
  maxAttempts: number;
}

export interface JobContext {
  tx: Tx;
  db: Db;
  job: Job;
}

export interface JobHandler {
  type: string;
  run(ctx: JobContext): Promise<unknown>;
}

// Erro que não adianta repetir (dados inválidos, destino revogado).
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

export class JobRegistry {
  private handlers = new Map<string, JobHandler>();

  register(handler: JobHandler): void {
    if (this.handlers.has(handler.type)) throw new Error(`Handler duplicado: ${handler.type}`);
    this.handlers.set(handler.type, handler);
  }

  get(type: string): JobHandler | undefined {
    return this.handlers.get(type);
  }
}

function retryDelaySeconds(attempts: number): number {
  return Math.min(6 * 3600, 15 * 2 ** Math.max(0, attempts - 1));
}

// Reivindica e executa os jobs vencidos. O handler roda em transação com o RLS
// da organização do job; o resultado é gravado na mesma transação.
export async function processJobsBatch(
  db: Db,
  registry: JobRegistry,
  opts: { workerId: string; limit?: number; lockSeconds?: number },
) {
  const claimed = await db.query<{ id: string; organization_id: string | null }>(
    "SELECT id, organization_id FROM erp.claim_scheduled_jobs($1, $2, $3)",
    [opts.workerId, opts.limit ?? 20, opts.lockSeconds ?? 300],
  );
  let succeeded = 0;
  let failed = 0;
  for (const row of claimed.rows) {
    const ctx = { organizationId: row.organization_id, userId: null };
    let job: Job | null = null;
    try {
      await withTenant(db, ctx, async (tx) => {
        const r = await tx.query(
          `SELECT id, organization_id, job_type, payload, scheduled_for, attempts, max_attempts
             FROM erp.scheduled_jobs WHERE id = $1 AND status = 'running' AND locked_by = $2`,
          [row.id, opts.workerId],
        );
        const j = r.rows[0];
        if (!j) return;
        job = {
          id: j.id,
          organizationId: j.organization_id,
          jobType: j.job_type,
          payload: j.payload,
          scheduledFor: j.scheduled_for,
          attempts: j.attempts,
          maxAttempts: j.max_attempts,
        };
        const handler = registry.get(job.jobType);
        if (!handler) throw new PermanentJobError(`Nenhum handler registrado para ${job.jobType}`);
        const result = await handler.run({ tx, db, job });
        await tx.query(
          `UPDATE erp.scheduled_jobs
              SET status = 'succeeded', finished_at = now(), locked_until = NULL, last_error = NULL, result = $2
            WHERE id = $1`,
          [job.id, result === undefined ? null : JSON.stringify(result)],
        );
      });
      if (job) succeeded++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      const permanent = err instanceof PermanentJobError;
      await withTenant(db, ctx, (tx) =>
        tx.query(
          `UPDATE erp.scheduled_jobs
              SET status = CASE WHEN $2 OR attempts >= max_attempts THEN 'dead' ELSE 'failed' END,
                  scheduled_for = now() + make_interval(secs => $3),
                  locked_until = NULL,
                  finished_at = now(),
                  last_error = $4
            WHERE id = $1`,
          [row.id, permanent, retryDelaySeconds((job as Job | null)?.attempts ?? 1), message.slice(0, 2000)],
        ),
      );
    }
  }
  return { claimed: claimed.rowCount ?? 0, succeeded, failed };
}
