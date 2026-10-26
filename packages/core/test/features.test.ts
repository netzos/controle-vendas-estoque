import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  AppError,
  companyFeatureChoices,
  createProduct,
  createSale,
  enabledFeatures,
  listUnits,
  runService,
  setCompanyFeature,
  type Actor,
} from "../src/index.ts";
import { actorFor, enableAllFeatures, seedCompany, setupTestDb, type TestDb } from "./helpers.ts";

let t: TestDb;
let owner: Actor;
let produto: string;

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "Loja Simples");
  // Volta ao jeito que uma empresa nova nasce: só o básico de vender.
  await enableAllFeatures(t.owner, a.organizationId, false);
  owner = await actorFor(t.app, a.userId, a.organizationId);
  const un = (await runService(t.app, listUnits, owner, {})).find((u) => u.code === "UN")!.id;
  produto = (await runService(t.app, createProduct, owner, { sku: "CAMISA", name: "Camisa", unitId: un, salePrice: "50", costPrice: "20", minStock: "0", initialStock: "5" })).id;
});
after(() => t.close());

describe("recursos da empresa (Ajustes › Recursos)", () => {
  it("empresa nova nasce só com o básico; Netz e Telegram seguem as liberações", async () => {
    const on = await enabledFeatures(t.app, owner.organizationId);
    assert.deepEqual([...on].sort(), ["netz", "telegram"]);
    const choices = await companyFeatureChoices(t.app, owner.organizationId);
    assert.deepEqual(choices.map((c) => [c.key, c.enabled]), [["deliveries", false], ["trade_in", false], ["costs", false], ["custom_fields", false]]);
  });

  it("com o recurso desligado, a venda recusa troca e entrega", async () => {
    await assert.rejects(
      runService(t.app, createSale, owner, { paymentMethod: "pix", items: [{ productId: produto, quantity: "1" }], tradeIns: [{ name: "Camisa usada", value: "10" }] }),
      (err: unknown) => err instanceof AppError && /Ajustes › Recursos/.test(err.message),
    );
    await assert.rejects(
      runService(t.app, createSale, owner, { paymentMethod: "pix", fulfillment: "delivery", items: [{ productId: produto, quantity: "1" }], followup: { address: "Rua A, 1" } }),
      (err: unknown) => err instanceof AppError && /Ajustes › Recursos/.test(err.message),
    );
  });

  it("o dono liga o recurso e a troca passa a valer; desligar esconde de novo", async () => {
    await runService(t.app, setCompanyFeature, owner, { key: "trade_in", enabled: true });
    assert.ok((await enabledFeatures(t.app, owner.organizationId)).has("trade_in"));
    const sale = await runService(t.app, createSale, owner, {
      paymentMethod: "pix", items: [{ productId: produto, quantity: "1" }], tradeIns: [{ name: "Camisa usada", value: "10" }],
    });
    assert.equal(sale.total, "50.00");
    await runService(t.app, setCompanyFeature, owner, { key: "trade_in", enabled: false });
    assert.ok(!(await enabledFeatures(t.app, owner.organizationId)).has("trade_in"));
  });

  it("empresa nova grava só o básico; empresa de antes, sem escolha gravada, segue com tudo ligado", async () => {
    const b = await seedCompany(t.app, "Outra Loja");
    const rows = await t.owner.query<{ key: string; value: boolean }>(
      "SELECT key, value FROM controle_vendas_estoque.organization_settings WHERE organization_id = $1 AND key LIKE 'features.%'",
      [b.organizationId],
    );
    assert.equal(rows.rows.length, 4);
    await t.owner.query("DELETE FROM controle_vendas_estoque.organization_settings WHERE organization_id = $1 AND key LIKE 'features.%'", [b.organizationId]);
    assert.ok((await enabledFeatures(t.app, b.organizationId)).has("trade_in"));
  });

  it("recurso desconhecido é recusado", async () => {
    await assert.rejects(runService(t.app, setCompanyFeature, owner, { key: "netz", enabled: false }), AppError);
  });
});
