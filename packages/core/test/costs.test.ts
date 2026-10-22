import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  AppError,
  cancelCost,
  cancelSale,
  costsOverview,
  createCost,
  createCostType,
  createProduct,
  createSale,
  createSaleFollowup,
  createStepType,
  getSale,
  getSaleFollowup,
  listCosts,
  listCostTypes,
  listObtainingCosts,
  listSaleSteps,
  listStepTypes,
  listProducts,
  listUnits,
  runService,
  setCostPart,
  stepCounts,
  updateCostType,
  updateProduct,
  updateSaleStep,
  updateStepType,
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
let lata: string;
let guarda: string;
let ar: string;
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "Fazenda");
  owner = await actorFor(t.app, a.userId, a.organizationId);
  const b = await seedCompany(t.app, "Outra");
  other = await actorFor(t.app, b.userId, b.organizationId);
  const un = (await runService(t.app, listUnits, owner, {})).find((u) => u.code === "UN")!.id;
  lata = (await runService(t.app, createProduct, owner, { sku: "LATA", name: "Lata de açaí", unitId: un, salePrice: "60", costPrice: "0", minStock: "0", itemType: "production", initialStock: "100" })).id;
  guarda = (await runService(t.app, createProduct, owner, { sku: "GR", name: "Guarda-roupa", unitId: un, salePrice: "2000", costPrice: "1200", minStock: "0", itemType: "made_to_order", afterSaleSteps: ["Entrega", "Montagem"] })).id;
  ar = (await runService(t.app, createProduct, owner, { sku: "AR", name: "Ar-condicionado", unitId: un, salePrice: "3000", costPrice: "2000", minStock: "0", initialStock: "5", afterSaleSteps: ["Entrega", "Instalação", "entrega"] })).id;
});
after(() => t.close());

const type = async (name: string) => (await runService(t.app, listCostTypes, owner, {})).find((x) => x.name === name)!;

describe("tipos de custo", () => {
  it("empresa nova já vem com os tipos básicos e pode criar outros", async () => {
    const types = await runService(t.app, listCostTypes, owner, {});
    assert.ok(types.find((x) => x.name === "Entrega"));
    assert.ok(types.find((x) => x.name === "Mão de obra"));
    const maq = await runService(t.app, createCostType, owner, { name: "Aluguel da máquina" });
    await assert.rejects(runService(t.app, createCostType, owner, { name: "aluguel da MÁQUINA" }), rejectsWith("conflict"));
    await assert.rejects(runService(t.app, updateCostType, owner, { id: maq.id, name: "Entrega", status: "active" }), rejectsWith("conflict"));
    await runService(t.app, updateCostType, owner, { id: maq.id, name: "Aluguel de máquina", status: "inactive" });
  });
});

describe("custo de obtenção com histórico", () => {
  it("a soma das partes vira o custo do produto; mudar o valor guarda o anterior", async () => {
    const mao = await type("Mão de obra");
    const comb = await type("Combustível");
    await runService(t.app, setCostPart, owner, { productId: lata, costTypeId: mao.id, amount: "10", validFrom: daysAgo(40), notes: "safra 1" });
    await runService(t.app, setCostPart, owner, { productId: lata, costTypeId: comb.id, amount: "2,50", validFrom: daysAgo(40) });
    let p = (await runService(t.app, listProducts, owner, { search: "Lata" }))[0]!;
    assert.equal(p.costPrice, "12.5000");

    // Venda com o custo antigo fica com o custo antigo.
    const s1 = await runService(t.app, createSale, owner, { paymentMethod: "pix", items: [{ productId: lata, quantity: "10" }] });
    await runService(t.app, setCostPart, owner, { productId: lata, costTypeId: mao.id, amount: "12", notes: "safra 2" });
    p = (await runService(t.app, listProducts, owner, { search: "Lata" }))[0]!;
    assert.equal(p.costPrice, "14.5000");
    assert.equal((await runService(t.app, getSale, owner, { id: s1.id })).costTotal, "125.0000");

    const [oc] = await runService(t.app, listObtainingCosts, owner, { productId: lata });
    assert.equal(oc!.total, "14.5000");
    const maoParts = oc!.parts.filter((x) => x.costTypeId === mao.id);
    assert.deepEqual(maoParts.map((x) => [x.amount, x.current]), [["12.0000", true], ["10.0000", false]]);

    await assert.rejects(
      runService(t.app, setCostPart, owner, { productId: lata, costTypeId: mao.id, amount: "1", validFrom: "2999-01-01" }),
      rejectsWith("invalid_input"),
    );
    assert.equal((await runService(t.app, listObtainingCosts, other, {})).length, 0);
  });
});

