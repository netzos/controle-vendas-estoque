import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  AppError,
  createProduct,
  createSale,
  getSale,
  listUnits,
  receiveSalePayment,
  runService,
  stockOverview,
  updateSale,
  type Actor,
} from "../src/index.ts";
import { actorFor, seedCompany, setupTestDb, type TestDb } from "./helpers.ts";

const rejectsWith = (code: string) => (err: unknown) => {
  assert.ok(err instanceof AppError, `esperava AppError, veio ${String(err)}`);
  assert.equal(err.code, code, err.message);
  return true;
};

let t: TestDb;
let owner: Actor;
let other: Actor;
let lata: string;
let copo: string;

const stockOf = async (id: string) => Number((await runService(t.app, stockOverview, owner, {})).rows.find((r) => r.id === id)!.stockQty);

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "Fazenda");
  owner = await actorFor(t.app, a.userId, a.organizationId);
  const b = await seedCompany(t.app, "Outra");
  other = await actorFor(t.app, b.userId, b.organizationId);
  const un = (await runService(t.app, listUnits, owner, {})).find((u) => u.code === "UN")!.id;
  lata = (await runService(t.app, createProduct, owner, { unitId: un, minStock: "0", sku: "LATA", name: "Lata de açaí", salePrice: "50", costPrice: "20", initialStock: "20" })).id;
  copo = (await runService(t.app, createProduct, owner, { unitId: un, minStock: "0", sku: "COPO", name: "Copo", salePrice: "2", costPrice: "1", initialStock: "10" })).id;
});
after(() => t.close());

describe("corrigir uma venda (melhoria 17)", () => {
  it("12 latas viram 14: mesmo número, estoque baixa só a diferença, total recalculado", async () => {
    const s = await runService(t.app, createSale, owner, { paymentLater: true, items: [{ productId: lata, quantity: "12" }] });
    assert.equal(await stockOf(lata), 8);
    const r = await runService(t.app, updateSale, owner, { id: s.id, items: [{ productId: lata, quantity: "14" }], reason: "Cliente quis mais duas" });
    assert.equal(r.number, s.number);
    assert.equal(Number(r.total), 700);
    assert.equal(await stockOf(lata), 6);
    const sale = await runService(t.app, getSale, owner, { id: s.id });
    assert.equal(sale.items.length, 1);
    assert.equal(Number(sale.items[0]!.quantity), 14);
    assert.equal(sale.paymentStatus, "pending");
  });

  it("tirar um item devolve ao estoque; trocar preço recalcula", async () => {
    const s = await runService(t.app, createSale, owner, { paymentLater: true, items: [{ productId: lata, quantity: "1" }, { productId: copo, quantity: "3" }] });
    assert.equal(await stockOf(copo), 7);
    const r = await runService(t.app, updateSale, owner, { id: s.id, items: [{ productId: lata, quantity: "1", unitPrice: "45" }] });
    assert.equal(Number(r.total), 45);
    assert.equal(await stockOf(copo), 10);
  });

  it("parte já recebida: total não pode ficar menor; venda paga não troca itens", async () => {
    const s = await runService(t.app, createSale, owner, { payments: [{ method: "pix", amount: "60" }], items: [{ productId: lata, quantity: "2" }] });
    await assert.rejects(runService(t.app, updateSale, owner, { id: s.id, items: [{ productId: lata, quantity: "1" }] }), rejectsWith("invalid_input"));
    const up = await runService(t.app, updateSale, owner, { id: s.id, items: [{ productId: lata, quantity: "3" }] });
    assert.equal(up.paymentStatus, "partial");
    await runService(t.app, receiveSalePayment, owner, { saleId: s.id, method: "cash", amount: up.stillOpen });
    await assert.rejects(runService(t.app, updateSale, owner, { id: s.id, items: [{ productId: lata, quantity: "4" }] }), rejectsWith("conflict"));
    await assert.rejects(runService(t.app, updateSale, other, { id: s.id, items: [{ productId: lata, quantity: "4" }] }), rejectsWith("not_found"));
  });
});
