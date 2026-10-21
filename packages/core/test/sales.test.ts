import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  AppError,
  cancelSale,
  createMovement,
  createProduct,
  createSale,
  getSale,
  listMovements,
  listUnits,
  runService,
  salesDashboard,
  stockOverview,
  type Actor,
} from "../src/index.ts";
import { actorFor, addUserWithRole, seedCompany, setupTestDb, type TestDb } from "./helpers.ts";

const rejectsWith = (code: string) => (err: unknown) => {
  assert.ok(err instanceof AppError, `esperava AppError, veio ${String(err)}`);
  assert.equal(err.code, code, err.message);
  return true;
};

let t: TestDb;
let owner: Actor;
let other: Actor;
let acai: string;
let copo: string;
let entrega: string;

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "Açaí do Norte");
  owner = await actorFor(t.app, a.userId, a.organizationId);
  const b = await seedCompany(t.app, "Outra Loja");
  other = await actorFor(t.app, b.userId, b.organizationId);
  const units = await runService(t.app, listUnits, owner, {});
  const un = units.find((u) => u.code === "UN")!.id;
  const base = { unitId: un, minStock: "0", trackStock: true };
  acai = (await runService(t.app, createProduct, owner, { ...base, sku: "ACAI", name: "Açaí 500 ml", salePrice: "18", costPrice: "7,5", minStock: "5", initialStock: "20" })).id;
  copo = (await runService(t.app, createProduct, owner, { ...base, sku: "COPO", name: "Copo", salePrice: "1", costPrice: "0,2", initialStock: "3" })).id;
  entrega = (await runService(t.app, createProduct, owner, { ...base, sku: "ENTREGA", name: "Taxa de entrega", salePrice: "5", costPrice: "0", trackStock: false })).id;
});
after(() => t.close());

describe("vendas e estoque", () => {
  it("cadastro com estoque inicial gera entrada", async () => {
    const moves = await runService(t.app, listMovements, owner, { productId: acai });
    assert.equal(moves.length, 1);
    assert.equal(moves[0]!.kind, "in");
    assert.equal(moves[0]!.balanceAfter, "20.000");
  });

  it("venda baixa o estoque, numera em sequência e serviço não mexe em estoque", async () => {
    const s1 = await runService(t.app, createSale, owner, {
      paymentMethod: "pix",
      items: [{ productId: acai, quantity: "2" }, { productId: copo, quantity: "2" }, { productId: entrega, quantity: "1" }],
    });
    assert.equal(s1.number, 1);
    assert.equal(s1.total, "43.00");
    const s2 = await runService(t.app, createSale, owner, { paymentMethod: "cash", discount: "1,00", items: [{ productId: acai, quantity: "1", unitPrice: "20" }] });
    assert.equal(s2.number, 2);
    assert.equal(s2.total, "19.00");
    const sale = await runService(t.app, getSale, owner, { id: s1.id });
    assert.equal(sale.items.length, 3);
    assert.equal(sale.costTotal, "15.4000");
    const ov = await runService(t.app, stockOverview, owner, {});
    const row = ov.rows.find((r) => r.id === acai)!;
    assert.equal(row.stockQty, "17.000");
    assert.equal(row.soldQty30, "3.000");
    assert.ok(!ov.rows.some((r) => r.id === entrega), "serviço fica fora do estoque");
    // Outra empresa não numera junto.
    const units = await runService(t.app, listUnits, other, {});
    const p = await runService(t.app, createProduct, other, { sku: "X", name: "Xis", unitId: units[0]!.id, salePrice: "1", costPrice: "0", minStock: "0", trackStock: true });
    assert.equal((await runService(t.app, createSale, other, { paymentMethod: "pix", items: [{ productId: p.id, quantity: "1" }] })).number, 1);
  });

  it("não vende produto de outra empresa e recusa desconto maior que a venda", async () => {
    await assert.rejects(runService(t.app, createSale, other, { paymentMethod: "pix", items: [{ productId: acai, quantity: "1" }] }), rejectsWith("invalid_input"));
    await assert.rejects(runService(t.app, createSale, owner, { paymentMethod: "pix", discount: "50", items: [{ productId: copo, quantity: "1" }] }), rejectsWith("invalid_input"));
  });

  it("cancelamento devolve o estoque e não pode repetir", async () => {
    const s = await runService(t.app, createSale, owner, { paymentMethod: "debit", items: [{ productId: copo, quantity: "1" }] });
    let ov = await runService(t.app, stockOverview, owner, {});
    assert.equal(ov.rows.find((r) => r.id === copo)!.stockQty, "0.000");
    assert.equal(ov.rows.find((r) => r.id === copo)!.status, "out");
    await runService(t.app, cancelSale, owner, { id: s.id, reason: "Cliente desistiu" });
    ov = await runService(t.app, stockOverview, owner, {});
    assert.equal(ov.rows.find((r) => r.id === copo)!.stockQty, "1.000");
    await assert.rejects(runService(t.app, cancelSale, owner, { id: s.id, reason: "de novo" }), rejectsWith("conflict"));
  });

  it("entrada recalcula custo médio; ajuste usa o saldo contado", async () => {
    await runService(t.app, createMovement, owner, { productId: acai, kind: "in", quantity: "17", unitCost: "8,50" });
    let row = (await runService(t.app, stockOverview, owner, {})).rows.find((r) => r.id === acai)!;
    assert.equal(row.stockQty, "34.000");
    assert.equal(row.costPrice, "8.0000");
    await runService(t.app, createMovement, owner, { productId: acai, kind: "adjust", quantity: "30" });
    row = (await runService(t.app, stockOverview, owner, {})).rows.find((r) => r.id === acai)!;
    assert.equal(row.stockQty, "30.000");
    await assert.rejects(runService(t.app, createMovement, owner, { productId: entrega, kind: "in", quantity: "1" }), rejectsWith("invalid_input"));
  });

  it("painel de vendas soma só as concluídas e mostra os mais vendidos", async () => {
    const d = await runService(t.app, salesDashboard, owner, { period: "today" });
    assert.equal(d.current.count, 2);
    assert.equal(d.current.revenue, "62.00");
    assert.equal(d.current.ticket, "31.00");
    assert.equal(d.series.length, 24);
    assert.equal(d.topProducts[0]!.name, "Açaí 500 ml");
    assert.equal(d.topProducts[0]!.quantity, "3.000");
    const week = await runService(t.app, salesDashboard, owner, { period: "7d" });
    assert.equal(week.series.length, 7);
    assert.equal(week.current.revenue, "62.00");
  });

  it("vendedor vende mas não cancela nem lança estoque", async () => {
    const seller = await addUserWithRole(t.app, owner, "sales", "Vendedora");
    const s = await runService(t.app, createSale, seller.actor, { paymentMethod: "pix", items: [{ productId: acai, quantity: "1" }] });
    await assert.rejects(runService(t.app, cancelSale, seller.actor, { id: s.id, reason: "teste" }), rejectsWith("forbidden"));
    await assert.rejects(runService(t.app, createMovement, seller.actor, { productId: acai, kind: "in", quantity: "1" }), rejectsWith("forbidden"));
  });
});
