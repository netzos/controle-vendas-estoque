import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { withTenant } from "@erp/db";
import {
  createBranch,
  enqueueJob,
  EventBus,
  JobRegistry,
  PermanentJobError,
  processJobsBatch,
  processOutboxBatch,
  runService,
  type Actor,
} from "../src/index.ts";
import { registerSystemHandlers, scheduleSystemJobs } from "../src/worker.ts";
import { actorFor, seedCompany, setupTestDb, type TestDb } from "./helpers.ts";

let t: TestDb;
let owner: Actor;

before(async () => {
  t = await setupTestDb();
  const c = await seedCompany(t.app, "Empresa Worker", "worker@teste.com");
  owner = await actorFor(t.app, c.userId, c.organizationId);
});
after(() => t.close());

async function drainOutbox(bus: EventBus) {
  // Eventos anteriores ao teste não interessam.
  await processOutboxBatch(t.app, bus, { limit: 1000 });
}

describe("outbox", () => {
  beforeEach(() => drainOutbox(new EventBus()));

  it("entrega cada evento uma vez a cada consumidor", async () => {
    const seen: string[] = [];
    const bus = new EventBus();
    bus.subscribe({
      name: "teste.registro",
      events: ["branch.created"],
      async handle(tx, event) {
        // O consumidor roda com o RLS da organização do evento.
        const r = await tx.query("SELECT name FROM controle_vendas_estoque.branches WHERE id = $1", [event.payload.branchId]);
        seen.push(r.rows[0].name);
      },
    });
    await runService(t.app, createBranch, owner, { name: "Loja Um", code: "L1" });
    const r1 = await processOutboxBatch(t.app, bus);
    assert.equal(r1.done, 1);
    const r2 = await processOutboxBatch(t.app, bus);
    assert.equal(r2.claimed, 0);
    assert.deepEqual(seen, ["Loja Um"]);
  });

  it("consumidor com falha é repetido sem repetir os que já consumiram", async () => {
    let okCalls = 0;
    let failCalls = 0;
    const bus = new EventBus();
    bus.subscribe({ name: "teste.ok", events: ["branch.created"], async handle() { okCalls++; } });
    bus.subscribe({
      name: "teste.instavel",
      events: ["branch.created"],
      async handle() {
        failCalls++;
        if (failCalls === 1) throw new Error("Telegram fora do ar");
      },
    });
    await runService(t.app, createBranch, owner, { name: "Loja Dois", code: "L2" });
    const r1 = await processOutboxBatch(t.app, bus);
    assert.equal(r1.failed, 1);
    // Antecipa a nova tentativa (backoff).
    await t.owner.query("UPDATE controle_vendas_estoque.outbox_events SET available_at = now() WHERE status = 'pending'");
    const r2 = await processOutboxBatch(t.app, bus);
    assert.equal(r2.done, 1);
    assert.equal(okCalls, 1);
    assert.equal(failCalls, 2);
    const ev = await t.owner.query("SELECT status, attempts, last_error FROM controle_vendas_estoque.outbox_events WHERE event_type = 'branch.created' ORDER BY id DESC LIMIT 1");
    assert.equal(ev.rows[0].status, "done");
    assert.equal(ev.rows[0].attempts, 2);
  });
});