describe("depois da venda", () => {
  it("as etapas vêm do cadastro do produto, sem repetir", async () => {
    const p = (await runService(t.app, listProducts, owner, { search: "Ar-cond" }))[0]!;
    assert.deepEqual(p.afterSaleSteps, ["Entrega", "Instalação"]);
    const sale = await runService(t.app, createSale, owner, {
      paymentMethod: "pix",
      items: [{ productId: ar, quantity: "1" }, { productId: guarda, quantity: "1" }],
    });
    const f = await runService(t.app, getSaleFollowup, owner, { saleId: sale.id });
    // Guarda-roupa é só por encomenda: a venda já nasce com a etapa Encomenda.
    assert.deepEqual(f!.steps.map((x) => [x.name, x.status]), [["Encomenda", "pending"], ["Entrega", "pending"], ["Instalação", "pending"], ["Montagem", "pending"]]);
    assert.equal(f!.steps[0]!.notes, "Pedir: 1 × Guarda-roupa");
    // Produto sem etapas: venda sem acompanhamento.
    const plain = await runService(t.app, createSale, owner, { paymentMethod: "pix", items: [{ productId: lata, quantity: "1" }] });
    assert.equal(await runService(t.app, getSaleFollowup, owner, { saleId: plain.id }), null);
    assert.equal((await runService(t.app, getSale, owner, { id: plain.id })).followupStatus, null);
  });

  it("taxa entra no total, custo da etapa vai para Custos, venda termina quando as etapas terminam", async () => {
    const sale = await runService(t.app, createSale, owner, {
      paymentMethod: "credit",
      items: [{ productId: guarda, quantity: "1" }],
      followup: {
        address: "Rua A, 10",
        fee: "80",
        steps: [
          { name: "Entrega", scheduledFor: daysAgo(1), responsible: "Zé do frete", cost: "50" },
          { name: "Montagem", scheduledFor: today, responsible: "João" },
        ],
      },
    });
    assert.equal(sale.total, "2080.00");
    const full = await runService(t.app, getSale, owner, { id: sale.id });
    assert.equal(full.deliveryFee, "80.00");
    assert.equal(full.followupStatus, "open");

    const late = await runService(t.app, listSaleSteps, owner, { filter: "late" });
    const entrega = late.find((x) => x.saleId === sale.id)!;
    assert.equal(entrega.name, "Entrega");
    assert.equal(entrega.cost, "50.00");
    assert.equal(entrega.late, true);
    const counts = await runService(t.app, stepCounts, owner, {});
    assert.equal(counts.late, 1);
    assert.ok(counts.today >= 1);

    // Mudar o custo troca o lançamento em Custos, no tipo com o nome da etapa.
    await runService(t.app, updateSaleStep, owner, { id: entrega.id, status: "in_progress", cost: "65" });
    let costs = await runService(t.app, listCosts, owner, { saleId: sale.id });
    assert.deepEqual(costs.map((c) => [c.amount, c.costTypeName]), [["65.00", "Entrega"]]);
    await assert.rejects(runService(t.app, cancelCost, owner, { id: costs[0]!.id }), rejectsWith("not_found"));

    await runService(t.app, updateSaleStep, owner, { id: entrega.id, status: "done" });
    const montagem = (await runService(t.app, listSaleSteps, owner, { saleId: sale.id })).find((x) => x.name === "Montagem")!;
    await runService(t.app, updateSaleStep, owner, { id: montagem.id, status: "done", cost: "120" });
    assert.equal((await runService(t.app, getSale, owner, { id: sale.id })).followupStatus, "open");
    const encomenda = (await runService(t.app, listSaleSteps, owner, { saleId: sale.id })).find((x) => x.name === "Encomenda")!;
    await runService(t.app, updateSaleStep, owner, { id: encomenda.id, status: "done" });
    // Tipo que não existia é criado na hora.
    costs = await runService(t.app, listCosts, owner, { saleId: sale.id });
    assert.deepEqual(costs.map((c) => c.amount).sort(), ["120.00", "65.00"]);
    assert.equal((await runService(t.app, getSale, owner, { id: sale.id })).followupStatus, "done");
  });

  it("etapas para venda já feita; cancelar a venda cancela o que falta", async () => {
    const sale = await runService(t.app, createSale, owner, { paymentMethod: "pix", items: [{ productId: lata, quantity: "2" }] });
    await assert.rejects(runService(t.app, createSaleFollowup, owner, { saleId: sale.id }), rejectsWith("invalid_input"));
    await runService(t.app, createSaleFollowup, owner, { saleId: sale.id, address: "Av. B, 200", steps: [{ name: "Entrega", scheduledFor: today }] });
    await assert.rejects(
      runService(t.app, createSaleFollowup, owner, { saleId: sale.id, steps: [{ name: "entrega" }] }),
      rejectsWith("conflict"),
    );
    await runService(t.app, createSaleFollowup, owner, { saleId: sale.id, steps: [{ name: "Instalação" }] });
    await runService(t.app, cancelSale, owner, { id: sale.id, reason: "desistiu" });
    const steps = await runService(t.app, listSaleSteps, owner, { saleId: sale.id });
    assert.deepEqual(steps.map((x) => x.status), ["cancelled", "cancelled"]);
    assert.equal((await runService(t.app, listSaleSteps, other, { filter: "all" })).length, 0);
  });

  it("etapas só com permissão; produto aceita mudar as etapas", async () => {
    const fin = await addUserWithRole(t.app, owner, "finance", "Financeiro");
    await assert.rejects(
      runService(t.app, createSale, owner, { paymentMethod: "pix", items: [{ productId: guarda, quantity: "1" }], followup: { fee: "-1" } }),
      rejectsWith("invalid_input"),
    );
    const st = (await runService(t.app, listSaleSteps, owner, { filter: "all" }))[0]!;
    await assert.rejects(runService(t.app, updateSaleStep, fin.actor, { id: st.id, status: "pending" }), rejectsWith("forbidden"));

    const p = (await runService(t.app, listProducts, owner, { search: "Ar-cond" }))[0]!;
    await runService(t.app, updateProduct, owner, { ...p, afterSaleSteps: ["Instalação"] });
    assert.deepEqual((await runService(t.app, listProducts, owner, { search: "Ar-cond" }))[0]!.afterSaleSteps, ["Instalação"]);
  });
});

