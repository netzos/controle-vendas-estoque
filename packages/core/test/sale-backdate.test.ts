import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createProduct, createSale, getSale, listSales, listUnits, runService, type Actor } from "../src/index.ts";
import { actorFor, seedCompany, setupTestDb, type TestDb } from "./helpers.ts";

// Pedido nº 23: venda com data retroativa.
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

const day = (offset: number) => {
  const d = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
};

describe("venda retroativa", () => {
  it("grava a venda no dia informado e mantém o lançamento de agora", async () => {
    const ontem = day(-2);
    const v = await runService(t.app, createSale, owner, { paymentMethod: "pix", soldOn: ontem, items: [{ productId: lata, quantity: "2" }] });
    const s = await runService(t.app, getSale, owner, { id: v.id });
    assert.equal(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(s.soldAt)), ontem);
    const r = await t.owner.query<{ created: Date; paid: Date }>(
      "SELECT s.created_at AS created, p.paid_at AS paid FROM controle_vendas_estoque.sales s JOIN controle_vendas_estoque.sale_payments p ON p.sale_id = s.id WHERE s.id = $1",
      [v.id],
    );
    assert.ok(Date.now() - r.rows[0]!.created.getTime() < 60_000, "lançamento é agora");
    assert.equal(r.rows[0]!.paid.getTime(), new Date(s.soldAt).getTime(), "pagamento na hora vai junto com a venda");
    assert.deepEqual((await runService(t.app, listSales, owner, { from: ontem, to: ontem })).map((x) => x.number), [v.number]);
  });

  it("hoje vale agora e futuro é recusado", async () => {
    const v = await runService(t.app, createSale, owner, { paymentMethod: "pix", soldOn: day(0), items: [{ productId: lata, quantity: "1" }] });
    const s = await runService(t.app, getSale, owner, { id: v.id });
    assert.ok(Date.now() - new Date(s.soldAt).getTime() < 60_000);
    await assert.rejects(
      runService(t.app, createSale, owner, { paymentMethod: "pix", soldOn: day(2), items: [{ productId: lata, quantity: "1" }] }),
      /futuro/,
    );
  });
});
