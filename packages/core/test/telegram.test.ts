import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import {
  approveSignup,
  createMemberTelegramLink,
  rejectSignup,
  requestSignup,
  createTelegramLink,
  getTelegramStatus,
  cleanReply,
  handleTelegramUpdate,
  listNetsDeliveries,
  listNetsMessages,
  listProducts,
  listUnits,
  runService,
  setTranscriber,
  transcribeForNets,
  type Actor,
  type NetsModel,
  type TelegramApi,
  type TelegramUpdate,
} from "../src/index.ts";
import { actorFor, addUserWithRole, seedCompany, setupTestDb, type TestDb } from "./helpers.ts";

let t: TestDb;
let owner: Actor;
let un: string;
let nextUpdate = 1000;

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "Relojoaria");
  owner = await actorFor(t.app, a.userId, a.organizationId);
  un = (await runService(t.app, listUnits, owner, {})).find((u) => u.code === "UN")!.id;
});
after(() => t.close());
beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "teste";
  process.env.TELEGRAM_BOT_TOKEN = "123:teste";
  delete process.env.OPENAI_API_KEY;
  delete process.env.GROQ_API_KEY;
});

// Telegram falso: guarda o que o robô mandou.
function fakeApi() {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let webhook = "";
  let id = 1;
  const api: TelegramApi = {
    async call<T>(method: string, params: Record<string, unknown> = {}) {
      calls.push({ method, params });
      if (method === "getMe") return { username: "netzsales_bot" } as T;
      if (method === "getWebhookInfo") return { url: webhook } as T;
      if (method === "setWebhook") webhook = String(params.url);
      if (method === "sendMessage") return { message_id: id++ } as T;
      if (method === "getFile") return { file_path: `voice/${String(params.file_id)}.oga` } as T;
      return true as T;
    },
    async download(filePath: string) {
      calls.push({ method: "download", params: { filePath } });
      return new TextEncoder().encode("audio");
    },
  };
  const sent = () => calls.filter((c) => c.method === "sendMessage").map((c) => String(c.params.text));
  return { api, calls, sent };
}

type Block = { type: "text"; text: string } | { type: "tool_use"; name: string; input: Record<string, unknown> };
function script(...turns: Block[][]): NetsModel {
  return async (req: Anthropic.Beta.MessageCreateParamsNonStreaming) => {
    const blocks = turns.shift();
    assert.ok(blocks, "o modelo foi chamado mais vezes que o roteiro");
    const content = blocks.map((b) => (b.type === "tool_use" ? { ...b, id: `tu_${randomUUID()}` } : { ...b, citations: null }));
    return {
      id: "msg", type: "message", role: "assistant", model: req.model, content,
      stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
      stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
    } as unknown as Anthropic.Beta.BetaMessage;
  };
}

const tgUser = { id: 777, first_name: "Pepe", username: "pepe" };
const text = (body: string, from = tgUser): TelegramUpdate => ({
  update_id: nextUpdate++,
  message: { message_id: nextUpdate, chat: { id: from.id, type: "private" }, from, text: body },
});

