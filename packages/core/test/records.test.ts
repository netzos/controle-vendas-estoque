import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  AppError,
  createCategory,
  createCustomer,
  createProduct,
  createSale,
  getSale,
  getSaleFollowup,
  inspectPasswordToken,
  listCosts,
  listMembers,
  listProducts,
  listUnits,
  memberPasswordLink,
  removeRecord,
  runService,
  salesDashboard,
  updateMember,
  updateSettings,
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
let un: string;
let lata: string;

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "Fazenda");
  owner = await actorFor(t.app, a.userId, a.organizationId);
  un = (await runService(t.app, listUnits, owner, {})).find((u) => u.code === "UN")!.id;
  lata = (await runService(t.app, createProduct, owner, {
    sku: "LATA", name: "Lata de açaí", unitId: un, salePrice: "60", costPrice: "30", minStock: "0", initialStock: "50", afterSaleSteps: ["Entrega"],
  })).id;
});
after(() => t.close());

describe("excluir cadastros", () => {
  it("sem histórico apaga; com histórico desativa e avisa", async () => {
    const novo = await runService(t.app, createProduct, owner, { sku: "TESTE", name: "Produto teste", unitId: un, salePrice: "1", costPrice: "0", minStock: "0" });
    const r1 = await runService(t.app, removeRecord, owner, { kind: "product", id: novo.id });
    assert.equal(r1.result, "deleted");
    assert.equal((await runService(t.app, listProducts, owner, { search: "TESTE", includeInactive: true })).length, 0);

    // Lata tem movimento de estoque: fica desativada.
    const r2 = await runService(t.app, removeRecord, owner, { kind: "product", id: lata });
    assert.equal(r2.result, "deactivated");
    assert.match(r2.message, /desativado/);
    const [p] = await runService(t.app, listProducts, owner, { search: "LATA", includeInactive: true });
    assert.equal(p!.status, "inactive");
    await runService(t.app, (await import("../src/index.ts")).updateProduct, owner, {
      id: lata, sku: "LATA", name: "Lata de açaí", unitId: un, salePrice: "60", costPrice: "30", minStock: "0", status: "active", afterSaleSteps: ["Entrega"],
    });

    const cat = await runService(t.app, createCategory, owner, { name: "Bebidas" });
    assert.equal((await runService(t.app, removeRecord, owner, { kind: "category", id: cat.id })).result, "deleted");
    const cli = await runService(t.app, createCustomer, owner, { name: "Dona Maria" });
    assert.equal((await runService(t.app, removeRecord, owner, { kind: "customer", id: cli.id })).result, "deleted");
  });

  it("respeita permissão e empresa", async () => {
    const seller = await addUserWithRole(t.app, owner, "sales", "Vendedora");
    await assert.rejects(runService(t.app, removeRecord, seller.actor, { kind: "product", id: lata }), rejectsWith("forbidden"));
    const b = await seedCompany(t.app, "Outra");
    const other = await actorFor(t.app, b.userId, b.organizationId);
    await assert.rejects(runService(t.app, removeRecord, other, { kind: "product", id: lata }), rejectsWith("not_found"));
  });
});

describe("retirada ou entrega", () => {
  it("retirada é o padrão: sem frete e sem etapa Entrega", async () => {
    const s = await runService(t.app, createSale, owner, { paymentMethod: "pix", items: [{ productId: lata, quantity: "2" }] });
    assert.equal((await runService(t.app, getSale, owner, { id: s.id })).fulfillment, "pickup");
    assert.equal(await runService(t.app, getSaleFollowup, owner, { saleId: s.id }), null);
    await assert.rejects(
      runService(t.app, createSale, owner, { paymentMethod: "pix", fulfillment: "pickup", items: [{ productId: lata, quantity: "1" }], followup: { fee: "10" } }),
      rejectsWith("invalid_input"),
    );
  });

  it("entrega pede endereço, cobra frete e o transporte vira custo só dessa venda", async () => {
    await assert.rejects(
      runService(t.app, createSale, owner, { paymentMethod: "pix", fulfillment: "delivery", items: [{ productId: lata, quantity: "1" }] }),
      rejectsWith("invalid_input"),
    );
    const s = await runService(t.app, createSale, owner, {
      paymentMethod: "pix",
      fulfillment: "delivery",
      items: [{ productId: lata, quantity: "1" }],
      followup: { address: "Sítio Boa Vista", fee: "15", deliveryCost: "8" },
    });
    assert.equal(s.total, "75.00");
    const f = await runService(t.app, getSaleFollowup, owner, { saleId: s.id });
    assert.deepEqual(f!.steps.map((x) => [x.name, x.cost]), [["Entrega", "8.00"]]);
    const costs = await runService(t.app, listCosts, owner, {});
    assert.ok(costs.some((c) => c.saleId === s.id && Number(c.amount) === 8));

    const dash = await runService(t.app, salesDashboard, owner, { period: "today" });
    assert.equal(dash.fulfillment.pickup.count, 1);
    assert.equal(dash.fulfillment.delivery.count, 1);
    assert.equal(Number(dash.fulfillment.delivery.fees), 15);
    assert.equal(Number(dash.fulfillment.delivery.transport), 8);
  });

  it("a empresa pode deixar entrega como padrão", async () => {
    await runService(t.app, updateSettings, owner, { "sales.default_fulfillment": "delivery" });
    await assert.rejects(
      runService(t.app, createSale, owner, { paymentMethod: "pix", items: [{ productId: lata, quantity: "1" }] }),
      /endereço/,
    );
    await runService(t.app, updateSettings, owner, { "sales.default_fulfillment": "pickup" });
  });
});

describe("usuários", () => {
  it("edita nome e e-mail de quem nunca entrou e gera link de senha", async () => {
    const pai = await addUserWithRole(t.app, owner, "sales", "Fernando");
    const m = (await runService(t.app, listMembers, owner, {})).find((x) => x.userId === pai.userId)!;
    await runService(t.app, updateMember, owner, {
      membershipId: m.membershipId, roleId: m.roleId, branchIds: null, status: "active", name: "Fernando Miranda", email: "Pai@Teste.com",
    });
    const m2 = (await runService(t.app, listMembers, owner, {})).find((x) => x.userId === pai.userId)!;
    assert.deepEqual([m2.name, m2.email], ["Fernando Miranda", "pai@teste.com"]);

    const link = await runService(t.app, memberPasswordLink, owner, { membershipId: m.membershipId });
    assert.ok(link.firstAccess);
    const token = new URL(link.url).searchParams.get("token")!;
    assert.equal((await inspectPasswordToken(t.app, token))?.email, "pai@teste.com");
    await assert.rejects(runService(t.app, memberPasswordLink, pai.actor, { membershipId: m.membershipId }), rejectsWith("forbidden"));
  });
});
