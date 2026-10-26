import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { AppError, commissionPanel, createProduct, createSale, listUnits, recordCommissionPayout, runService, setCommissionRate, type Actor } from "../src/index.ts";
import { actorFor, seedCompany, setupTestDb, type TestDb } from "./helpers.ts";

let t: TestDb;
let owner: Actor;
let produto: string;

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "Loja");
  owner = await actorFor(t.app, a.userId, a.organizationId);
  const un = (await runService(t.app, listUnits, owner, {})).find((u) => u.code === "UN")!.id;
  produto = (await runService(t.app, createProduct, owner, { sku: "TV", name: "TV", unitId: un, salePrice: "1000", costPrice: "600", minStock: "0", initialStock: "10" })).id;
});
after(() => t.close());

describe("comissões", () => {
  it("calcula a comissão pela taxa e desconta os repasses", async () => {
    await runService(t.app, createSale, owner, { paymentMethod: "pix", items: [{ productId: produto, quantity: "2" }] });
    let p = await runService(t.app, commissionPanel, owner, {});
    let me = p.rows.find((r) => r.userId === owner.userId)!;
    assert.equal(me.rate, null);
    assert.equal(me.sales, 1);
    assert.equal(Number(me.commission), 0);

    await runService(t.app, setCommissionRate, owner, { userId: owner.userId, rate: "5" });
    p = await runService(t.app, commissionPanel, owner, {});
    me = p.rows.find((r) => r.userId === owner.userId)!;
    assert.equal(Number(me.commission), 100);
    assert.equal(Number(me.toPay), 100);

    await runService(t.app, recordCommissionPayout, owner, { userId: owner.userId, month: p.month, amount: "40", method: "pix" });
    p = await runService(t.app, commissionPanel, owner, { month: p.month });
    me = p.rows.find((r) => r.userId === owner.userId)!;
    assert.equal(Number(me.paid), 40);
    assert.equal(Number(me.toPay), 60);
    assert.equal(Number(p.totals.toPay), 60);
    assert.equal(p.payouts.length, 1);
  });

  it("recusa taxa fora de 0 a 100 e repasse zerado", async () => {
    await assert.rejects(runService(t.app, setCommissionRate, owner, { userId: owner.userId, rate: "150" }), AppError);
    await assert.rejects(runService(t.app, recordCommissionPayout, owner, { userId: owner.userId, month: "2026-10", amount: "0" }), AppError);
  });

  it("mês sem vendas fica zerado", async () => {
    const p = await runService(t.app, commissionPanel, owner, { month: "2020-01" });
    assert.equal(Number(p.totals.commission), 0);
  });
});