describe("custos e lucro real", () => {
  it("lucro real = faturamento − custo dos produtos − custos lançados", async () => {
    const outros = await type("Embalagem");
    const c = await runService(t.app, createCost, owner, { costTypeId: outros.id, amount: "30", description: "sacolas", productId: lata });
    await assert.rejects(runService(t.app, createCost, owner, { costTypeId: outros.id, amount: "0" }), rejectsWith("invalid_input"));
    await assert.rejects(runService(t.app, createCost, owner, { costTypeId: outros.id, amount: "5", incurredOn: "2999-01-01" }), rejectsWith("invalid_input"));

    const o = await runService(t.app, costsOverview, owner, { period: "30d" });
    const real = Number(o.revenue) - Number(o.productCost) - Number(o.costs);
    assert.equal(Number(o.realProfit), Number(real.toFixed(2)));
    assert.equal(Number(o.costs), 215);
    assert.equal(o.byType[0]!.name, "Montagem");
    assert.equal(o.byProduct[0]!.name, "Lata de açaí");

    await runService(t.app, cancelCost, owner, { id: c.id });
    assert.equal(Number((await runService(t.app, costsOverview, owner, { period: "30d" })).costs), 185);
    const seller = await addUserWithRole(t.app, owner, "sales", "Vendedor");
    await assert.rejects(runService(t.app, createCost, seller.actor, { costTypeId: outros.id, amount: "5" }), rejectsWith("forbidden"));
  });
});

