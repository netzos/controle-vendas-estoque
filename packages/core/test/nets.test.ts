import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import {
  AppError,
  decideNetsAction,
  joinReply,
  listCustomers,
  listNetsMessages,
  listProducts,
  listUnits,
  NETS_FAST_MODEL,
  NETS_MODEL,
  netsTools,
  postNetsMessage,
  processNetsTurn,
  runService,
  type Actor,
  type NetsModel,
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

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "Loja");
  owner = await actorFor(t.app, a.userId, a.organizationId);
  un = (await runService(t.app, listUnits, owner, {})).find((u) => u.code === "UN")!.id;
});
after(() => t.close());
beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "teste";
});

type Block = { type: "text"; text: string } | { type: "tool_use"; name: string; input: Record<string, unknown> };

// Modelo roteirizado: cada chamada devolve a próxima resposta da lista.
function script(...turns: Block[][]) {
  const requests: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  const model: NetsModel = async (req) => {
    requests.push(structuredClone(req));
    const blocks = turns.shift();
    assert.ok(blocks, "o modelo foi chamado mais vezes que o roteiro");
    const content = blocks.map((b) => (b.type === "tool_use" ? { ...b, id: `tu_${randomUUID()}` } : { ...b, citations: null }));
    return {
      id: "msg",
      type: "message",
      role: "assistant",
      model: req.model,
      content,
      stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    } as unknown as Anthropic.Beta.BetaMessage;
  };
  return { model, requests, left: () => turns.length };
}

async function say(actor: Actor, text: string, model: NetsModel, context?: string) {
  const r = await postNetsMessage(t.app, actor, { requestId: randomUUID(), text, context });
  if (r.queued) await processNetsTurn(t.app, { organizationId: actor.organizationId, userId: actor.userId, messageId: r.id }, { model });
  return (await listNetsMessages(t.app, actor)).messages.at(-1)!;
}

