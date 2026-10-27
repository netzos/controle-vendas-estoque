import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  AppError, cancelSale, createCustomer, createProduct, createSale, dueDates, getSale, listReceivables, listUnits, receiveSalePayment, runService,
  splitCents, type Actor,
} from "../src/index.ts";
import { actorFor, seedCompany, setupTestDb, type TestDb } from "./helpers.ts";

let t: TestDb;
let owner: Actor;
let relogio: string;
let joao: string;

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "Relógios");
  owner = await actorFor(t.app, a.userId, a.organizationId);
  const un = (await runService(t.app, listUnits, owner, {})).find((u) => u.code === "UN")!.id;
  relogio = (await runService(t.app, createProduct, owner, { sku: "R1", name: "Relógio", unitId: un, salePrice: "1000", costPrice: "600", minStock: "0", initialStock: "10" })).id;
  joao = (await runService(t.app, createCustomer, owner, { kind: "person", name: "João" })).id;
});
after(() => t.close());

describe("datas e valores das parcelas", () => {
  it("mês a mês segue o dia da primeira e respeita o fim do mês", () => {
    assert.deepEqual(dueDates("2026-01-31", 3, "monthly"), ["2026-01-31", "2026-02-28", "2026-03-31"]);
    assert.deepEqual(dueDates("2026-11-10", 2, "biweekly"), ["2026-11-10", "2026-11-24"]);
    assert.deepEqual(dueDates("2026-12-28", 2, "weekly"), ["2026-12-28", "2027-01-04"]);
    assert.deepEqual(dueDates("2026-11-10", 5, "single"), ["2026-11-10"]);
  });
  it("divide sem perder centavo", () => {
    assert.deepEqual(splitCents(100000, 3), [33334, 33333, 33333]);
  });
});

describe("venda parcelada e dinheiro na rua", () => {
  it("entrada + 3x por mês, recebe, vence e quita", async () => {
    const sale = await runService(t.app, createSale, owner, {
      customerId: joao,
      items: [{ productId: relogio, quantity: "1" }],
      payments: [{ method: "pix", amount: "100" }],
      installments: { count: 3, interval: "monthly", firstDue: "2020-01-10" },
    });
    assert.equal(sale.paymentStatus, "partial");
    assert.deepEqual(sale.installments.map((i) => [i.dueDate, i.amount]), [["2020-01-10", "300.00"], ["2020-02-10", "300.00"], ["2020-03-10", "300.00"]]);

    let full = await runService(t.app, getSale, owner, { id: sale.id });
    assert.equal(full.downPayment, "100.00");
    assert.equal(full.installmentCount, 3);
    assert.deepEqual(full.installments.map((i) => i.status), ["late", "late", "late"]);

    let r = await runService(t.app, listReceivables, owner, {});
    assert.equal(r.total.amount, "900.00");
    assert.equal(r.late.amount, "900.00");
    assert.equal(r.customers[0]!.name, "João");
    assert.equal(r.customers[0]!.open, "900.00");

    // 450: quita a 1ª e paga metade da 2ª.
    const got = await runService(t.app, receiveSalePayment, owner, { saleId: sale.id, method: "cash", amount: "450" });
    assert.deepEqual(got.installments, [1, 2]);
    full = await runService(t.app, getSale, owner, { id: sale.id });
    assert.deepEqual(full.installments.map((i) => [i.status, i.paidAmount]), [["paid", "300.00"], ["late", "150.00"], ["late", "0.00"]]);

    // Escolhendo a 3ª parcela.
    const third = full.installments[2]!.id;
    await runService(t.app, receiveSalePayment, owner, { saleId: sale.id, method: "pix", amount: "300", installmentId: third });
    full = await runService(t.app, getSale, owner, { id: sale.id });
    assert.deepEqual(full.installments.map((i) => i.status), ["paid", "late", "paid"]);
    await assert.rejects(runService(t.app, receiveSalePayment, owner, { saleId: sale.id, method: "pix", amount: "10", installmentId: third }), AppError);

    await runService(t.app, receiveSalePayment, owner, { saleId: sale.id, method: "pix", amount: "150" });
    full = await runService(t.app, getSale, owner, { id: sale.id });
    assert.equal(full.paymentStatus, "paid");
    r = await runService(t.app, listReceivables, owner, {});
    assert.equal(r.total.amount, "0.00");
  });

  it("sem entrada, data única no futuro: em aberto, não vencida", async () => {
    const sale = await runService(t.app, createSale, owner, {
      customerId: joao,
      items: [{ productId: relogio, quantity: "1" }],
      installments: { count: 1, interval: "single", firstDue: "2099-05-01" },
    });
    assert.equal(sale.paymentStatus, "pending");
    const r = await runService(t.app, listReceivables, owner, { customerId: joao });
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0]!.status, "open");
    assert.equal(r.late.amount, "0.00");
    // Venda cancelada sai do dinheiro na rua.
    await runService(t.app, cancelSale, owner, { id: sale.id, reason: "desistiu" });
    assert.equal((await runService(t.app, listReceivables, owner, {})).total.amount, "0.00");
  });

  it("fiado sem parcelas aparece sem data; entrada que paga tudo é recusada", async () => {
    await runService(t.app, createSale, owner, { items: [{ productId: relogio, quantity: "1" }], payments: [{ method: "cash", amount: "200" }] });
    const r = await runService(t.app, listReceivables, owner, {});
    assert.equal(r.noDate.amount, "800.00");
    assert.equal(r.items[0]!.dueDate, null);
    await assert.rejects(
      runService(t.app, createSale, owner, { items: [{ productId: relogio, quantity: "1" }], installments: { count: 2, interval: "monthly", firstDue: "2099-01-01" } }),
      /escolha o cliente/,
    );
    await assert.rejects(
      runService(t.app, createSale, owner, {
        customerId: joao,
        items: [{ productId: relogio, quantity: "1" }],
        payments: [{ method: "pix", amount: "1000" }],
        installments: { count: 2, interval: "monthly", firstDue: "2099-01-01" },
      }),
      AppError,
    );
  });
});
