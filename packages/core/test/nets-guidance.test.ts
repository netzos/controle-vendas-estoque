import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import {
  AppError,
  createImprovement,
  getImprovement,
  getNetsGuidanceVersion,
  improvementViewer,
  myPersonNotes,
  platformNetsPeople,
  platformPersonNotes,
  platformRemovePersonNote,
  removeMyPersonNote,
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

type Block = { type: "text"; text: string } | { type: "tool_use"; name: string; input: Record<string, unknown> };
function script(...turns: Block[][]) {
  const requests: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  const model: NetsModel = async (req) => {
    requests.push(structuredClone(req));
    const content = turns.shift()!.map((b) => (b.type === "tool_use" ? { ...b, id: `tu_${crypto.randomUUID()}` } : { ...b, citations: null }));
    return {
      id: "msg", type: "message", role: "assistant", model: req.model, content,
      stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
    } as unknown as Anthropic.Beta.BetaMessage;
  };
  return { model, requests };
}

async function talk(actor: Actor, text: string, model: NetsModel) {
  const m = await postNetsMessage(t.app, actor, { requestId: crypto.randomUUID(), text });
  await processNetsTurn(t.app, { organizationId: actor.organizationId, userId: actor.userId, messageId: m.id }, { model });
  return m.id;
}

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

  it("a Netz anota o jeito da pessoa, lê nas próximas respostas e grava a versão do manual que leu", async () => {
    const first = script(
      [{ type: "tool_use", name: "anotar_jeito", input: { observacao: "Responde curto e com pressa: registrar o mínimo, sem ofertas extras." } }],
      [{ type: "text", text: "Feito." }],
    );
    const id = await talk(shopActor, "só registra, sem papo", first.model);
    const notes = await myPersonNotes(t.app, shopActor);
    assert.equal(notes.length, 1);
    assert.equal(notes[0]!.source, "netz");

    const next = script([{ type: "text", text: "Ok." }]);
    await talk(shopActor, "vendi 2 capinhas", next.model);
    assert.match(JSON.stringify(next.requests[0]!.system), /Responde curto e com pressa/);

    // Substituir desativa a antiga e mantém o histórico.
    const third = script(
      [{ type: "tool_use", name: "anotar_jeito", input: { observacao: "Agora gosta de ser lembrada das contas a receber.", substitui: notes[0]!.id } }],
      [{ type: "text", text: "Ok." }],
    );
    await talk(shopActor, "pode me lembrar das contas", third.model);
    const all = await myPersonNotes(t.app, shopActor);
    assert.equal(all.filter((n) => n.active).length, 1);
    assert.equal(all.find((n) => n.id === notes[0]!.id)!.endedReason, "replaced");

    // A pessoa tira uma nota; o administrador vê o histórico inteiro.
    const active = all.find((n) => n.active)!;
    await removeMyPersonNote(t.app, shopActor, active.id);
    const history = await platformPersonNotes(t.app, dev, shopActor.organizationId, shopActor.userId);
    assert.equal(history.length, 2);
    assert.ok(history.every((n) => !n.active));
    await assert.rejects(platformRemovePersonNote(t.app, dev, active.id), rejectsWith("not_found"));
    await assert.rejects(platformPersonNotes(t.app, shop, shopActor.organizationId, shopActor.userId), rejectsWith("forbidden"));

    const people = await platformNetsPeople(t.app, dev);
    const me = people.find((p) => p.userId === shopActor.userId)!;
    assert.equal(me.organizationName, "Loja");
    assert.ok(me.messages >= 4);

    // Cada resposta grava a versão do manual que leu; a Plataforma conta as leituras.
    const row = await t.owner.query<{ v: string }>("SELECT guidance_version::text AS v FROM controle_vendas_estoque.nets_messages WHERE id = $1", [id]);
    const o = await netsGuidanceOverview(t.app, dev);
    assert.equal(Number(row.rows[0]!.v), o.current.id);
    assert.equal(o.reads[o.current.id!]!.web, 3);
    assert.equal(o.reads[o.current.id!]!.telegram, 0);
  });

  it("cada versão mostra o texto anterior, e a versão 0 é o texto inicial", async () => {
    const o = await netsGuidanceOverview(t.app, dev);
    const v = await getNetsGuidanceVersion(t.app, dev, o.versions.at(-1)!.id);
    assert.equal(v.previous, NETS_MANUAL_DEFAULT);
    const zero = await getNetsGuidanceVersion(t.app, dev, 0);
    assert.equal(zero.body, NETS_MANUAL_DEFAULT);
    const back = await revertNetsGuidance(t.app, dev, 0, o.current.id);
    assert.equal((await netsGuidanceOverview(t.app, dev)).current.id, back.id);
  });
});
