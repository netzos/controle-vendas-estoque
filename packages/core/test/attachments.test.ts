import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import {
  addSaleAttachment,
  AppError,
  createCustomer,
  createProduct,
  createSale,
  decideNetsAction,
  getSale,
  getSaleAttachment,
  listAuditLogs,
  listNetsMessages,
  listSaleAttachments,
  listUnits,
  netsTools,
  postNetsMessage,
  processNetsTurn,
  removeSaleAttachment,
  runAttachmentChecks,
  runService,
  stashSaleAttachment,
  type Actor,
  type NetsModel,
} from "../src/index.ts";
import { actorFor, addUserWithRole, enableAllFeatures, seedCompany, setupTestDb, type TestDb } from "./helpers.ts";

const rejectsWith = (code: string) => (err: unknown) => {
  assert.ok(err instanceof AppError, `esperava AppError, veio ${String(err)}`);
  assert.equal(err.code, code, err.message);
  return true;
};

const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const pdf = () => new Uint8Array(Buffer.from("%PDF-1.4\n1 0 obj\n"));

let t: TestDb;
let owner: Actor;
let other: Actor;
let saleId: string;
let installments: { id: string; number: number }[];

// Modelo de mentira: devolve o JSON da conferência (ou as respostas da Netz, em ordem).
function reply(...texts: Array<string | { tool: string; input: Record<string, unknown> }>) {
  const requests: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  const model: NetsModel = async (req) => {
    requests.push(structuredClone(req));
    const next = texts.shift();
    assert.ok(next !== undefined, "o modelo foi chamado mais vezes que o roteiro");
    const content = typeof next === "string"
      ? [{ type: "text", text: next, citations: null }]
      : [{ type: "tool_use", id: `tu_${randomUUID()}`, name: next.tool, input: next.input }];
    return {
      id: "msg", type: "message", role: "assistant", model: req.model, content,
      stop_reason: typeof next === "string" ? "end_turn" : "tool_use", stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    } as unknown as Anthropic.Beta.BetaMessage;
  };
  return { model, requests, left: () => texts.length };
}

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "Relógios");
  owner = await actorFor(t.app, a.userId, a.organizationId);
  const b = await seedCompany(t.app, "Outra");
  other = await actorFor(t.app, b.userId, b.organizationId);
  const un = (await runService(t.app, listUnits, owner, {})).find((u) => u.code === "UN")!.id;
  const product = (await runService(t.app, createProduct, owner, { sku: "R1", name: "Relógio", unitId: un, salePrice: "1000", costPrice: "0", minStock: "0" })).id;
  const joao = (await runService(t.app, createCustomer, owner, { kind: "person", name: "João" })).id;
  const sale = await runService(t.app, createSale, owner, {
    customerId: joao,
    items: [{ productId: product, quantity: "1" }],
    payments: [{ method: "pix", amount: "400" }],
    installments: { count: 2, interval: "monthly", firstDue: "2099-01-10" },
  });
  saleId = sale.id;
  installments = (await runService(t.app, getSale, owner, { id: sale.id })).installments.map((i) => ({ id: i.id, number: i.number }));
});
after(() => t.close());
beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "teste";
});