describe("Netz", () => {
  it("só as ferramentas do dia a dia vêm abertas; o resto fica atrás da busca", async () => {
    const s = script([{ type: "text", text: "oi" }]);
    await say(owner, "oi", s.model);
    const tools = s.requests[0]!.tools as Array<{ name: string; type?: string; defer_loading?: boolean }>;
    assert.equal(tools[0]!.name, "tool_search_tool_bm25");
    assert.ok(!tools.find((d) => d.name === "sales_create")!.defer_loading);
    assert.equal(tools.find((d) => d.name === "commissions_panel")!.defer_loading, true);
  });

  it("se a API recusar a busca, responde com todas as ferramentas abertas", async () => {
    const s = script([{ type: "text", text: "oi de novo" }]);
    let calls = 0;
    const model: NetsModel = async (req) => {
      if (calls++ === 0) throw new Anthropic.BadRequestError(400, undefined, "tool search not supported", new Headers());
      return s.model(req);
    };
    const reply = await say(owner, "oi", model);
    assert.equal(reply.body, "oi de novo");
    assert.ok(!(s.requests[0]!.tools as Array<{ defer_loading?: boolean }>).some((d) => d.defer_loading));
  });

  it("lista colada vira um cartão só e cada pedido usa o cache", async () => {
    const nomes = ["Lote Ana", "Lote Bruno", "Lote Carla"];
    const s = script(
      [
        { type: "text", text: "Vou cadastrar os 3 de uma vez." },
        { type: "tool_use", name: "propor_lote", input: { _resumo: "Cadastrar 3 clientes", ferramenta: "customers_create", itens: nomes.map((name) => ({ name })) } },
      ],
      [{ type: "text", text: "Confirme no cartão." }],
    );
    const reply = await say(owner, nomes.join("\n"), s.model);
    assert.equal(reply.action!.title, "Cadastrar 3 clientes");
    // Hora na própria mensagem (o topo não muda) e cache até a última mensagem.
    assert.match(JSON.stringify(s.requests[0]!.messages[0]), /^\{"role":"user","content":"\[\d\d\/\d\d,? \d\d:\d\d\]/);
    assert.deepEqual(s.requests[0]!.cache_control, { type: "ephemeral" });
    assert.ok(!JSON.stringify(s.requests[0]!.system).match(/\d\d:\d\d/));
    assert.equal((await runService(t.app, listCustomers, owner, { search: "Lote" })).length, 0);

    assert.deepEqual(await decideNetsAction(t.app, owner, { id: reply.id, decision: "confirm" }), { status: "done", queued: true });
    assert.equal((await runService(t.app, listCustomers, owner, { search: "Lote" })).length, 3);
    // Sem próximo passo, o sistema responde sozinho: nenhuma chamada à IA.
    const c = script();
    await processNetsTurn(t.app, { organizationId: owner.organizationId, userId: owner.userId, messageId: reply.id }, { model: c.model });
    assert.equal(c.requests.length, 0);
    assert.equal((await listNetsMessages(t.app, owner)).messages.at(-1)!.body, "Pronto! 3 de 3 feitos: Cadastrar 3 clientes.");
  });

  it("começa no modelo rápido e passa para o forte quando precisa pensar", async () => {
    const s = script(
      [{ type: "tool_use", name: "pensar_com_calma", input: { motivo: "comparar meses" } }],
      [{ type: "text", text: "Outubro vendeu mais." }],
    );
    const reply = await say(owner, "compara outubro com setembro", s.model);
    assert.equal(reply.body, "Outubro vendeu mais.");
    assert.equal(s.requests[0]!.model, NETS_FAST_MODEL);
    assert.equal(s.requests[1]!.model, NETS_MODEL);
  });

  it("não repete o mesmo parágrafo de passos diferentes", () => {
    assert.equal(joinReply(["Cadastrado, faltam 2.", "cadastrado,  faltam 2.\n\nPronto."]), "Cadastrado, faltam 2.\n\nPronto.");
  });

  it("lote com item inválido volta para a Netz corrigir", async () => {
    const s = script(
      [{ type: "tool_use", name: "propor_lote", input: { _resumo: "x", ferramenta: "customers_create", itens: [{ name: "Ok" }, { name: "" }] } }],
      [{ type: "text", text: "O segundo está sem nome." }],
    );
    const reply = await say(owner, "cadastra", s.model);
    assert.equal(reply.action, null);
    assert.match(JSON.stringify(s.requests[1]!.messages.at(-1)), /item 2/);
  });

  it("sem a chave, responde que ainda não está ligada", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await postNetsMessage(t.app, owner, { requestId: randomUUID(), text: "oi" });
    assert.equal(r.queued, false);
    const { messages, enabled, pending } = await listNetsMessages(t.app, owner);
    assert.equal(enabled, false);
    assert.equal(pending, false);
    assert.match(messages.at(-1)!.body, /ANTHROPIC_API_KEY/);
  });

  it("consulta na hora, mas cadastrar vira proposta até a pessoa confirmar", async () => {
    const s = script(
      [{ type: "tool_use", name: "products_list", input: { search: "Açaí" } }],
      [
        { type: "text", text: "Não achei. Vou cadastrar a lata de açaí por R$ 60." },
        {
          type: "tool_use",
          name: "products_create",
          input: { _resumo: "Cadastrar Lata de açaí por R$ 60,00", _continua: true, sku: "LATA", name: "Lata de açaí", unitId: un, salePrice: "60", costPrice: "0", minStock: "0" },
        },
      ],
      [{ type: "text", text: "Confirme no cartão." }],
    );
    const reply = await say(owner, "cadastra a lata de açaí a 60 reais", s.model, "Produtos");
    assert.equal(s.left(), 0);
    assert.equal(reply.action!.title, "Cadastrar Lata de açaí por R$ 60,00");
    assert.equal(reply.actionStatus, "pending");
    assert.match(reply.body, /Não achei/);
    // A tela aberta vai junto e a consulta voltou para o modelo.
    assert.match(JSON.stringify(s.requests[0]!.messages), /\[Tela: Produtos\]/);
    assert.match(JSON.stringify(s.requests[1]!.messages.at(-1)), /tool_result/);
    assert.equal((await runService(t.app, listProducts, owner, { search: "Lata" })).length, 0);

    const done = await decideNetsAction(t.app, owner, { id: reply.id, decision: "confirm" });
    assert.deepEqual(done, { status: "done", queued: true });
    assert.equal((await runService(t.app, listProducts, owner, { search: "Lata" })).length, 1);
    await assert.rejects(decideNetsAction(t.app, owner, { id: reply.id, decision: "confirm" }), rejectsWith("conflict"));

    // Depois de confirmar, a Netz continua a conversa com o resultado.
    const c = script([{ type: "text", text: "Pronto, a lata está cadastrada." }]);
    await processNetsTurn(t.app, { organizationId: owner.organizationId, userId: owner.userId, messageId: reply.id }, { model: c.model });
    const last = c.requests[0]!.messages;
    assert.match(JSON.stringify(last.at(-2)), /confirmada e executada/);
    assert.match(JSON.stringify(last.at(-1)), /confirmou/);
    const { messages, pending } = await listNetsMessages(t.app, owner);
    assert.equal(pending, false);
    assert.equal(messages.at(-1)!.body, "Pronto, a lata está cadastrada.");
  });

  it("cancelar não faz nada; mensagem nova invalida a proposta esquecida", async () => {
    const propose = (sku: string) =>
      script(
        [{ type: "tool_use", name: "products_create", input: { _resumo: `Cadastrar ${sku}`, sku, name: `Produto ${sku}`, unitId: un, salePrice: "1", costPrice: "0", minStock: "0" } }],
        [{ type: "text", text: "Confirme." }],
      ).model;
    const a = await say(owner, "cadastra A", propose("AAA"));
    assert.deepEqual(await decideNetsAction(t.app, owner, { id: a.id, decision: "cancel" }), { status: "cancelled", queued: false });
    assert.equal((await runService(t.app, listProducts, owner, { search: "AAA" })).length, 0);

    const b = await say(owner, "cadastra B", propose("BBB"));
    await say(owner, "deixa pra lá", script([{ type: "text", text: "Tudo bem." }]).model);
    const old = (await listNetsMessages(t.app, owner)).messages.find((m) => m.id === b.id)!;
    assert.equal(old.actionStatus, "expired");
    await assert.rejects(decideNetsAction(t.app, owner, { id: b.id, decision: "confirm" }), rejectsWith("conflict"));
  });

  it("dados inválidos voltam como erro para a Netz corrigir, sem cartão", async () => {
    const s = script(
      [{ type: "tool_use", name: "products_create", input: { _resumo: "x", sku: "X", name: "X", unitId: un, salePrice: "abc", costPrice: "0", minStock: "0" } }],
      [{ type: "text", text: "O preço ficou estranho, qual é?" }],
    );
    const reply = await say(owner, "cadastra X", s.model);
    assert.equal(reply.action, null);
    assert.match(JSON.stringify(s.requests[1]!.messages.at(-1)), /is_error/);
  });

  it("só oferece o que a pessoa pode fazer", async () => {
    const viewer = await addUserWithRole(t.app, owner, "viewer", "Consulta");
    const names = netsTools(viewer.actor).definitions.map((d) => d.name);
    assert.ok(names.includes("products_list"));
    assert.ok(!names.includes("products_create"));
    assert.ok(!netsTools(owner).definitions.some((d) => d.name === "members_add"));
    const s = script(
      [{ type: "tool_use", name: "products_create", input: { _resumo: "x", sku: "Y", name: "Y", unitId: un, salePrice: "1", costPrice: "0", minStock: "0" } }],
      [{ type: "text", text: "Você não tem permissão para cadastrar." }],
    );
    const reply = await say(viewer.actor, "cadastra Y", s.model);
    assert.equal(reply.action, null);
    assert.match(JSON.stringify(s.requests[1]!.messages.at(-1)), /indispon/);
    // Conversa é privada.
    assert.ok(!(await listNetsMessages(t.app, viewer.actor)).messages.some((m) => m.body === "cadastra A"));
  });

  it("registra melhoria quando esbarra em algo", async () => {
    const s = script(
      [
        {
          type: "tool_use",
          name: "registrar_melhoria",
          input: { title: "Emitir nota fiscal", kind: "suggestion", module: "comercial", problem: "Não emite NF-e", proposal: "Emitir NF-e na venda" },
        },
      ],
      [{ type: "text", text: "Ainda não emito nota; registrei o pedido." }],
    );
    await say(owner, "emite a nota da venda 1", s.model);
    assert.match(JSON.stringify(s.requests[1]!.messages.at(-1)), /pedido n/);
  });

  it("uma mensagem por vez", async () => {
    const r = await postNetsMessage(t.app, owner, { requestId: randomUUID(), text: "primeira" });
    assert.equal(r.queued, true);
    await assert.rejects(postNetsMessage(t.app, owner, { requestId: randomUUID(), text: "segunda" }), rejectsWith("conflict"));
    await processNetsTurn(t.app, { organizationId: owner.organizationId, userId: owner.userId, messageId: r.id }, { model: script([{ type: "text", text: "ok" }]).model });
    assert.equal((await listNetsMessages(t.app, owner)).pending, false);
  });
});
