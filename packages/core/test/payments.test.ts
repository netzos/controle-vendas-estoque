import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { AppError, createProduct, createSale, getSale, listSales, listUnits, receiveSalePayment, runService, salesDashboard, type Actor } from "../src/index.ts";
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

describe("pagamento dividido e parcial", () => {
  it("forma única continua igual: paga tudo na hora", async () => {
    const sale = await runService(t.app, createSale, owner, { paymentMethod: "pix", items: [{ productId: produto, quantity: "1" }] });
    assert.equal(sale.paymentStatus, "paid");
    const full = await runService(t.app, getSale, owner, { id: sale.id });
    assert.deepEqual(full.payments.map((p) => [p.method, p.amount]), [["pix", "1000.00"]]);
  });

  it("divide em Pix e débito; a forma principal é a de maior valor", async () => {
    const sale = await runService(t.app, createSale, owner, {
      items: [{ productId: produto, quantity: "1" }],
      payments: [{ method: "pix", amount: "300" }, { method: "debit", amount: "700" }],
    });
    const full = await runService(t.app, getSale, owner, { id: sale.id });
    assert.equal(full.paymentStatus, "paid");
    assert.equal(full.paymentMethod, "debit");
    assert.equal(full.paidTotal, "1000.00");
  });

  it("paga uma parte, fica parcial e quita depois", async () => {
    const sale = await runService(t.app, createSale, owner, { items: [{ productId: produto, quantity: "1" }], payments: [{ method: "cash", amount: "400" }] });
    assert.equal(sale.paymentStatus, "partial");
    const open = await runService(t.app, listSales, owner, { openPayment: true });
    assert.deepEqual(open.map((s) => s.id), [sale.id]);
    let dash = await runService(t.app, salesDashboard, owner, { period: "today" });
    assert.equal(Number(dash.receivable.amount), 600);
    await assert.rejects(runService(t.app, receiveSalePayment, owner, { saleId: sale.id, method: "pix", amount: "700" }), AppError);
    const r1 = await runService(t.app, receiveSalePayment, owner, { saleId: sale.id, method: "pix", amount: "100" });
    assert.equal(r1.paymentStatus, "partial");
    assert.equal(r1.stillOpen, "500.00");
    const r2 = await runService(t.app, receiveSalePayment, owner, { saleId: sale.id, method: "credit", amount: "500" });
    assert.equal(r2.paymentStatus, "paid");
    await assert.rejects(runService(t.app, receiveSalePayment, owner, { saleId: sale.id, method: "pix", amount: "1" }), AppError);
    dash = await runService(t.app, salesDashboard, owner, { period: "today" });
    assert.equal(Number(dash.receivable.amount), 0);
    const byMethod = Object.fromEntries(dash.payments.map((p) => [p.method, Number(p.revenue)]));
    assert.equal(byMethod.cash, 400);
    assert.equal(byMethod.credit, 500);
  });

  it("sem nada pago fica a receber; pagar mais que o total é recusado", async () => {
    const sale = await runService(t.app, createSale, owner, { items: [{ productId: produto, quantity: "1" }], payments: [] });
    assert.equal(sale.paymentStatus, "pending");
    await assert.rejects(
      runService(t.app, createSale, owner, { items: [{ productId: produto, quantity: "1" }], payments: [{ method: "pix", amount: "1001" }] }),
      AppError,
    );
    await assert.rejects(runService(t.app, createSale, owner, { items: [{ productId: produto, quantity: "1" }] }), AppError);
  });
});
