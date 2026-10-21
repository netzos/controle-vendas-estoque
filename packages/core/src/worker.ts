import type { Db, Tx } from "@erp/db";
import { EventBus, processOutboxBatch } from "./outbox.ts";
import { enqueueJob, JobRegistry, processJobsBatch } from "./jobs.ts";
import { withTransaction } from "@erp/db";

export { EventBus, JobRegistry };

// Jobs de sistema da Fase 1. Os módulos das próximas fases registram os seus
// (lembretes, alertas, envio ao Telegram) com registerModuleHandlers.
export function registerSystemHandlers(jobs: JobRegistry): void {
  jobs.register({
    type: "system.purge_expired",
    async run({ tx }) {
      const { rows } = await tx.query<{ result: unknown }>("SELECT controle_vendas_estoque.purge_expired() AS result");
      return rows[0]!.result;
    },
  });
}

// Agenda a limpeza horária. A chave por hora garante um único job por hora,
// mesmo com vários workers.
export async function scheduleSystemJobs(db: Db, now = new Date()): Promise<void> {
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  await withTransaction(db, (tx) =>
    enqueueJob(tx, {
      organizationId: null,
      jobType: "system.purge_expired",
      scheduledFor: next,
      idempotencyKey: next.toISOString(),
      maxAttempts: 3,
    }),
  );
}

export interface WorkerOptions {
  db: Db;
  bus: EventBus;
  jobs: JobRegistry;
  workerId: string;
  pollIntervalMs?: number;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

// Laço do worker: escuta NOTIFY para reagir rápido e faz polling como garantia.
export function startWorker(opts: WorkerOptions) {
  const log = opts.log ?? ((msg, data) => console.log(JSON.stringify({ at: new Date().toISOString(), msg, ...data })));
  const interval = opts.pollIntervalMs ?? 2000;
  let stopped = false;
  let wake: (() => void) | null = null;
  let listener: Tx | null = null;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(t);
        resolve();
      };
    });

  async function listen() {
    try {
      listener = await opts.db.connect();
      listener.on("notification", () => wake?.());
      await listener.query("LISTEN controle_vendas_estoque_outbox");
      await listener.query("LISTEN controle_vendas_estoque_jobs");
    } catch (err) {
      log("listen_failed", { error: String(err) });
    }
  }

  const loop = (async () => {
    await listen();
    let lastSystemSchedule = 0;
    while (!stopped) {
      try {
        if (Date.now() - lastSystemSchedule > 10 * 60_000) {
          await scheduleSystemJobs(opts.db);
          lastSystemSchedule = Date.now();
        }
        const events = await processOutboxBatch(opts.db, opts.bus);
        const jobs = await processJobsBatch(opts.db, opts.jobs, { workerId: opts.workerId });
        if (events.claimed || jobs.claimed) {
          log("batch", { events, jobs });
          continue; // pode haver mais trabalho
        }
      } catch (err) {
        log("loop_error", { error: err instanceof Error ? err.message : String(err) });
      }
      await sleep(interval);
    }
  })();

  return {
    async stop() {
      stopped = true;
      wake?.();
      await loop;
      if (listener) {
        listener.release();
        listener = null;
      }
    },
  };
}
