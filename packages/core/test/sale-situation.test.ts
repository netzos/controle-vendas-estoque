import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  completeSaleFollowup,
  createProduct,
  createSale,
  getSale,
  getSaleFollowup,
  listSales,
  listUnits,
  receiveSalePayment,
  runService,
  setHandoverDate,
  type Actor,
} from "../src/index.ts";
import { actorFor, seedCompany, setupTestDb, type TestDb } from "./helpers.ts";

// Pedido nº 21: entrega e pagamento separados na venda.
let t: TestDb;
let owner: Actor;
let lata: string;

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "Fazenda");
  owner = await actorFor(t.app, a.userId, a.organizationId);
  const un = (await runService(t.app, listUnits, owner, {})).find((u) => u.code === "UN")!.id;
  lata = (await runService(t.app, createProduct, owner, {
    sku: "LATA", name: "Lata de açaí", unitId: un, salePrice: "50", costPrice: "20", minStock: "0", initialStock: "50", afterSaleSteps: ["Separar pedido"],
  })).id;
});
after(() => t.close());

const numbers = async (situation: "delivered_unpaid" | "paid_undelivered") =>
  (await runService(t.app, listSales, owner, { situation })).map((s) => s.number).sort();

describe("entrega e pagamento separados", () => {
  it("filtra entregue sem pagamento e pago sem entrega, e marca como retirada", async () => {
    // Venda 1: paga, ainda não retirada. Venda 2: a receber, já retirada.
    const v1 = await runService(t.app, createSale, owner, { paymentLater: true, items: [{ productId: lata, quantity: "14" }] });
    const v2 = await runService(t.app, createSale, owner, { paymentLater: true, items: [{ productId: lata, quantity: "6" }] });
    await runService(t.app, receiveSalePayment, owner, { saleId: v1.id, amount: "700", method: "pix" });
    assert.equal((await runService(t.app, getSale, owner, { id: v1.id })).followupStatus, "open");

    const r = await runService(t.app, completeSaleFollowup, owner, { saleId: v2.id });
    assert.equal(r.stepsDone, 1);
    const f2 = await runService(t.app, getSaleFollowup, owner, { saleId: v2.id });
    assert.equal(f2!.status, "done");
    const s2 = await runService(t.app, getSale, owner, { id: v2.id });
    assert.equal(s2.followupStatus, "done");
    assert.equal(s2.paymentStatus, "pending"); // o pagamento não muda

    assert.deepEqual(await numbers("paid_undelivered"), [v1.number]);
    assert.deepEqual(await numbers("delivered_unpaid"), [v2.number]);

    await runService(t.app, completeSaleFollowup, owner, { saleId: v1.id });
    assert.deepEqual(await numbers("paid_undelivered"), []);
  });

  it("a data de retirada grava e aparece na venda", async () => {
    const v = await runService(t.app, createSale, owner, { paymentLater: true, handoverDate: "2026-11-03", items: [{ productId: lata, quantity: "1" }] });
    assert.equal((await runService(t.app, getSale, owner, { id: v.id })).handoverDate, "2026-11-03");
    await runService(t.app, setHandoverDate, owner, { id: v.id, handoverDate: "2026-11-04" });
    assert.equal((await runService(t.app, getSale, owner, { id: v.id })).handoverDate, "2026-11-04");
  });
});
