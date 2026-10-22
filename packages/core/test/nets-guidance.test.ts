import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import {
  AppError,
  createImprovement,
  getImprovement,
  improvementViewer,
  NETS_MANUAL_DEFAULT,
  netsGuidanceOverview,
  postNetsMessage,
  processNetsTurn,
  proposeNetsGuidance,
  revertNetsGuidance,
  saveNetsGuidance,
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
let dev: ImprovementViewer;
let shop: ImprovementViewer;
let shopActor: Actor;

before(async () => {
  t = await setupTestDb();
  const d = await seedCompany(t.app, "netzsales", "dev@netzcode.com.br");
  await t.owner.query("INSERT INTO controle_vendas_estoque.platform_developers (user_id) VALUES ($1)", [d.userId]);
  dev = await improvementViewer(t.app, await actorFor(t.app, d.userId, d.organizationId));
  const s = await seedCompany(t.app, "Loja");
  shopActor = await actorFor(t.app, s.userId, s.organizationId);
  shop = await improvementViewer(t.app, shopActor);
  process.env.ANTHROPIC_API_KEY = "teste";
});
after(() => t.close());

function reply(text: string): NetsModel & { requests: Anthropic.Beta.MessageCreateParamsNonStreaming[] } {
  const requests: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  const model = (async (req: Anthropic.Beta.MessageCreateParamsNonStreaming) => {
    requests.push(structuredClone(req));
    return {
      id: "msg", type: "message", role: "assistant", model: req.model,
      content: [{ type: "text", text, citations: null }],
      stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
    } as unknown as Anthropic.Beta.BetaMessage;
  }) as NetsModel & { requests: typeof requests };
  model.requests = requests;
  return model;
}

describe("comunicação da Netz", () => {
  it("começa com o manual padrão, já com a proatividade suave, e só o administrador vê", async () => {
    const o = await netsGuidanceOverview(t.app, dev);
    assert.equal(o.current.id, null);
    assert.equal(o.current.body, NETS_MANUAL_DEFAULT);
    assert.match(o.current.body, /Proatividade suave/);
    assert.ok(o.tools.some((x) => x.name === "registrar_melhoria"));
    await assert.rejects(netsGuidanceOverview(t.app, shop), rejectsWith("forbidden"));
    await assert.rejects(saveNetsGuidance(t.app, shop, { body: "x", base: null }), rejectsWith("forbidden"));
  });

  it("a Netz lê a versão mais nova antes de responder", async () => {
    const first = await saveNetsGuidance(t.app, dev, { body: "Fale sempre em frases curtas.", base: null, note: "Teste" });
    // Outra pessoa editando a versão antiga não sobrescreve.
    await assert.rejects(saveNetsGuidance(t.app, dev, { body: "Outro texto", base: null }), rejectsWith("conflict"));
    await assert.rejects(saveNetsGuidance(t.app, dev, { body: "Fale sempre em frases curtas.", base: first.id }), rejectsWith("invalid_input"));

    const model = reply("Oi!");
    const m = await postNetsMessage(t.app, shopActor, { requestId: crypto.randomUUID(), text: "vendi um iPhone" });
    await processNetsTurn(t.app, { organizationId: shopActor.organizationId, userId: shopActor.userId, messageId: m.id }, { model });
    const system = JSON.stringify(model.requests[0]!.system);
    assert.match(system, /Fale sempre em frases curtas/);
    assert.match(system, /Você é a Netz/);
    assert.doesNotMatch(system, /Proatividade suave/);

    const back = await revertNetsGuidance(t.app, dev, first.id, first.id).catch((e) => e);
    assert.ok(back instanceof AppError, "voltar para o mesmo texto não cria versão");
  });

  it("pedido de ajuste na comunicação vira versão do manual e fica publicado", async () => {
    const req = await createImprovement(t.app, shop, { title: "Netz pergunta demais", body: "Faz muitas perguntas seguidas.", module: "comunicacao" });
    const o = await netsGuidanceOverview(t.app, dev);
    assert.ok(o.requests.some((r) => r.id === req.id));

    const model = reply(JSON.stringify({ resumo: "Uma pergunta por vez.", manual: "Fale sempre em frases curtas.\n- Uma pergunta por vez." }));
    const p = await proposeNetsGuidance(t.app, dev, { request: req.body }, model);
    assert.equal(p.base, o.current.id);
    assert.match(p.proposed, /Uma pergunta por vez/);
    assert.match(JSON.stringify(model.requests[0]!.messages), /Fale sempre em frases curtas/);

    const saved = await saveNetsGuidance(t.app, dev, { body: p.proposed, base: p.base, source: "proposal", note: p.summary, improvementId: req.id });
    const item = await getImprovement(t.app, shop, req.id);
    assert.equal(item.item.status, "published");
    assert.match(item.item.link!, new RegExp(`/plataforma/comunicacao\\?versao=${saved.id}$`));
    const after = await netsGuidanceOverview(t.app, dev);
    assert.equal(after.versions[0]!.improvementNumber, String(item.item.number));
  });
});
