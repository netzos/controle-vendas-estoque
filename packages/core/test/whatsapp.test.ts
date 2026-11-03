import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import {
  approveSignup,
  createMemberWhatsAppLink,
  createWhatsAppLink,
  createWhatsAppQr,
  getWhatsAppPlatformStatus,
  getWhatsAppStatus,
  handleWhatsAppEvent,
  listNetsDeliveries,
  listNetsMessages,
  listProducts,
  listUnits,
  requestSignup,
  runService,
  verifyWhatsAppSignature,
  type Actor,
  type NetsModel,
  type WhatsAppApi,
  type WhatsAppEvent,
} from "../src/index.ts";
import { actorFor, addUserWithRole, seedCompany, setupTestDb, type TestDb } from "./helpers.ts";

let t: TestDb;
let owner: Actor;
let un: string;
let nextId = 1;

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "Relojoaria");
  owner = await actorFor(t.app, a.userId, a.organizationId);
  un = (await runService(t.app, listUnits, owner, {})).find((u) => u.code === "UN")!.id;
});
after(() => t.close());
beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "teste";
  process.env.WHATSAPP_GOWA_URL = "https://ponte.teste";
  process.env.WHATSAPP_WEBHOOK_SECRET = "segredo";
  delete process.env.WHATSAPP_DEVICE_ID;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GROQ_API_KEY;
});

