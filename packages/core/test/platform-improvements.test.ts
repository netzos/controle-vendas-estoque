import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  analyzeImprovementsWithAI,
  AppError,
  createImprovement,
  decideImprovement,
  enabledFeatures,
  improvementViewer,
  latestImprovementAnalysis,
  listImprovements,
  mergeImprovement,
  platformFeatures,
  setFeature,
  type Actor,
  type ImprovementViewer,
  type NetsModel,
} from "../src/index.ts";
import { actorFor, seedCompany, setupTestDb, type TestDb } from "./helpers.ts";

const rejectsWith = (code: string) => (err: unknown) => {
  assert.ok(err instanceof AppError, `esperava AppError, veio ${String(err)}`);
  assert.equal(err.code, code, err.message);
  return true;
};

let t: TestDb;
let devActor: Actor;
let dev: ImprovementViewer;
let a: ImprovementViewer;
let b: ImprovementViewer;
let bActor: Actor;

before(async () => {
  t = await setupTestDb();
  const d = await seedCompany(t.app, "Fazenda", "dev@netzcode.com.br");
  devActor = await actorFor(t.app, d.userId, d.organizationId);
  await t.owner.query("INSERT INTO controle_vendas_estoque.platform_developers (user_id) VALUES ($1)", [d.userId]);
  dev = await improvementViewer(t.app, devActor);
  const ca = await seedCompany(t.app, "Loja A");
  a = await improvementViewer(t.app, await actorFor(t.app, ca.userId, ca.organizationId));
  const cb = await seedCompany(t.app, "Loja B");
  bActor = await actorFor(t.app, cb.userId, cb.organizationId);
  b = await improvementViewer(t.app, bActor);
});
after(() => t.close());

describe("melhorias na plataforma", () => {
  it("juntar pedidos parecidos de empresas diferentes conta no principal e segue a decisão", async () => {
    const pa = await createImprovement(t.app, a, { title: "Venda parcelada", body: "Quero parcelar as vendas.", module: "comercial" });
    const pb = await createImprovement(t.app, b, { title: "Parcelas na venda", body: "Preciso vender em parcelas.", module: "comercial" });
    await assert.rejects(mergeImprovement(t.app, a, pb.id, pa.id), rejectsWith("forbidden"));
    const merged = await mergeImprovement(t.app, dev, pb.id, pa.id);
    assert.equal(merged.requests, 2);
    assert.deepEqual([...merged.organizations].sort(), ["Loja A", "Loja B"]);

    // A Plataforma mostra só o principal; a empresa B continua vendo o pedido dela.
    const platform = await listImprovements(t.app, dev, {});
    assert.ok(platform.some((i) => i.id === pa.id));
    assert.ok(!platform.some((i) => i.id === pb.id));
    const mine = await listImprovements(t.app, b, { includeMerged: true });
    assert.equal(mine.length, 1);
    assert.equal(mine[0]!.mergedIntoNumber, pa.number);

    await assert.rejects(decideImprovement(t.app, dev, pb.id, "approve"), rejectsWith("conflict"));
    await decideImprovement(t.app, dev, pa.id, "approve");
    const after = await listImprovements(t.app, b, { includeMerged: true });
    assert.equal(after[0]!.status, "approved");
  });

  it("na tela da empresa, o desenvolvedor vê só os pedidos dela", async () => {
    await createImprovement(t.app, dev, { title: "Pedido da Fazenda", body: "Algo da fazenda.", module: "geral" });
    const company = await listImprovements(t.app, dev, { organizationId: dev.organizationId, includeMerged: true });
    assert.deepEqual(company.map((i) => i.organizationName), ["Fazenda"]);
  });

  it("a IA analisa os pedidos abertos e a análise fica guardada", async () => {
    const all = await listImprovements(t.app, dev, {});
    const numbers = all.map((i) => Number(i.number));
    const fake: NetsModel = async (req) => {
      assert.match(JSON.stringify(req.messages), /Pedido da Fazenda/);
      return {
        content: [{ type: "text", text: `Aqui está: {"resumo": "Poucos pedidos.", "grupos": [{"titulo": "x", "numeros": [${numbers[0]}, 9999], "motivo": "y"}], "necessidades": [{"empresa": "Fazenda", "resumo": "Quer algo."}], "prioridades": [{"numero": ${numbers[0]}, "motivo": "z"}]}` }],
      } as any;
    };
    await assert.rejects(analyzeImprovementsWithAI(t.app, a, fake), rejectsWith("forbidden"));
    const r = await analyzeImprovementsWithAI(t.app, dev, fake);
    assert.equal(r.result.resumo, "Poucos pedidos.");
    assert.equal(r.result.grupos.length, 0); // número inexistente cai e o grupo fica com um só
    assert.equal(r.result.necessidades[0]!.empresa, "Fazenda");
    const latest = await latestImprovementAnalysis(t.app, dev);
    assert.equal(latest?.id, r.id);
  });

  it("liberações: liga e desliga por empresa ou para todas", async () => {
    assert.ok((await enabledFeatures(t.app, b.organizationId)).has("costs"));
    await assert.rejects(setFeature(t.app, bActor, b.organizationId, "costs", false), rejectsWith("forbidden"));
    await setFeature(t.app, devActor, b.organizationId, "costs", false);
    assert.ok(!(await enabledFeatures(t.app, b.organizationId)).has("costs"));
    assert.ok((await enabledFeatures(t.app, a.organizationId)).has("costs"));
    await setFeature(t.app, devActor, null, "telegram", false);
    const map = await platformFeatures(t.app, devActor.userId);
    assert.equal(map.size, 3);
    for (const set of map.values()) assert.ok(!set.has("telegram"));
    await assert.rejects(setFeature(t.app, devActor, null, "nada", true), rejectsWith("invalid_input"));
  });
});