describe("Netz no Telegram", () => {
  it("sem ligar a conta, o robô explica como conectar", async () => {
    const f = fakeApi();
    await handleTelegramUpdate(t.app, text("oi"), { api: f.api });
    assert.match(f.sent()[0]!, /botão Telegram/);
  });

  it("liga a conta pelo link, conversa e confirma pelo botão", async () => {
    const f = fakeApi();
    const { url } = await createTelegramLink(t.app, owner, { api: f.api });
    assert.match(url, /^https:\/\/t\.me\/netzsales_bot\?start=[\w-]{20,}$/);
    assert.ok(f.calls.some((c) => c.method === "setWebhook" && String(c.params.url).endsWith("/api/telegram/webhook") && c.params.secret_token));
    const code = url.split("start=")[1]!;

    await handleTelegramUpdate(t.app, text(`/start ${code}`), { api: f.api });
    assert.match(f.sent().at(-1)!, /ligada à empresa Relojoaria/);
    assert.equal((await getTelegramStatus(t.app, owner)).link?.username, "pepe");
    // O mesmo código não serve duas vezes.
    await handleTelegramUpdate(t.app, text(`/start ${code}`, { id: 888, first_name: "Outro", username: "x" }), { api: f.api });
    assert.match(f.sent().at(-1)!, /já foi usado ou venceu/);

    const model = script(
      [{ type: "tool_use", name: "products_create", input: { _resumo: "Cadastrar Relógio Orient por R$ 900", sku: "ORI", name: "Relógio Orient", unitId: un, salePrice: "900", costPrice: "500", minStock: "0" } }],
      [{ type: "text", text: "Vou cadastrar o relógio." }],
    );
    const upd = text("cadastra o relógio orient a 900");
    await handleTelegramUpdate(t.app, upd, { api: f.api, model });
    const card = f.calls.filter((c) => c.method === "sendMessage").at(-1)!;
    assert.match(String(card.params.text), /Vou cadastrar o relógio\.\n\n👉 Cadastrar Relógio Orient/);
    const buttons = (card.params.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard[0]!;
    assert.equal(buttons.length, 2);
    // O Telegram reenviou o mesmo update: não responde de novo.
    const before = f.sent().length;
    await handleTelegramUpdate(t.app, upd, { api: f.api, model });
    assert.equal(f.sent().length, before);
    // A conversa é a mesma do balão do painel.
    const { messages } = await listNetsMessages(t.app, owner);
    assert.equal(messages.at(-1)!.actionStatus, "pending");

    const done = script([{ type: "text", text: "Pronto, cadastrado." }]);
    await handleTelegramUpdate(
      t.app,
      { update_id: nextUpdate++, callback_query: { id: "cb1", from: tgUser, data: buttons[0]!.callback_data, message: { message_id: 5, chat: { id: 777, type: "private" } } } },
      { api: f.api, model: done },
    );
    assert.equal((await runService(t.app, listProducts, owner, { search: "Orient" })).length, 1);
    assert.equal(f.sent().at(-1), "Pronto, cadastrado.");
    assert.ok(f.calls.some((c) => c.method === "editMessageReplyMarkup"));
    assert.ok(f.calls.some((c) => c.method === "answerCallbackQuery" && c.params.text === "Feito"));
  });

  it("outra pessoa não usa o botão de quem não é ela; /sair desliga", async () => {
    const f = fakeApi();
    const other = await addUserWithRole(t.app, owner, "sales", "Vendedora");
    const { url } = await createTelegramLink(t.app, other.actor, { api: f.api });
    const ana = { id: 999, first_name: "Ana", username: "ana" };
    await handleTelegramUpdate(t.app, text(`/start ${url.split("start=")[1]}`, ana), { api: f.api });
    const { messages } = await listNetsMessages(t.app, owner);
    const pending = [...messages].reverse().find((m) => m.actionStatus);
    await handleTelegramUpdate(
      t.app,
      { update_id: nextUpdate++, callback_query: { id: "cb2", from: ana, data: `nets:c:${pending!.id}` } },
      { api: f.api },
    );
    assert.ok(f.calls.some((c) => c.method === "answerCallbackQuery" && /não está mais esperando/.test(String(c.params.text))));
    await handleTelegramUpdate(t.app, text("/sair", ana), { api: f.api });
    assert.equal((await getTelegramStatus(t.app, other.actor)).link, null);
    await handleTelegramUpdate(t.app, text("oi", ana), { api: f.api });
    assert.match(f.sent().at(-1)!, /botão Telegram/);
  });

  it("link do Telegram de outra pessoa (Ajustes › Usuários) liga a conta dela", async () => {
    const f = fakeApi();
    const other = await addUserWithRole(t.app, owner, "sales", "Bia");
    await assert.rejects(createMemberTelegramLink(t.app, other.actor, other.membershipId, { api: f.api }));
    const invite = await createMemberTelegramLink(t.app, owner, other.membershipId, { api: f.api });
    assert.equal(invite.days, 7);
    const bia = { id: 1234, first_name: "Bia", username: "bia" };
    await handleTelegramUpdate(t.app, text(`/start ${invite.url.split("start=")[1]}`, bia), { api: f.api });
    assert.match(f.sent().at(-1)!, /ligada à empresa Relojoaria/);
    const status = await getTelegramStatus(t.app, other.actor, { api: f.api });
    assert.equal(status.link?.username, "bia");
    assert.equal(status.botUrl, "https://t.me/netzsales_bot");
  });

  it("grupo e áudio recebem aviso", async () => {
    const f = fakeApi();
    await handleTelegramUpdate(t.app, { update_id: nextUpdate++, message: { message_id: 1, chat: { id: -5, type: "group" }, from: tgUser, text: "oi" } }, { api: f.api });
    assert.match(f.sent()[0]!, /privado/);
    await handleTelegramUpdate(t.app, { update_id: nextUpdate++, message: { message_id: 2, chat: { id: 777, type: "private" }, from: tgUser } }, { api: f.api });
    assert.match(f.sent()[1]!, /texto e áudio/);
  });

  it("áudio é transcrito e vira mensagem para a Netz", async () => {
    const f = fakeApi();
    const { url } = await createTelegramLink(t.app, owner, { api: f.api });
    await handleTelegramUpdate(t.app, text(`/start ${url.split("start=")[1]}`), { api: f.api });
    const heard: string[] = [];
    const transcribe = async (a: { fileName: string }) => {
      heard.push(a.fileName);
      return "quanto tenho de estoque do orient";
    };
    const model = script([{ type: "text", text: "Você tem 0 unidades." }]);
    const voice = (extra: Partial<TelegramUpdate["message"] & object> = {}): TelegramUpdate => ({
      update_id: nextUpdate++,
      message: { message_id: nextUpdate, chat: { id: 777, type: "private" }, from: tgUser, voice: { file_id: "abc", duration: 4 }, ...extra },
    });
    await handleTelegramUpdate(t.app, voice(), { api: f.api, model, transcribe });
    assert.deepEqual(heard, ["voz.ogg"]);
    assert.ok(f.calls.some((c) => c.method === "download" && c.params.filePath === "voice/abc.oga"));
    // Sem eco da transcrição: só a resposta.
    assert.ok(!f.sent().some((m) => m.includes("Entendi")));
    assert.equal(f.sent().at(-1), "Você tem 0 unidades.");
    const { messages } = await listNetsMessages(t.app, owner);
    const asked = messages.filter((m) => m.role === "user").at(-1)!;
    assert.equal(asked.body, "quanto tenho de estoque do orient");
    assert.match(asked.context ?? "", /voz/);

    // Longo demais: avisa sem baixar.
    await handleTelegramUpdate(t.app, voice({ voice: { file_id: "longo", duration: 3600 } }), { api: f.api, transcribe });
    assert.match(f.sent().at(-1)!, /longo demais/);
    // Sem chave de transcrição: pede texto.
    await handleTelegramUpdate(t.app, voice(), { api: f.api });
    assert.match(f.sent().at(-1)!, /não consigo ouvir/);
  });

  it("tira marcação interna da resposta e guarda o texto exato entregue (pedidos 7 e 8)", async () => {
    const f = fakeApi();
    const { url } = await createTelegramLink(t.app, owner, { api: f.api });
    await handleTelegramUpdate(t.app, text(`/start ${url.split("start=")[1]}`), { api: f.api });
    const model = script([{ type: "text", text: "antml:reasoning_effort>\nOi, Pepe! Estou funcionando por aqui." }]);
    await handleTelegramUpdate(t.app, text("Teste"), { api: f.api, model });
    assert.equal(f.sent().at(-1), "Oi, Pepe! Estou funcionando por aqui.");

    const [last] = await listNetsDeliveries(t.app, owner, 1);
    assert.equal(last!.painel, "Oi, Pepe! Estou funcionando por aqui.");
    assert.equal(last!.canais[0]!.canal, "Telegram");
    assert.equal(last!.canais[0]!.texto, "Oi, Pepe! Estou funcionando por aqui.");
    assert.equal(last!.canais[0]!.situacao, "entregue");
    assert.deepEqual(last!.removido, ["antml:reasoning_effort>"]);

    // A Netz confere sozinha o que chegou, sem pedir print.
    const check = script(
      [{ type: "tool_use", name: "ver_mensagens_entregues", input: { limit: 2 } }],
      [{ type: "text", text: "Conferi: chegou limpo." }],
    );
    await handleTelegramUpdate(t.app, text("veio um código estranho?"), { api: f.api, model: check });
    assert.equal(f.sent().at(-1), "Conferi: chegou limpo.");
  });

  it("limpeza não mexe em texto normal", () => {
    assert.deepEqual(cleanReply("> citação\nTexto <b>normal</b> com 3 > 2."), { text: "> citação\nTexto <b>normal</b> com 3 > 2.", removed: [] });
    assert.equal(cleanReply("<thinking>pensando</thinking>Resposta").text, "Resposta");
  });
});

describe("Telegram logo no pedido de conta", () => {
  it("o robô reconhece o pedido em análise e avisa quando é aprovado, com a conta já ligada", async () => {
    await t.owner.query("INSERT INTO controle_vendas_estoque.platform_developers (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [owner.userId]);
    const f = fakeApi();
    const r = await requestSignup(t.app, { name: "Carla Dias", email: "carla@loja.com", organizationName: "Loja da Carla", password: "senha-da-carla-123" }, null, { api: f.api });
    assert.match(r.telegramUrl!, /^https:\/\/t\.me\/netzsales_bot\?start=c_[\w-]{20,}$/);
    const carla = { id: 4321, first_name: "Carla", username: "carla" };
    await handleTelegramUpdate(t.app, text(`/start ${r.telegramUrl!.split("start=")[1]}`, carla), { api: f.api });
    assert.match(f.sent().at(-1)!, /Loja da Carla\. Ele está aguardando aprovação/);
    await handleTelegramUpdate(t.app, text("oi", carla), { api: f.api });
    assert.match(f.sent().at(-1)!, /ainda está aguardando aprovação/);
    // Outra conta do Telegram não usa o mesmo link.
    await handleTelegramUpdate(t.app, text(`/start ${r.telegramUrl!.split("start=")[1]}`, { id: 5555, first_name: "X", username: "x" }), { api: f.api });
    assert.match(f.sent().at(-1)!, /outra conta do Telegram/);

    const [req] = (await t.app.query<{ id: string }>("SELECT id FROM controle_vendas_estoque.signup_requests WHERE email = 'carla@loja.com'")).rows;
    const ok = await approveSignup(t.app, owner, req!.id, { api: f.api });
    assert.equal(ok.telegramLinked, true);
    assert.equal(ok.telegramUrl, null);
    assert.match(f.sent().at(-1)!, /Sua conta da Loja da Carla foi aprovada e já está ligada aqui/);
    const linked = await t.app.query("SELECT 1 FROM controle_vendas_estoque.telegram_links WHERE telegram_user_id = 4321 AND status = 'active'");
    assert.equal(linked.rowCount, 1);
  });

  it("recusa também é avisada no Telegram", async () => {
    const f = fakeApi();
    const r = await requestSignup(t.app, { name: "Davi", email: "davi@loja.com", organizationName: "Loja do Davi", password: "senha-do-davi-123" }, null, { api: f.api });
    const davi = { id: 6789, first_name: "Davi", username: "davi" };
    await handleTelegramUpdate(t.app, text(`/start ${r.telegramUrl!.split("start=")[1]}`, davi), { api: f.api });
    const [req] = (await t.app.query<{ id: string }>("SELECT id FROM controle_vendas_estoque.signup_requests WHERE email = 'davi@loja.com'")).rows;
    await rejectSignup(t.app, owner, req!.id, null, { api: f.api });
    assert.match(f.sent().at(-1)!, /não foi aprovado/);
  });
});

describe("Aprovar cadastros pelo Telegram", () => {
  it("o administrador recebe o pedido com Aprovar e Recusar e decide por lá", async () => {
    await t.owner.query("INSERT INTO controle_vendas_estoque.platform_developers (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [owner.userId]);
    const f = fakeApi();
    const { url } = await createTelegramLink(t.app, owner, { api: f.api });
    await handleTelegramUpdate(t.app, text(`/start ${url.split("start=")[1]}`), { api: f.api });

    await requestSignup(t.app, { name: "Eva Lima", email: "eva@loja.com", whatsapp: "(91) 97777-6666", organizationName: "Loja da Eva", password: "senha-da-eva-123" }, null, { api: f.api });
    const card = f.calls.find((c) => c.method === "sendMessage" && /Pedido de conta/.test(String(c.params.text)))!;
    assert.equal(String(card.params.chat_id), "777");
    assert.match(String(card.params.text), /Loja da Eva[\s\S]*eva@loja\.com[\s\S]*Posso liberar\?/);
    const [approveBtn, rejectBtn] = (card.params.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard[0]!;

    // Quem não é administrador não decide.
    await handleTelegramUpdate(t.app, { update_id: nextUpdate++, callback_query: { id: "s0", from: { id: 4242, first_name: "Z" }, data: approveBtn!.callback_data } }, { api: f.api });
    assert.ok(f.calls.some((c) => c.method === "answerCallbackQuery" && /Só o administrador/.test(String(c.params.text))));

    await handleTelegramUpdate(
      t.app,
      { update_id: nextUpdate++, callback_query: { id: "s1", from: tgUser, data: approveBtn!.callback_data, message: { message_id: 9, chat: { id: 777, type: "private" } } } },
      { api: f.api },
    );
    const done = f.calls.filter((c) => c.method === "sendMessage").at(-1)!;
    assert.match(String(done.params.text), /Aprovado\. A Loja da Eva já está liberada/);
    assert.match(JSON.stringify(done.params.reply_markup), /wa\.me\/5591977776666/);
    const st = await t.app.query<{ status: string }>("SELECT status FROM controle_vendas_estoque.signup_requests WHERE email = 'eva@loja.com'");
    assert.equal(st.rows[0]!.status, "approved");
    // Tocar de novo não aprova duas vezes.
    await handleTelegramUpdate(t.app, { update_id: nextUpdate++, callback_query: { id: "s2", from: tgUser, data: approveBtn!.callback_data } }, { api: f.api });
    assert.match(f.sent().at(-1)!, /já foi decidido/);
    assert.ok(rejectBtn!.callback_data.startsWith("signup:r:"));

    await requestSignup(t.app, { name: "Fabio", email: "fabio@loja.com", organizationName: "Loja do Fabio", password: "senha-do-fabio-123" }, null, { api: f.api });
    const card2 = f.calls.filter((c) => c.method === "sendMessage" && /Loja do Fabio/.test(String(c.params.text))).at(-1)!;
    const reject = (card2.params.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard[0]![1]!;
    await handleTelegramUpdate(t.app, { update_id: nextUpdate++, callback_query: { id: "s3", from: tgUser, data: reject.callback_data } }, { api: f.api });
    assert.equal(f.sent().at(-1), "Pedido recusado.");
  });
});

describe("Microfone do balão da Netz", () => {
  it("transcreve com a mesma API do Telegram e respeita a permissão", async () => {
    const data = new TextEncoder().encode("audio");
    await assert.rejects(transcribeForNets(t.app, owner, { data, mimeType: "audio/webm" }), /OPENAI_API_KEY/);
    const names: string[] = [];
    setTranscriber(async (a) => {
      names.push(a.fileName);
      return "  vendi 3 latas pro João  ";
    });
    try {
      assert.deepEqual(await transcribeForNets(t.app, owner, { data, mimeType: "audio/mp4" }), { text: "vendi 3 latas pro João" });
      await transcribeForNets(t.app, owner, { data, mimeType: "audio/webm;codecs=opus" });
      assert.deepEqual(names, ["fala.m4a", "fala.webm"]);
      await assert.rejects(transcribeForNets(t.app, owner, { data: new Uint8Array(0), mimeType: "audio/webm" }), /Não chegou/);
      const noNets: Actor = { ...owner, isOwner: false, permissions: new Set<string>() };
      await assert.rejects(transcribeForNets(t.app, noNets, { data, mimeType: "audio/webm" }), /permissão/);
    } finally {
      setTranscriber(null);
    }
  });
});
