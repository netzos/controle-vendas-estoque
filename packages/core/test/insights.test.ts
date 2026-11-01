import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  cancelSale,
  createCustomer,
  createProduct,
  createSale,
  dashboardCustomersPanel,
  dashboardOverview,
  dashboardProductsPanel,
  dashboardSalesPanel,
  listUnits,
  resolveRange,
  runService,
  type Actor,
} from "../src/index.ts";
import { actorFor, seedCompany, setupTestDb, type TestDb } from "./helpers.ts";

let t: TestDb;
let owner: Actor;
let other: Actor;
let tv: string;
let cabo: string;
let parado: string;
let ana: string;

// Move a venda para "N dias atrás", ao meio-dia de São Paulo.
async function daysAgo(saleId: string, n: number, hour = 12) {
  await t.owner.query(
    `UPDATE controle_vendas_estoque.sales
        SET sold_at = (((now() AT TIME ZONE 'America/Sao_Paulo')::date - $2::int) + make_time($3, 0, 0)) AT TIME ZONE 'America/Sao_Paulo'
      WHERE id = $1`,
    [saleId, n, hour],
  );
}

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "Loja Painel");
  owner = await actorFor(t.app, a.userId, a.organizationId);
  const b = await seedCompany(t.app, "Outra");
  other = await actorFor(t.app, b.userId, b.organizationId);
  const un = (await runService(t.app, listUnits, owner, {})).find((u) => u.code === "UN")!.id;
  const product = (sku: string, salePrice: string, costPrice: string) =>
    runService(t.app, createProduct, owner, { sku, name: sku, unitId: un, salePrice, costPrice, minStock: "0", initialStock: "100" }).then((p) => p.id);
  tv = await product("TV", "1000", "600");
  cabo = await product("CABO", "50", "10");
  parado = await product("PARADO", "200", "100");
  ana = (await runService(t.app, createCustomer, owner, { kind: "person", name: "Ana", phone: "11999990000", city: "Belém" })).id;

  // Ana: compra antiga (40 dias) e outra há 3 dias. Consumidor: uma hoje. Uma cancelada.
  const s1 = await runService(t.app, createSale, owner, { customerId: ana, paymentMethod: "pix", items: [{ productId: tv, quantity: "1" }] });
  await daysAgo(s1.id, 40, 10);
  const s2 = await runService(t.app, createSale, owner, { customerId: ana, paymentMethod: "pix", items: [{ productId: tv, quantity: "2" }, { productId: cabo, quantity: "2" }] });
  await daysAgo(s2.id, 3, 15);
  await runService(t.app, createSale, owner, { paymentMethod: "cash", items: [{ productId: cabo, quantity: "1" }] });
  const s4 = await runService(t.app, createSale, owner, { paymentMethod: "cash", items: [{ productId: cabo, quantity: "1" }] });
  await runService(t.app, cancelSale, owner, { id: s4.id, reason: "Desistiu" });
});
after(() => t.close());

describe("painel: períodos", () => {
  it("calcula o período e o anterior de mesmo tamanho", () => {
    assert.deepEqual(resolveRange("2026-11-15", { period: "7d" }), { from: "2026-11-09", to: "2026-11-15", prevFrom: "2026-11-02", prevTo: "2026-11-08", days: 7, tz: "America/Sao_Paulo" });
    const m = resolveRange("2026-03-31", { period: "month" });
    assert.equal(m.from, "2026-03-01");
    assert.equal(m.prevFrom, "2026-02-01");
    assert.equal(m.prevTo, "2026-02-28");
    const lm = resolveRange("2026-11-15", { period: "last_month" });
    assert.deepEqual([lm.from, lm.to, lm.prevFrom, lm.prevTo], ["2026-10-01", "2026-10-31", "2026-09-01", "2026-09-30"]);
    const y = resolveRange("2026-11-15", { period: "year" });
    assert.deepEqual([y.from, y.prevFrom, y.prevTo], ["2026-01-01", "2025-01-01", "2025-11-15"]);
    const c = resolveRange("2026-11-15", { period: "custom", from: "2026-10-10", to: "2026-10-01" });
    assert.deepEqual([c.from, c.to, c.days], ["2026-10-01", "2026-10-10", 10]);
    assert.throws(() => resolveRange("2026-11-15", { period: "custom" }));
  });
});

describe("painel: visão geral", () => {
  it("soma o período, compara e não mistura empresas", async () => {
    const o = await runService(t.app, dashboardOverview, owner, { period: "30d" });
    assert.equal(Number(o.current.revenue), 2150);
    assert.equal(o.current.count, 2);
    assert.equal(Number(o.current.profit), 2150 - 1230);
    assert.equal(o.step, "day");
    assert.equal(o.series.length, 30);
    assert.equal(o.series.reduce((s, p) => s + Number(p.revenue), 0), 2150);
    assert.equal(Number(o.previous.revenue), 1000);
    assert.equal(o.sellers.length, 1);
    const x = await runService(t.app, dashboardOverview, other, { period: "30d" });
    assert.equal(Number(x.current.revenue), 0);
    const today = await runService(t.app, dashboardOverview, owner, { period: "today" });
    assert.equal(today.step, "hour");
    assert.equal(today.series.length, 24);
  });
});

describe("painel: vendas", () => {
  it("mostra dia x hora, melhores dias e cancelamentos", async () => {
    const s = await runService(t.app, dashboardSalesPanel, owner, { period: "30d" });
    assert.equal(s.bestDays[0]!.revenue, "2100.00");
    assert.ok(s.heatmap.some((h) => h.hour === 15 && Number(h.revenue) === 2100));
    assert.equal(s.weekdays.length, 7);
    assert.equal(s.weekdays.reduce((n, w) => n + w.days, 0), 30);
    assert.equal(s.cancellations.count, 1);
    assert.equal(s.cancellations.reasons[0]!.reason, "Desistiu");
    assert.equal(s.sellers[0]!.count, 2);
  });
});

describe("painel: produtos", () => {
  it("ranking, curva ABC e produtos parados", async () => {
    const p = await runService(t.app, dashboardProductsPanel, owner, { period: "30d" });
    assert.equal(p.products[0]!.name, "TV");
    assert.equal(p.products[0]!.abc, "A");
    assert.equal(Number(p.products[0]!.profit), 800);
    assert.equal(p.products.find((x) => x.name === "CABO")!.abc, "B");
    assert.ok(p.stalled.some((x) => x.name === "PARADO" && Number(x.value) === 10000));
    assert.ok(!p.stalled.some((x) => x.name === "TV"));
  });
});

describe("painel: clientes", () => {
  it("separa novos de quem voltou e acha quem sumiu", async () => {
    const c = await runService(t.app, dashboardCustomersPanel, owner, { period: "30d" });
    assert.equal(c.buyers.total, 1);
    assert.equal(c.buyers.returning, 1);
    assert.equal(c.anonymous.count, 1);
    assert.equal(c.top[0]!.name, "Ana");
    assert.equal(c.returnDays, "37");
    assert.equal(c.cities[0]!.city, "Belém");
    const all = await runService(t.app, dashboardCustomersPanel, owner, { period: "year" });
    assert.equal(all.gone.length, 0);
  });
});
