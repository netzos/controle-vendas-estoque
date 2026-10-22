import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  AppError,
  aiCostUsd,
  deletePlatformOrganization,
  enabledFeatures,
  featureRollouts,
  listPlatformFixedCosts,
  listPlatformOrganizationRows,
  listPlatformUsers,
  platformDashboard,
  platformUsageSummary,
  recordAiUsage,
  recordTranscriptionUsage,
  savePlatformBilling,
  savePlatformFixedCost,
  setFeature,
  setFeatureDefault,
  setOrganizationKind,
  setOrganizationStatus,
  setPlatformUsdBrl,
  transcriptionCostUsd,
  type Actor,
} from "../src/index.ts";
import { actorFor, seedCompany, setupTestDb, type TestDb } from "./helpers.ts";

const rejectsWith = (code: string) => (err: unknown) => {
  assert.ok(err instanceof AppError, `esperava AppError, veio ${String(err)}`);
  assert.equal(err.code, code, err.message);
  return true;
};

let t: TestDb;
let dev: Actor;
let client: Actor;
let other: Actor;
let demo: Actor;

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "netzsales", "dev@netzcode.com.br");
  dev = await actorFor(t.app, a.userId, a.organizationId);
  await t.owner.query("INSERT INTO controle_vendas_estoque.platform_developers (user_id) VALUES ($1)", [a.userId]);
  client = await (async () => { const b = await seedCompany(t.app, "Loja A"); return actorFor(t.app, b.userId, b.organizationId); })();
  other = await (async () => { const c = await seedCompany(t.app, "Loja B"); return actorFor(t.app, c.userId, c.organizationId); })();
  // A Demonstração é uma empresa da equipe: o dono é o próprio desenvolvedor.
  const d = await t.owner.query<{ id: string }>("INSERT INTO controle_vendas_estoque.organizations (name) VALUES ('Demonstração') RETURNING id");
  demo = { ...dev, organizationId: d.rows[0]!.id };
});
after(() => t.close());

