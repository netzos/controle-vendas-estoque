import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  actionLabel,
  AppError,
  listPlatformConversations,
  platformConversationMessages,
  platformOrganizationMonitoring,
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

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "Equipe netzsales", "dev@netzcode.com.br");
  dev = await actorFor(t.app, a.userId, a.organizationId);
  await t.owner.query("INSERT INTO controle_vendas_estoque.platform_developers (user_id) VALUES ($1)", [a.userId]);
  const b = await seedCompany(t.app, "Loja cliente");
  client = await actorFor(t.app, b.userId, b.organizationId);
});
after(() => t.close());

describe("monitoramento da empresa na plataforma", () => {
  it("só o desenvolvedor vê o uso e as conversas", async () => {
    await assert.rejects(platformOrganizationMonitoring(t.app, client.userId, client.organizationId), rejectsWith("forbidden"));
    await assert.rejects(listPlatformConversations(t.app, client.userId, client.organizationId), rejectsWith("forbidden"));
    await assert.rejects(
      platformConversationMessages(t.app, client.userId, client.organizationId, client.userId),
      rejectsWith("forbidden"),
    );
  });

  it("conta cadastros, junta o que foi feito por canal e mostra a conversa em ordem", async () => {
    const org = client.organizationId;
    await t.owner.query(
      `INSERT INTO controle_vendas_estoque.categories (organization_id, name) VALUES ($1, 'Celulares'), ($1, 'Acessórios')`,
      [org],
    );
    await t.owner.query(
      `INSERT INTO controle_vendas_estoque.audit_logs (organization_id, actor_user_id, channel, action, created_at) VALUES
         ($1, $2, 'web', 'category.create', now() - interval '1 day'),
         ($1, $2, 'telegram', 'category.create', now()),
         ($1, $2, 'telegram', 'product.delete', now() - interval '40 days')`,
      [org, client.userId],
    );
    await t.owner.query(
      `INSERT INTO controle_vendas_estoque.nets_messages (organization_id, user_id, role, body, channel, created_at, action, action_status) VALUES
         ($1, $2, 'user', 'cadastra a categoria Acessórios', 'telegram', now() - interval '2 minutes', NULL, NULL),
         ($1, $2, 'assistant', 'Posso cadastrar?', 'telegram', now() - interval '1 minute', '{"title": "Cadastrar categoria Acessórios"}', 'done')`,
      [org, client.userId],
    );

    const m = await platformOrganizationMonitoring(t.app, dev.userId, org);
    const usage = Object.fromEntries(m.usage.map((u) => [u.kind, u]));
    assert.equal(usage.categories!.total, 2);
    assert.equal(usage.categories!.last7d, 2);
    assert.equal(usage.products!.total, 0);
    assert.equal(usage.netz_messages!.total, 1);
    assert.equal(usage.netz_actions!.total, 1);
    assert.equal(m.usage[0]!.kind, "categories");

    const cat = m.actions.find((a) => a.action === "category.create")!;
    assert.equal(cat.label, "Categoria cadastrada");
    assert.equal(cat.total, 2);
    assert.deepEqual(cat.byChannel, { web: 1, telegram: 1 });
    // Ação de mais de 30 dias fica fora do resumo.
    assert.equal(m.actions.some((a) => a.action === "product.delete"), false);

    assert.equal(m.conversations.length, 1);
    assert.equal(m.conversations[0]!.userMessages, 1);
    assert.equal(m.conversations[0]!.actionsDone, 1);
    assert.deepEqual(m.conversations[0]!.channels, ["telegram"]);

    const msgs = await platformConversationMessages(t.app, dev.userId, org, client.userId);
    assert.deepEqual(msgs.map((x) => x.role), ["user", "assistant"]);
    assert.equal(msgs[1]!.actionTitle, "Cadastrar categoria Acessórios");
    assert.equal(msgs[1]!.actionStatus, "done");

    // Outra empresa não aparece misturada.
    assert.equal((await listPlatformConversations(t.app, dev.userId, dev.organizationId)).length, 0);
  });

  it("nomes amigáveis das ações", () => {
    assert.equal(actionLabel("sale.create"), "Venda registrada");
    assert.equal(actionLabel("category.delete"), "Categoria excluída");
    assert.equal(actionLabel("customer.deactivate"), "Cliente desativado");
    assert.equal(actionLabel("algo.novo"), "algo.novo");
  });
});
