import { hostname } from "node:os";
import { createPool } from "@erp/db";
import { EventBus, JobRegistry, registerSystemHandlers, startWorker } from "@erp/core/worker";

// Processo permanente: entrega eventos do outbox e executa jobs agendados.
// Pode rodar em mais de uma instância; a reivindicação usa SKIP LOCKED.
const db = createPool(process.env.DATABASE_URL, Number(process.env.WORKER_DB_POOL ?? 5));
const bus = new EventBus();
const jobs = new JobRegistry();
registerSystemHandlers(jobs);

const worker = startWorker({
  db,
  bus,
  jobs,
  workerId: `${hostname()}:${process.pid}`,
  pollIntervalMs: Number(process.env.WORKER_POLL_MS ?? 2000),
});
console.log(JSON.stringify({ at: new Date().toISOString(), msg: "worker_started" }));

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(JSON.stringify({ at: new Date().toISOString(), msg: "worker_stopping", signal }));
  await worker.stop();
  await db.end();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
