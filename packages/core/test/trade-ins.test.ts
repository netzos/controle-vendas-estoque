import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  AppError,
  cancelSale,
  createProduct,
  createSale,
  getSale,
  listMovements,
  listProducts,
  listUnits,
  runService,
  salesDashboard,
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
let carro: string;
let usado: string;

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "Revenda de Carros");
  owner = await actorFor(t.app, a.userId, a.organizationId);
  const un = (await runService(t.app, listUnits, owner, {})).find((u) => u.code === "UN")!.id;
  carro = (await runService(t.app, createProduct, owner, { sku: "COROLLA", name: "Corolla 2024", unitId: un, salePrice: "150000", costPrice: "130000", minStock: "0", initialStock: "1" })).id;
  usado = (await runService(t.app, createProduct, owner, { sku: "GOL", name: "Gol 2015", unitId: un, salePrice: "40000", costPrice: "30000", minStock: "0", initialStock: "1" })).id;
});
after(() => t.close());

describe("troca como parte do pagamento", () => {
  it("item novo recebido entra no estoque com o valor da troca como custo", async () => {
    const sale = await runService(t.app, createSale, owner, {
      paymentMethod: "pix",
      items: [{ productId: carro, quantity: "1" }],
      tradeIns: [{ name: "Onix 2019 prata", value: "55.000,00", salePrice: "62000", notes: "placa ABC1D23" }],
    });
    const full = await runService(t.app, getSale, owner, { id: sale.id });
    assert.equal(full.total, "150000.00");
    assert.equal(full.tradeInTotal, "55000.00");
    assert.equal(full.tradeIns.length, 1);
    const onix = (await runService(t.app, listProducts, owner, { search: "Onix" }))[0]!;
    assert.equal(onix.costPrice, "55000.0000");
    assert.equal(onix.salePrice, "62000.00");
    assert.equal(onix.stockQty, "1.000");
    assert.equal(onix.sku, `TROCA-${sale.number}-1`);
    const moves = await runService(t.app, listMovements, owner, { productId: onix.id });
    assert.equal(moves[0]!.kind, "trade_in");

    // No painel, a parte da troca aparece separada do Pix.
    const dash = await runService(t.app, salesDashboard, owner, { period: "today" });
    const byMethod = Object.fromEntries(dash.payments.map((p) => [p.method, p.revenue]));
    assert.equal(Number(byMethod.pix), 95000);
    assert.equal(Number(byMethod.trade_in), 55000);
    assert.equal(dash.current.revenue, "150000.00");
  });

  it("item já cadastrado soma ao estoque e recalcula o custo médio; cancelar desfaz", async () => {
    const sale = await runService(t.app, createSale, owner, {
      paymentMethod: "cash",
      items: [{ productId: carro, quantity: "1" }],
      tradeIns: [{ productId: usado, value: "34000" }],
    });
    let gol = (await runService(t.app, listProducts, owner, { search: "Gol" }))[0]!;
    assert.equal(gol.stockQty, "2.000");
    assert.equal(gol.costPrice, "32000.0000");
    await runService(t.app, cancelSale, owner, { id: sale.id, reason: "desistiu" });
    gol = (await runService(t.app, listProducts, owner, { search: "Gol" }))[0]!;
    assert.equal(gol.stockQty, "1.000");
  });

  it("troca maior que a venda, sem item ou sem permissão é recusada", async () => {
    await assert.rejects(
      runService(t.app, createSale, owner, { paymentMethod: "pix", items: [{ productId: usado, quantity: "1" }], tradeIns: [{ name: "Moto", value: "50000" }] }),
      rejectsWith("invalid_input"),
    );
    await assert.rejects(
      runService(t.app, createSale, owner, { paymentMethod: "pix", items: [{ productId: usado, quantity: "1" }], tradeIns: [{ value: "100" }] }),
      rejectsWith("invalid_input"),
    );
    const seller = await addUserWithRole(t.app, owner, "sales", "Vendedor");
    await assert.rejects(
      runService(t.app, createSale, seller.actor, { paymentMethod: "pix", items: [{ productId: usado, quantity: "1" }], tradeIns: [{ name: "Bike", value: "100" }] }),
      rejectsWith("forbidden"),
    );
  });
});