describe("encomenda quando acaba e lista de etapas", () => {
  it("produto de estoque vende por encomenda o que faltar; quem não aceita é barrado", async () => {
    const un = (await runService(t.app, listUnits, owner, {})).find((u) => u.code === "UN")!.id;
    const relogio = await runService(t.app, createProduct, owner, { sku: "REL", name: "Relógio", unitId: un, salePrice: "500", costPrice: "200", minStock: "0", initialStock: "2" });
    assert.equal(relogio.backorder, true);
    const sale = await runService(t.app, createSale, owner, { paymentMethod: "pix", items: [{ productId: relogio.id, quantity: "3" }, { productId: lata, quantity: "1" }] });
    const full = await runService(t.app, getSale, owner, { id: sale.id });
    assert.deepEqual(full.items.map((i) => [i.productName, i.backorderQty]), [["Lata de açaí", "0.000"], ["Relógio", "1.000"]]);
    // O saldo fica negativo: 1 vendido que ainda precisa chegar.
    assert.equal((await runService(t.app, listProducts, owner, { search: "Relógio" }))[0]!.stockQty, "-1.000");
    const f = await runService(t.app, getSaleFollowup, owner, { saleId: sale.id });
    assert.deepEqual(f!.steps.map((x) => [x.name, x.notes]), [["Encomenda", "Pedir: 1 × Relógio"]]);

    // Com estoque suficiente, nada de encomenda.
    const raro = await runService(t.app, createProduct, owner, { sku: "RARO", name: "Peça rara", unitId: un, salePrice: "900", costPrice: "0", minStock: "0", initialStock: "1", backorder: false });
    const ok = await runService(t.app, createSale, owner, { paymentMethod: "pix", items: [{ productId: raro.id, quantity: "1" }] });
    assert.equal(await runService(t.app, getSaleFollowup, owner, { saleId: ok.id }), null);
    // Acabou e não vende por encomenda: barrado, conta também a mesma peça repetida no carrinho.
    await assert.rejects(
      runService(t.app, createSale, owner, { paymentMethod: "pix", items: [{ productId: raro.id, quantity: "1" }] }),
      rejectsWith("invalid_input"),
    );
    await runService(t.app, updateProduct, owner, { ...raro, backorder: true, status: "active" });
    const later = await runService(t.app, createSale, owner, { paymentMethod: "pix", items: [{ productId: raro.id, quantity: "1" }] });
    assert.ok((await runService(t.app, getSaleFollowup, owner, { saleId: later.id }))!.steps.some((x) => x.name === "Encomenda"));
  });

  it("etapas da empresa: padrões aplicados na venda, renomear chega nos produtos", async () => {
    const names = (await runService(t.app, listStepTypes, owner, {})).map((x) => x.name);
    assert.ok(["Encomenda", "Entrega", "Instalação", "Montagem", "Retirada na loja"].every((n) => names.includes(n)));
    assert.ok(!names.includes("Pintura"));
    await assert.rejects(runService(t.app, createStepType, owner, { name: "entrega" }), rejectsWith("conflict"));
    await runService(t.app, createStepType, owner, { name: "Pintura", defaultDays: 3, defaultResponsible: "Carlos", defaultCost: "40" });
    const un = (await runService(t.app, listUnits, owner, {})).find((u) => u.code === "UN")!.id;
    const portao = await runService(t.app, createProduct, owner, { sku: "PORT", name: "Portão", unitId: un, salePrice: "1500", costPrice: "0", minStock: "0", itemType: "service", afterSaleSteps: ["pintura", "Solda"] });
    // Etapa nova usada num produto entra na lista sozinha.
    const types = await runService(t.app, listStepTypes, owner, {});
    assert.ok(types.some((x) => x.name === "Solda"));
    assert.equal(types.find((x) => x.name === "Pintura")!.products, 1);

    const sale = await runService(t.app, createSale, owner, { paymentMethod: "pix", items: [{ productId: portao.id, quantity: "1" }] });
    const pintura = (await runService(t.app, getSaleFollowup, owner, { saleId: sale.id }))!.steps[0]!;
    assert.equal(pintura.responsible, "Carlos");
    assert.equal(pintura.cost, "40.00");
    assert.ok(pintura.scheduledFor! > today);
    // O que a venda informa vence o padrão.
    const own = await runService(t.app, createSale, owner, {
      paymentMethod: "pix",
      items: [{ productId: portao.id, quantity: "1" }],
      followup: { steps: [{ name: "Pintura", responsible: "Ana", cost: "0" }] },
    });
    const p2 = (await runService(t.app, getSaleFollowup, owner, { saleId: own.id }))!.steps[0]!;
    assert.deepEqual([p2.responsible, p2.cost], ["Ana", "0"]);

    const id = types.find((x) => x.name === "Pintura")!.id;
    await runService(t.app, updateStepType, owner, { id, name: "Pintura eletrostática", defaultDays: null, status: "active" });
    assert.deepEqual((await runService(t.app, listProducts, owner, { search: "Portão" }))[0]!.afterSaleSteps, ["Pintura eletrostática", "Solda"]);
    assert.equal((await runService(t.app, listStepTypes, other, {})).some((x) => x.name === "Pintura eletrostática"), false);
    const fin = await addUserWithRole(t.app, owner, "finance", "Financeiro 2");
    await assert.rejects(runService(t.app, createStepType, fin.actor, { name: "Frete" }), rejectsWith("forbidden"));
  });
});
