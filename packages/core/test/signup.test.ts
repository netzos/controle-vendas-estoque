import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  AppError,
  approveSignup,
  listPlatformOrganizations,
  listPlatformUsers,
  listSignupRequests,
  listUserOrganizations,
  login,
  platformDashboard,
  rejectSignup,
  requestSignup,
  setOrganizationStatus,
  type Actor,
} from "../src/index.ts";
import { actorFor, seedCompany, setupTestDb, type TestDb } from "./helpers.ts";

const rejectsWith = (code: string, text?: RegExp) => (err: unknown) => {
  assert.ok(err instanceof AppError, `esperava AppError, veio ${String(err)}`);
  assert.equal(err.code, code, err.message);
  if (text) assert.match(err.message, text);
  return true;
};

let t: TestDb;
let dev: Actor;
let other: Actor;
const SENHA = "senha-da-loja-123";

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "Empresa do desenvolvedor", "dev@netzcode.com.br");
  dev = await actorFor(t.app, a.userId, a.organizationId);
  await t.owner.query("INSERT INTO controle_vendas_estoque.platform_developers (user_id) VALUES ($1)", [a.userId]);
  const b = await seedCompany(t.app, "Outra empresa");
  other = await actorFor(t.app, b.userId, b.organizationId);
});
after(() => t.close());

describe("cadastro aberto com aprovação", () => {
  it("o pedido não dá acesso até ser aprovado; depois a pessoa entra com a senha que criou", async () => {
    const r = await requestSignup(
      t.app,
      { name: "Maria Souza", email: "Maria@Loja.com", whatsapp: "(91) 98888-7777", organizationName: "Loja da Maria", business: "Roupas", password: SENHA },
      "1.2.3.4",
    );
    assert.ok(r.number > 0);
    await assert.rejects(login(t.app, { email: "maria@loja.com", password: SENHA }), rejectsWith("forbidden", /em análise/));
    // Senha errada não revela que existe pedido.
    await assert.rejects(login(t.app, { email: "maria@loja.com", password: "outra-senha-qualquer" }), rejectsWith("unauthenticated"));
    // Pedido repetido e e-mail que já tem conta são recusados.
    await assert.rejects(
      requestSignup(t.app, { name: "Maria", email: "maria@loja.com", organizationName: "Loja", password: SENHA }),
      rejectsWith("conflict"),
    );
    await assert.rejects(
      requestSignup(t.app, { name: "Dev", email: "dev@netzcode.com.br", organizationName: "Loja", password: SENHA }),
      rejectsWith("conflict"),
    );

    await assert.rejects(listSignupRequests(t.app, other.userId), rejectsWith("forbidden"));
    const pending = await listSignupRequests(t.app, dev.userId, "pending");
    assert.equal(pending.length, 1);
    assert.equal(pending[0]!.email, "maria@loja.com");

    await assert.rejects(approveSignup(t.app, other, pending[0]!.id), rejectsWith("forbidden"));
    const ok = await approveSignup(t.app, dev, pending[0]!.id);
    assert.equal(ok.organizationName, "Loja da Maria");
    await assert.rejects(approveSignup(t.app, dev, pending[0]!.id), rejectsWith("conflict"));

    const { session } = await login(t.app, { email: "maria@loja.com", password: SENHA });
    const orgs = await listUserOrganizations(t.app, session.userId);
    assert.deepEqual(orgs.map((o) => o.name), ["Loja da Maria"]);
    const maria = await actorFor(t.app, session.userId, ok.organizationId);
    assert.equal(maria.isOwner, true);
  });

  it("recusado continua sem acesso e recebe a explicação", async () => {
    await requestSignup(t.app, { name: "João", email: "joao@teste.com", organizationName: "Loja do João", password: SENHA });
    const [req] = await listSignupRequests(t.app, dev.userId, "pending");
    await rejectSignup(t.app, dev, req!.id, "Teste");
    await assert.rejects(login(t.app, { email: "joao@teste.com", password: SENHA }), rejectsWith("forbidden", /não foi aprovado/));
    const all = await listSignupRequests(t.app, dev.userId, "rejected");
    assert.equal(all[0]!.rejectReason, "Teste");
  });

  it("empresa suspensa some para os usuários e volta ao reativar", async () => {
    const org = (await listPlatformOrganizations(t.app, dev.userId)).find((o) => o.name === "Loja da Maria")!;
    const { session } = await login(t.app, { email: "maria@loja.com", password: SENHA });
    await setOrganizationStatus(t.app, dev, org.id, "suspended");
    assert.deepEqual(await listUserOrganizations(t.app, session.userId), []);
    await assert.rejects(actorFor(t.app, session.userId, org.id));
    await setOrganizationStatus(t.app, dev, org.id, "active");
    assert.equal((await listUserOrganizations(t.app, session.userId)).length, 1);
  });

  it("painel: números gerais e usuários só para o desenvolvedor", async () => {
    await assert.rejects(platformDashboard(t.app, other.userId), rejectsWith("forbidden"));
    const o = await platformDashboard(t.app, dev.userId);
    assert.equal(o.companies.total, 3);
    assert.equal(o.signups.pending, 0);
    assert.ok(o.users.today >= 1);
    assert.equal(o.monthly.length, 12);
    assert.equal(o.weekly.length, 12);
    const users = await listPlatformUsers(t.app, dev.userId);
    const maria = users.find((u) => u.email === "maria@loja.com")!;
    assert.deepEqual(maria.organizations, ["Loja da Maria"]);
    assert.equal(users.find((u) => u.email === "dev@netzcode.com.br")!.isDeveloper, true);
  });

  it("limita pedidos seguidos do mesmo endereço", async () => {
    for (let i = 0; i < 5; i++) {
      await requestSignup(t.app, { name: `Pessoa ${i}`, email: `p${i}@spam.com`, organizationName: `Loja ${i}`, password: SENHA }, "9.9.9.9");
    }
    await assert.rejects(
      requestSignup(t.app, { name: "Pessoa 6", email: "p6@spam.com", organizationName: "Loja 6", password: SENHA }, "9.9.9.9"),
      rejectsWith("rate_limited"),
    );
  });
});
