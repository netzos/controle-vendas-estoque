import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import {
  createTelegramLink,
  getTelegramStatus,
  handleTelegramUpdate,
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
    assert.match(f.sent()[0]!, /Conectar/);
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
    assert.match(f.sent().at(-1)!, /Conectar/);
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
});

describe("Microfone do balão da Netz", () => {
  it("transcreve com a mesma API do Telegram e respeita a permissão", async () => {
    const data = new TextEncoder().encode("audio");
    await assert.rejects(transcribeForNets(owner, { data, mimeType: "audio/webm" }), /OPENAI_API_KEY/);
    const names: string[] = [];
    setTranscriber(async (a) => {
      names.push(a.fileName);
      return "  vendi 3 latas pro João  ";
    });
    try {
      assert.deepEqual(await transcribeForNets(owner, { data, mimeType: "audio/mp4" }), { text: "vendi 3 latas pro João" });
      await transcribeForNets(owner, { data, mimeType: "audio/webm;codecs=opus" });
      assert.deepEqual(names, ["fala.m4a", "fala.webm"]);
      await assert.rejects(transcribeForNets(owner, { data: new Uint8Array(0), mimeType: "audio/webm" }), /Não chegou/);
      const noNets: Actor = { ...owner, isOwner: false, permissions: new Set<string>() };
      await assert.rejects(transcribeForNets(noNets, { data, mimeType: "audio/webm" }), /permissão/);
    } finally {
      setTranscriber(null);
    }
  });
});