describe("dashboard da plataforma", () => {
  it("calcula o custo pelo preço do modelo", () => {
    assert.equal(aiCostUsd("claude-opus-5-5", { input_tokens: 1_000_000, output_tokens: 100_000 }), 6);
    assert.equal(aiCostUsd("modelo-desconhecido", { input_tokens: 1_000_000 }), 0);
    assert.ok(Math.abs(transcriptionCostUsd("gpt-4o-mini-transcribe", 120) - 0.006) < 1e-9);
  });

  it("empresa interna sai dos números e da lista de usuários de cliente", async () => {
    await assert.rejects(setOrganizationKind(t.app, client, client.organizationId, "internal"), rejectsWith("forbidden"));
    await setOrganizationKind(t.app, dev, dev.organizationId, "internal");
    await setOrganizationKind(t.app, dev, demo.organizationId, "internal");
    const d = await platformDashboard(t.app, dev.userId);
    assert.equal(d.companies.total, 2);
    assert.equal(d.users.total, 2);
    const rows = await listPlatformOrganizationRows(t.app, dev.userId);
    assert.equal(rows.filter((r) => r.kind === "customer").length, 2);
    const me = (await listPlatformUsers(t.app, dev.userId)).find((u) => u.isDeveloper)!;
    assert.deepEqual(me.organizations, []);
    assert.deepEqual(me.internalOrganizations, ["netzsales"]);
  });

  it("mensalidade, custo de uso e lucro", async () => {
    await savePlatformBilling(t.app, dev, client.organizationId, { planName: "Básico", monthlyPrice: 99.9, status: "paying" });
    await savePlatformBilling(t.app, dev, other.organizationId, { monthlyPrice: 0, status: "trial" });
    await assert.rejects(savePlatformBilling(t.app, dev, client.organizationId, { monthlyPrice: -1, status: "paying" }), rejectsWith("invalid_input"));
    await recordAiUsage(t.app, client, "netz", "claude-opus-5-5", { input_tokens: 500_000, output_tokens: 50_000 });
    await recordTranscriptionUsage(t.app, client, "telegram_audio", { provider: "openai", model: "gpt-4o-mini-transcribe", seconds: 60 });
    await recordAiUsage(t.app, dev, "improvements_analysis", "claude-opus-5-5", { input_tokens: 1_000_000 });
    await savePlatformFixedCost(t.app, dev.userId, { name: "Vercel", monthlyBrl: 110 });
    await setPlatformUsdBrl(t.app, dev.userId, { rate: "5" });
    const d = await platformDashboard(t.app, dev.userId);
    assert.equal(d.money.mrr, 99.9);
    assert.equal(d.money.paying, 1);
    assert.equal(d.money.trial, 1);
    assert.ok(Math.abs(d.money.usageCustomers30dUsd - 3.003) < 1e-6);
    assert.equal(d.money.usageInternal30dUsd, 4);
    assert.equal(d.money.fixedMonthlyBrl, 110);
    assert.equal(d.money.usdBrl, 5);
    const row = (await listPlatformOrganizationRows(t.app, dev.userId)).find((o) => o.id === client.organizationId)!;
    assert.equal(Number(row.monthlyPrice), 99.9);
    assert.equal(row.billingStatus, "paying");
    assert.ok(Math.abs(Number(row.usageCost30dUsd) - 3.003) < 1e-6);
    const summary = await platformUsageSummary(t.app, dev.userId, new Date(Date.now() - 86_400_000));
    assert.equal(summary.filter((s) => s.organizationId === client.organizationId).length, 2);
    assert.equal((await listPlatformFixedCosts(t.app, dev.userId)).length, 1);
  });

  it("liberações: padrão para todas e exceções por empresa", async () => {
    await setFeatureDefault(t.app, dev, "telegram", false);
    let r = (await featureRollouts(t.app, dev.userId)).find((f) => f.key === "telegram")!;
    assert.equal(r.defaultOn, false);
    assert.equal(r.enabledCount, 0);
    assert.ok(!(await enabledFeatures(t.app, client.organizationId)).has("telegram"));
    await setFeature(t.app, dev, client.organizationId, "telegram", true);
    r = (await featureRollouts(t.app, dev.userId)).find((f) => f.key === "telegram")!;
    assert.equal(r.enabledCount, 1);
    assert.deepEqual(r.exceptions.map((e) => e.name), ["Loja A"]);
    assert.ok((await enabledFeatures(t.app, client.organizationId)).has("telegram"));
    // Ligar para todas desfaz as exceções e vale para empresas novas.
    await setFeatureDefault(t.app, dev, "telegram", true);
    r = (await featureRollouts(t.app, dev.userId)).find((f) => f.key === "telegram")!;
    assert.equal(r.exceptions.length, 0);
    assert.equal(r.enabledCount, 2);
    await assert.rejects(setFeatureDefault(t.app, client, "telegram", false), rejectsWith("forbidden"));
  });

  it("exclui de vez só empresa interna ou suspensa, com o nome digitado", async () => {
    await assert.rejects(deletePlatformOrganization(t.app, dev, other.organizationId, "Loja B"), rejectsWith("conflict"));
    await assert.rejects(deletePlatformOrganization(t.app, dev, demo.organizationId, "Demo"), rejectsWith("invalid_input"));
    assert.equal(await deletePlatformOrganization(t.app, dev, demo.organizationId, "Demonstração"), "Demonstração");
    await setOrganizationStatus(t.app, dev, other.organizationId, "suspended");
    await deletePlatformOrganization(t.app, dev, other.organizationId, "Loja B");
    const rows = await listPlatformOrganizationRows(t.app, dev.userId);
    assert.deepEqual(rows.map((r) => r.name).sort(), ["Loja A", "netzsales"]);
  });
});