describe("comprovantes da venda", () => {
  it("guarda foto e PDF pelos bytes, liga à parcela e só a empresa dona vê", async () => {
    const a = await runService(t.app, addSaleAttachment, owner, { saleId, installmentId: installments[0]!.id, data: jpeg(), fileName: "cupom.jpg" });
    await runService(t.app, addSaleAttachment, owner, { saleId, data: pdf(), fileName: "pix.pdf" });
    await assert.rejects(
      runService(t.app, addSaleAttachment, owner, { saleId, data: new Uint8Array(Buffer.from("<svg onload=x>")) }),
      rejectsWith("invalid_input"),
    );
    const list = await runService(t.app, listSaleAttachments, owner, { saleId });
    assert.deepEqual(list.map((x) => [x.contentType, x.installmentNumber, x.checkStatus, x.source]), [
      ["image/jpeg", 1, "pending", "panel"],
      ["application/pdf", null, "pending", "panel"],
    ]);
    const file = await runService(t.app, getSaleAttachment, owner, { id: a.id });
    assert.deepEqual(new Uint8Array(file.data), jpeg());
    await assert.rejects(runService(t.app, getSaleAttachment, other, { id: a.id }), rejectsWith("not_found"));
    // Fica registrado no histórico da venda.
    const logs = await runService(t.app, listAuditLogs, owner, { entityType: "sale", entityId: saleId });
    assert.ok(logs.items.some((l) => l.action === "sale.attachment_add"));
  });

  it("parcela de outra venda é recusada; quem não recebe pagamento não anexa", async () => {
    await assert.rejects(
      runService(t.app, addSaleAttachment, owner, { saleId: randomUUID(), data: jpeg() }),
      rejectsWith("not_found"),
    );
    const seller = await addUserWithRole(t.app, owner, "stock");
    await assert.rejects(runService(t.app, addSaleAttachment, seller.actor, { saleId, data: jpeg() }), rejectsWith("forbidden"));
  });

  it("conferência automática: guarda o que leu e se bate", async () => {
    const m = reply(
      JSON.stringify({ status: "match", amount: "300.00", date: "2026-11-08", method: "Pix", payer: "João", note: "Pix de R$ 300,00 bate com a 1ª parcela." }),
      JSON.stringify({ status: "mismatch", amount: "250,00", date: null, method: null, payer: null, note: "Valor de R$ 250,00 não bate com nada da venda." }),
    );
    const done = await runAttachmentChecks(t.app, owner, { model: m.model });
    assert.equal(done, 2);
    // O comprovante vai como imagem/PDF e a venda vai junto em texto.
    assert.equal((m.requests[0]!.messages[0]!.content as Array<{ type: string }>)[0]!.type, "image");
    assert.equal((m.requests[1]!.messages[0]!.content as Array<{ type: string }>)[0]!.type, "document");
    assert.match(JSON.stringify(m.requests[0]!.messages), /1ª parcela/);
    const list = await runService(t.app, listSaleAttachments, owner, { saleId });
    assert.deepEqual(list.map((x) => [x.checkStatus, x.checkAmount]), [["match", "300.00"], ["mismatch", "250.00"]]);
    assert.match(list[0]!.checkNote!, /Pago por João/);
    // Nada mais pendente.
    assert.equal(await runAttachmentChecks(t.app, owner, { model: reply().model }), 0);
  });

  it("recurso desligado: não anexa", async () => {
    await enableAllFeatures(t.app, owner.organizationId, false);
    await assert.rejects(runService(t.app, addSaleAttachment, owner, { saleId, data: jpeg() }), rejectsWith("forbidden"));
    await enableAllFeatures(t.app, owner.organizationId, true);
  });

  it("remove", async () => {
    const [first] = await runService(t.app, listSaleAttachments, owner, { saleId });
    await runService(t.app, removeSaleAttachment, owner, { id: first!.id });
    assert.equal((await runService(t.app, listSaleAttachments, owner, { saleId })).length, 1);
  });
});

describe("comprovante pela Netz", () => {
  it("a foto vai para a Netz, ela propõe ligar à venda e o sistema confere ao confirmar", async () => {
    assert.ok(netsTools(owner).tools.some((x) => x.name === "sales_attachments_link"));
    assert.ok(!netsTools(owner).tools.some((x) => x.name === "sales_attachments_add"));
    const stashed = await runService(t.app, stashSaleAttachment, owner, { data: jpeg(), source: "netz" });
    const posted = await postNetsMessage(t.app, owner, { requestId: randomUUID(), text: "Mandei uma foto de comprovante.", attachmentId: stashed.id });
    const netz = reply(
      { tool: "sales_attachments_link", input: { _resumo: "Ligar o Pix de R$ 300,00 à 2ª parcela da venda do João (confere)", attachmentId: stashed.id, saleId, installmentId: installments[1]!.id } },
      "Li um Pix de R$ 300,00 do João: bate com a 2ª parcela. Confirma?",
    );
    await processNetsTurn(t.app, { organizationId: owner.organizationId, userId: owner.userId, messageId: posted.id }, { model: netz.model });
    // A foto chegou junto com a marca do anexo.
    const first = netz.requests[0]!.messages.at(-1)!.content as Array<{ type: string; text?: string }>;
    assert.equal(first[0]!.type, "image");
    assert.match(first[1]!.text!, new RegExp(`Anexo: comprovante ${stashed.id}`));
    const { messages } = await listNetsMessages(t.app, owner);
    const card = messages.at(-1)!;
    assert.equal(card.actionStatus, "pending");
    assert.equal(messages.at(-2)!.attachmentId, stashed.id);
    assert.equal(messages.at(-2)!.attachmentType, "image/jpeg");
    // Antes de confirmar, ainda não está na venda.
    assert.equal((await runService(t.app, listSaleAttachments, owner, { saleId })).some((a) => a.id === stashed.id), false);

    await decideNetsAction(t.app, owner, { id: card.id, decision: "confirm" });
    const check = reply(JSON.stringify({ status: "match", amount: "300.00", date: null, method: "Pix", payer: null, note: "Bate com a 2ª parcela." }));
    await processNetsTurn(t.app, { organizationId: owner.organizationId, userId: owner.userId, messageId: card.id }, { model: check.model });
    const linked = (await runService(t.app, listSaleAttachments, owner, { saleId })).find((a) => a.id === stashed.id)!;
    assert.deepEqual([linked.installmentNumber, linked.checkStatus, linked.source], [2, "match", "netz"]);
    const last = (await listNetsMessages(t.app, owner)).messages.at(-1)!;
    assert.match(last.body, /bate com a venda/);
  });
});
