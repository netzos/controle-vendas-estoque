import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { changeSaleDate, createProduct, createSale, getSale, listSales, listUnits, runService, type Actor } from "../src/index.ts";
import { actorFor, addUserWithRole, seedCompany, setupTestDb, type TestDb } from "./helpers.ts";

// Melhoria 27: trocar o dia de uma venda já registrada.
let t: TestDb;
let owner: Actor;
let lata: string;

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "Fazenda");
  owner = await actorFor(t.app, a.userId, a.organizationId);
  const un = (await runService(t.app, listUnits, owner, {})).find((u) => u.code === "UN")!.id;
  lata = (await runService(t.app, createProduct, owner, {
    sku: "LATA", name: "Lata de açaí", unitId: un, salePrice: "50", costPrice: "20", minStock: "0", initialStock: "50",
  })).id;
});
after(() => t.close());

const day = (offset: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() + offset * 86400000));
const dayOf = (d: Date | string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(d));

describe("trocar o dia da venda", () => {
  it("muda o dia, mantém número e valores, não mexe nos pagamentos e registra quem trocou", async () => {
    const v = await runService(t.app, createSale, owner, { paymentMethod: "pix", items: [{ productId: lata, quantity: "8" }] });
    const antes = await runService(t.app, getSale, owner, { id: v.id });
    const r = await runService(t.app, changeSaleDate, owner, { id: v.id, soldOn: day(-3), confirmNumber: v.number, reason: "lancei hoje, foi dia 22" });
    assert.equal(r.number, v.number);
    const depois = await runService(t.app, getSale, owner, { id: v.id });
    assert.equal(dayOf(depois.soldAt), day(-3));
    assert.equal(depois.total, antes.total);
    assert.equal(depois.paidTotal, antes.paidTotal);
    assert.deepEqual((await runService(t.app, listSales, owner, { from: day(-3), to: day(-3) })).map((x) => x.number), [v.number]);
    const log = await t.owner.query<{ summary: string; actor: string }>(
      "SELECT summary, actor_user_id AS actor FROM controle_vendas_estoque.audit_logs WHERE action = 'sale.change_date' AND entity_id = $1",
      [v.id],
    );
    assert.equal(log.rows.length, 1);
    assert.equal(log.rows[0]!.actor, owner.userId);
    assert.match(log.rows[0]!.summary, /lancei hoje/);

    // Voltar para o dia do lançamento devolve a hora real.
    await runService(t.app, changeSaleDate, owner, { id: v.id, soldOn: day(0), confirmNumber: v.number, reason: "voltei o dia" });
    const volta = await runService(t.app, getSale, owner, { id: v.id });
    assert.ok(Date.now() - new Date(volta.soldAt).getTime() < 120_000);
  });

  it("recusa futuro, número errado, sem motivo e quem não pode cancelar venda", async () => {
    const v = await runService(t.app, createSale, owner, { paymentMethod: "pix", items: [{ productId: lata, quantity: "1" }] });
    await assert.rejects(runService(t.app, changeSaleDate, owner, { id: v.id, soldOn: day(2), confirmNumber: v.number, reason: "teste de futuro" }), /futuro/);
    await assert.rejects(runService(t.app, changeSaleDate, owner, { id: v.id, soldOn: day(-1), confirmNumber: v.number + 1, reason: "número errado" }), /número/);
    await assert.rejects(runService(t.app, changeSaleDate, owner, { id: v.id, soldOn: day(-1), confirmNumber: v.number, reason: "" }));
    const seller = await addUserWithRole(t.app, owner, "sales", "Vendedor");
    await assert.rejects(runService(t.app, changeSaleDate, seller.actor, { id: v.id, soldOn: day(-1), confirmNumber: v.number, reason: "sem permissão" }));
    const s = await runService(t.app, getSale, owner, { id: v.id });
    assert.equal(dayOf(s.soldAt), day(0));
  });
});