// Ponte falsa: guarda o que a Netz mandou.
function fakeApi(opts: { loggedIn?: boolean } = {}) {
  const sent: { jid: string; text: string }[] = [];
  const state = { loggedIn: opts.loggedIn ?? true, qr: 0, typing: 0 };
  const api: WhatsAppApi = {
    async status() {
      return { connected: state.loggedIn, loggedIn: state.loggedIn, phone: state.loggedIn ? "5591900000000" : null };
    },
    async loginQr() {
      state.qr++;
      return { image: "data:image/png;base64,AAA", expiresIn: 30 };
    },
    async logout() {
      state.loggedIn = false;
    },
    async send(jid, text) {
      sent.push({ jid, text });
    },
    async typing() {
      state.typing++;
    },
    async download(path) {
      return { data: new TextEncoder().encode(`audio:${path}`), mimeType: "audio/ogg" };
    },
  };
  const texts = () => sent.map((s) => s.text);
  return { api, sent, texts, state };
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

const PEPE = "5591988887777@s.whatsapp.net";
const msg = (body: string, from = PEPE, extra: Partial<NonNullable<WhatsAppEvent["payload"]>> = {}): WhatsAppEvent => ({
  event: "message",
  device_id: "netzsales",
  payload: { id: `M${nextId++}`, chat_id: from, from, from_name: "Pepe Silva", body, is_from_me: false, ...extra },
});
const codeOf = (url: string) => decodeURIComponent(url.split("text=")[1]!);

describe("Netz no WhatsApp", () => {
  it("assinatura do aviso da ponte", () => {
    const body = JSON.stringify({ event: "message" });
    const sig = `sha256=${createHmac("sha256", "segredo").update(body).digest("hex")}`;
    assert.equal(verifyWhatsAppSignature(body, sig), true);
    assert.equal(verifyWhatsAppSignature(body + " ", sig), false);
    assert.equal(verifyWhatsAppSignature(body, null), false);
  });

  it("sem ligar a conta, explica como conectar; grupo, próprio número e outro aparelho são ignorados", async () => {
    const f = fakeApi();
    await handleWhatsAppEvent(t.app, msg("oi"), { api: f.api });
    assert.match(f.texts()[0]!, /botão do WhatsApp/);
    await handleWhatsAppEvent(t.app, msg("oi", "120363000000000000@g.us"), { api: f.api });
    await handleWhatsAppEvent(t.app, msg("oi", PEPE, { is_from_me: true }), { api: f.api });
    await handleWhatsAppEvent(t.app, { ...msg("oi"), device_id: "outro" }, { api: f.api });
    assert.equal(f.sent.length, 1);
  });

  it("liga a conta pelo link, conversa e confirma respondendo SIM", async () => {
    const f = fakeApi();
    const { url } = await createWhatsAppLink(t.app, owner, { api: f.api });
    assert.match(url, /^https:\/\/wa\.me\/5591900000000\?text=/);
    const first = codeOf(url);
    assert.match(first, /Código: NS-[\w-]{24}$/);

    await handleWhatsAppEvent(t.app, msg(first), { api: f.api });
    assert.match(f.texts().at(-1)!, /ligado à empresa Relojoaria/);
    assert.equal((await getWhatsAppStatus(t.app, owner)).link?.phone, "5591988887777");
    // O mesmo código não serve duas vezes.
    await handleWhatsAppEvent(t.app, msg(first, "5591911112222@s.whatsapp.net"), { api: f.api });
    assert.match(f.texts().at(-1)!, /já foi usado ou venceu/);

    const model = script(
      [{ type: "tool_use", name: "products_create", input: { _resumo: "Cadastrar Relógio Casio por R$ 300", sku: "CAS", name: "Relógio Casio", unitId: un, salePrice: "300", costPrice: "150", minStock: "0" } }],
      [{ type: "text", text: "Vou cadastrar o relógio." }],
    );
    const ask = msg("cadastra o casio a 300");
    await handleWhatsAppEvent(t.app, ask, { api: f.api, model });
    assert.match(f.texts().at(-1)!, /Vou cadastrar o relógio\.\n\n👉 Cadastrar Relógio Casio[\s\S]*Responda SIM/);
    assert.ok(f.state.typing >= 2, "mostra digitando e para");
    // A ponte avisou a mesma mensagem de novo: não responde duas vezes.
    const before = f.sent.length;
    await handleWhatsAppEvent(t.app, ask, { api: f.api, model });
    assert.equal(f.sent.length, before);
    const { messages } = await listNetsMessages(t.app, owner);
    assert.equal(messages.at(-1)!.actionStatus, "pending");

    await handleWhatsAppEvent(t.app, msg("Sim"), { api: f.api, model: script() });
    assert.equal((await runService(t.app, listProducts, owner, { search: "Casio" })).length, 1);
    assert.equal(f.texts().at(-1), "Pronto, feito: Cadastrar Relógio Casio por R$ 300.");
    const deliveries = await listNetsDeliveries(t.app, owner);
    assert.ok(deliveries.some((d) => d.canais.some((c) => c.canal === "WhatsApp" && c.situacao === "entregue")));
  });

  it("NÃO cancela a proposta", async () => {
    const f = fakeApi();
    const model = script(
      [{ type: "tool_use", name: "products_create", input: { _resumo: "Cadastrar Relógio Seiko", sku: "SEI", name: "Relógio Seiko", unitId: un, salePrice: "800", costPrice: "400", minStock: "0" } }],
      [{ type: "text", text: "Posso cadastrar?" }],
    );
    await handleWhatsAppEvent(t.app, msg("cadastra o seiko"), { api: f.api, model });
    await handleWhatsAppEvent(t.app, msg("não"), { api: f.api });
    assert.equal(f.texts().at(-1), "Cancelado. Nada foi alterado.");
    assert.equal((await runService(t.app, listProducts, owner, { search: "Seiko" })).length, 0);
  });

  it("áudio é baixado da ponte e transcrito", async () => {
    const f = fakeApi();
    let heard = "";
    const transcribe = async (a: { data: Uint8Array }) => {
      heard = new TextDecoder().decode(a.data);
      return "quanto tenho de estoque?";
    };
    const model = script([{ type: "text", text: "Você tem 1 relógio." }]);
    await handleWhatsAppEvent(t.app, msg("", PEPE, { audio: { path: "statics/media/voz.ogg" } }), { api: f.api, model, transcribe });
    assert.equal(heard, "audio:statics/media/voz.ogg");
    assert.equal(f.texts().at(-1), "Você tem 1 relógio.");
    const { messages } = await listNetsMessages(t.app, owner);
    assert.ok(messages.some((m) => m.body.includes("quanto tenho de estoque?")));
  });

  it("sair desliga", async () => {
    const f = fakeApi();
    await handleWhatsAppEvent(t.app, msg("sair"), { api: f.api });
    assert.match(f.texts().at(-1)!, /WhatsApp desligado/);
    assert.equal((await getWhatsAppStatus(t.app, owner)).link, null);
  });

  it("link de outra pessoa (Ajustes › Usuários) liga a conta dela", async () => {
    const f = fakeApi();
    const bia = await addUserWithRole(t.app, owner, "sales", "Bia");
    const invite = await createMemberWhatsAppLink(t.app, owner, bia.membershipId, { api: f.api });
    assert.equal(invite.days, 7);
    await handleWhatsAppEvent(t.app, msg(codeOf(invite.url), "5591933334444@s.whatsapp.net", { from_name: "Bia" }), { api: f.api });
    assert.match(f.texts().at(-1)!, /Pronto, Bia!/);
    const linked = await t.app.query("SELECT 1 FROM controle_vendas_estoque.whatsapp_links WHERE user_id = $1 AND status = 'active'", [bia.userId]);
    assert.equal(linked.rowCount, 1);
  });

  it("WhatsApp desconectado: botão avisa em vez de abrir", async () => {
    const f = fakeApi({ loggedIn: false });
    await assert.rejects(createWhatsAppLink(t.app, owner, { api: f.api }), /desconectado/);
  });
});

describe("Plataforma › WhatsApp", () => {
  it("só o administrador da plataforma vê o estado e gera o QR Code", async () => {
    const f = fakeApi({ loggedIn: false });
    await assert.rejects(getWhatsAppPlatformStatus(t.app, owner, { api: f.api }), /permiss|forbidden|acesso/i);
    await t.owner.query("INSERT INTO controle_vendas_estoque.platform_developers (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [owner.userId]);
    const s = await getWhatsAppPlatformStatus(t.app, owner, { api: f.api });
    assert.equal(s.configured, true);
    assert.equal(s.loggedIn, false);
    const qr = await createWhatsAppQr(t.app, owner, { api: f.api });
    assert.match(qr.image, /^data:image\/png;base64,/);
    f.state.loggedIn = true;
    await assert.rejects(createWhatsAppQr(t.app, owner, { api: f.api }), /já está conectado/);
  });

  it("aprovar o cadastro avisa no WhatsApp do pedido, com o link para ligar", async () => {
    await t.owner.query("INSERT INTO controle_vendas_estoque.platform_developers (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [owner.userId]);
    delete process.env.TELEGRAM_BOT_TOKEN;
    const f = fakeApi();
    await requestSignup(t.app, { name: "Gil Souza", email: "gil@loja.com", whatsapp: "(91) 96666-5555", organizationName: "Loja do Gil", password: "senha-do-gil-123" }, null);
    const [req] = (await t.app.query<{ id: string }>("SELECT id FROM controle_vendas_estoque.signup_requests WHERE email = 'gil@loja.com'")).rows;
    const ok = await approveSignup(t.app, owner, req!.id, { whatsapp: f.api });
    assert.equal(ok.whatsappSent, true);
    const notice = f.sent.at(-1)!;
    assert.equal(notice.jid, "5591966665555@s.whatsapp.net");
    assert.match(notice.text, /Loja do Gil foi aprovada[\s\S]*wa\.me\/5591900000000\?text=/);
    // Tocando no link, a mensagem com o código liga o WhatsApp do Gil.
    const url = /https:\/\/wa\.me\/\S+/.exec(notice.text)![0];
    await handleWhatsAppEvent(t.app, msg(codeOf(url), notice.jid, { from_name: "Gil" }), { api: f.api });
    assert.match(f.texts().at(-1)!, /ligado à empresa Loja do Gil/);
  });
});