describe("jobs agendados", () => {
  it("agendamento com a mesma chave cria um único job", async () => {
    const a = await withTenant(t.app, { organizationId: owner.organizationId, userId: null }, (tx) =>
      enqueueJob(tx, { organizationId: owner.organizationId, jobType: "teste.lembrete", idempotencyKey: "titulo-1:D-3" }),
    );
    const b = await withTenant(t.app, { organizationId: owner.organizationId, userId: null }, (tx) =>
      enqueueJob(tx, { organizationId: owner.organizationId, jobType: "teste.lembrete", idempotencyKey: "titulo-1:D-3" }),
    );
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(a.id, b.id);
  });

  it("executa, repete em falha temporária e encerra em falha permanente", async () => {
    let calls = 0;
    const jobs = new JobRegistry();
    jobs.register({
      type: "teste.lembrete",
      async run({ tx, job }) {
        calls++;
        // Roda no contexto da organização do job.
        const r = await tx.query("SELECT count(*)::int AS n FROM controle_vendas_estoque.branches");
        if (calls === 1) throw new Error("timeout");
        return { branches: r.rows[0].n, key: job.payload };
      },
    });
    jobs.register({ type: "teste.invalido", async run() { throw new PermanentJobError("destino revogado"); } });

    await withTenant(t.app, { organizationId: owner.organizationId, userId: null }, (tx) =>
      enqueueJob(tx, { organizationId: owner.organizationId, jobType: "teste.invalido" }),
    );
    const r1 = await processJobsBatch(t.app, jobs, { workerId: "w1" });
    assert.equal(r1.failed, 2);
    await t.owner.query("UPDATE controle_vendas_estoque.scheduled_jobs SET scheduled_for = now() WHERE status = 'failed'");
    const r2 = await processJobsBatch(t.app, jobs, { workerId: "w1" });
    assert.equal(r2.succeeded, 1);
    const rows = await t.owner.query("SELECT job_type, status, attempts, result FROM controle_vendas_estoque.scheduled_jobs WHERE job_type LIKE 'teste.%' ORDER BY job_type");
    assert.deepEqual(rows.rows.map((r) => [r.job_type, r.status, r.attempts]), [
      ["teste.invalido", "dead", 1],
      ["teste.lembrete", "succeeded", 2],
    ]);
    assert.ok(rows.rows[1].result.branches >= 1);
  });

  it("dois workers simultâneos não executam o mesmo job", async () => {
    let calls = 0;
    const jobs = new JobRegistry();
    jobs.register({
      type: "teste.concorrente",
      async run() {
        calls++;
        await new Promise((r) => setTimeout(r, 50));
      },
    });
    await withTenant(t.app, { organizationId: owner.organizationId, userId: null }, async (tx) => {
      for (let i = 0; i < 10; i++) await enqueueJob(tx, { organizationId: owner.organizationId, jobType: "teste.concorrente" });
    });
    const [a, b] = await Promise.all([
      processJobsBatch(t.app, jobs, { workerId: "w1", limit: 10 }),
      processJobsBatch(t.app, jobs, { workerId: "w2", limit: 10 }),
    ]);
    assert.equal(a.succeeded + b.succeeded, 10);
    assert.equal(calls, 10);
  });

  it("job reivindicado por worker que morreu volta para a fila", async () => {
    const jobs = new JobRegistry();
    let calls = 0;
    jobs.register({ type: "teste.orfao", async run() { calls++; } });
    await withTenant(t.app, { organizationId: owner.organizationId, userId: null }, (tx) =>
      enqueueJob(tx, { organizationId: owner.organizationId, jobType: "teste.orfao" }),
    );
    // Worker "morto": reivindica e nunca conclui.
    await t.app.query("SELECT * FROM controle_vendas_estoque.claim_scheduled_jobs('morto', 10, 300)");
    const stuck = await processJobsBatch(t.app, jobs, { workerId: "w3" });
    assert.equal(stuck.claimed, 0);
    await t.owner.query("UPDATE controle_vendas_estoque.scheduled_jobs SET locked_until = now() - interval '1 second' WHERE locked_by = 'morto'");
    const r = await processJobsBatch(t.app, jobs, { workerId: "w3" });
    assert.equal(r.succeeded, 1);
    assert.equal(calls, 1);
  });

  it("limpeza de sistema roda sem organização e é agendada uma vez por hora", async () => {
    const jobs = new JobRegistry();
    registerSystemHandlers(jobs);
    const now = new Date("2026-10-21T10:15:00Z");
    await scheduleSystemJobs(t.app, now);
    await scheduleSystemJobs(t.app, now);
    const sys = await t.owner.query("SELECT id FROM controle_vendas_estoque.scheduled_jobs WHERE job_type = 'system.purge_expired'");
    assert.equal(sys.rowCount, 1);
    await t.owner.query("UPDATE controle_vendas_estoque.scheduled_jobs SET scheduled_for = now() WHERE job_type = 'system.purge_expired'");
    const r = await processJobsBatch(t.app, jobs, { workerId: "w4" });
    assert.equal(r.succeeded, 1);
    // Jobs de sistema não aparecem no contexto de uma organização.
    const visible = await withTenant(t.app, { organizationId: owner.organizationId, userId: null }, (tx) =>
      tx.query("SELECT 1 FROM controle_vendas_estoque.scheduled_jobs WHERE job_type = 'system.purge_expired'"),
    );
    assert.equal(visible.rowCount, 0);
  });
});
