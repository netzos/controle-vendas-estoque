import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { withTenant } from "@erp/db";
import {
  addMember,
  AppError,
  changePassword,
  createBranch,
  createRole,
  deleteRole,
  getSession,
  listAuditLogs,
  listBranches,
  listMembers,
  listRoles,
  listUserOrganizations,
  login,
  logout,
  resolveActor,
  runService,
  setupFirstAdmin,
  switchOrganization,
  updateMember,
  updateOrganization,
  updateRole,
  updateSettings,
  getSettings,
  isSetupDone,
  type Actor,
} from "../src/index.ts";
import { actorFor, addUserWithRole, PASSWORD, seedCompany, setupTestDb, type TestDb } from "./helpers.ts";

const rejectsWith = (code: string) => (err: unknown) => {
  assert.ok(err instanceof AppError, `esperava AppError, veio ${String(err)}`);
  assert.equal(err.code, code, err.message);
  return true;
};

let t: TestDb;
let companyA: Awaited<ReturnType<typeof seedCompany>>;
let ownerA: Actor;

before(async () => {
  t = await setupTestDb();
  companyA = await seedCompany(t.app, "Empresa A", "dono-a@teste.com");
  ownerA = await actorFor(t.app, companyA.userId, companyA.organizationId);
});
after(() => t.close());

describe("configuração inicial", () => {
  it("cria empresa, matriz, perfis padrão e proprietário", async () => {
    assert.equal(await isSetupDone(t.app), true);
    assert.equal(ownerA.isOwner, true);
    assert.ok(ownerA.permissions.has("users.manage"));
    const roles = await runService(t.app, listRoles, ownerA, {});
    assert.deepEqual(roles.map((r) => r.key).sort(), ["admin", "finance", "owner", "sales", "stock", "viewer"]);
    const branches = await runService(t.app, listBranches, ownerA, {});
    assert.equal(branches.length, 1);
    assert.equal(branches[0]!.isHeadquarters, true);
  });

  it("não permite repetir a configuração inicial", async () => {
    await assert.rejects(
      setupFirstAdmin(t.app, { name: "Outro", email: "outro@teste.com", password: PASSWORD, organization: { name: "Outra Empresa" } }),
      rejectsWith("conflict"),
    );
  });
});

describe("autenticação", () => {
  it("faz login, resolve e encerra a sessão", async () => {
    const { token, session } = await login(t.app, { email: "DONO-A@teste.com ", password: PASSWORD });
    assert.equal(session.activeOrganizationId, companyA.organizationId);
    const again = await getSession(t.app, token);
    assert.equal(again?.userId, companyA.userId);
    await logout(t.app, token);
    assert.equal(await getSession(t.app, token), null);
  });

  it("recusa senha errada sem revelar se o e-mail existe e bloqueia após 5 falhas", async () => {
    await assert.rejects(login(t.app, { email: "ninguem@teste.com", password: "x" }), rejectsWith("unauthenticated"));
    const email = "bloqueio@teste.com";
    for (let i = 0; i < 5; i++) {
      await assert.rejects(login(t.app, { email, password: "errada" }), rejectsWith("unauthenticated"));
    }
    await assert.rejects(login(t.app, { email, password: "errada" }), rejectsWith("rate_limited"));
  });

  it("troca a senha e encerra as outras sessões", async () => {
    const member = await addUserWithRole(t.app, ownerA, "sales", "Troca Senha");
    const s1 = await login(t.app, { email: member.email, password: PASSWORD });
    assert.equal(s1.session.mustChangePassword, true);
    const s2 = await login(t.app, { email: member.email, password: PASSWORD });
    await changePassword(t.app, s2.session, { currentPassword: PASSWORD, newPassword: "nova-senha-456" });
    assert.equal(await getSession(t.app, s1.token), null);
    const still = await getSession(t.app, s2.token);
    assert.equal(still?.mustChangePassword, false);
  });

  it("ignora tokens inválidos", async () => {
    assert.equal(await getSession(t.app, "curto"), null);
    assert.equal(await getSession(t.app, "x".repeat(43)), null);
  });
});

describe("isolamento entre empresas (Teste I)", () => {
  it("usuário de uma empresa não acessa outra", async () => {
    const companyB = await seedCompany(t.app, "Empresa B");
    const ownerB = await actorFor(t.app, companyB.userId, companyB.organizationId);
    await runService(t.app, createBranch, ownerB, { name: "Filial Secreta", code: "SEC" });

    // Não há vínculo: a resolução do ator recusa.
    await assert.rejects(actorFor(t.app, companyA.userId, companyB.organizationId), rejectsWith("forbidden"));

    // Mesmo forjando o ator, o RLS do banco não devolve dados de outra empresa.
    const forged: Actor = { ...ownerA, organizationId: ownerA.organizationId };
    const branches = await runService(t.app, listBranches, forged, {});
    assert.ok(branches.every((b) => b.name !== "Filial Secreta"));

    const raw = await withTenant(t.app, { organizationId: companyA.organizationId, userId: companyA.userId }, (tx) =>
      tx.query("SELECT id FROM erp.branches WHERE organization_id = $1", [companyB.organizationId]),
    );
    assert.equal(raw.rowCount, 0);

    // Sem contexto, nenhuma linha de empresa é visível.
    const none = await t.app.query("SELECT id FROM erp.branches");
    assert.equal(none.rowCount, 0);

    // E não é possível gravar em outra empresa com o contexto da sua.
    await assert.rejects(
      withTenant(t.app, { organizationId: companyA.organizationId, userId: companyA.userId }, (tx) =>
        tx.query("INSERT INTO erp.branches (organization_id, name, code) VALUES ($1, 'Invasão', 'INV')", [companyB.organizationId]),
      ),
      /row-level security/,
    );

    // A lista de empresas do usuário só mostra as dele.
    const orgs = await listUserOrganizations(t.app, companyA.userId);
    assert.deepEqual(orgs.map((o) => o.id), [companyA.organizationId]);
    const s = await login(t.app, { email: "dono-a@teste.com", password: PASSWORD });
    await assert.rejects(switchOrganization(t.app, s.session, companyB.organizationId), rejectsWith("forbidden"));
  });
});

describe("permissões (Teste H)", () => {
  it("perfil de consulta não altera dados", async () => {
    const viewer = await addUserWithRole(t.app, ownerA, "viewer", "Consulta");
    await assert.rejects(
      runService(t.app, updateOrganization, viewer.actor, { name: "Hack", legalName: null, document: null, timezone: "America/Sao_Paulo" }),
      rejectsWith("forbidden"),
    );
    await assert.rejects(runService(t.app, createBranch, viewer.actor, { name: "X", code: "X" }), rejectsWith("forbidden"));
    // Mas consulta normalmente.
    const branches = await runService(t.app, listBranches, viewer.actor, {});
    assert.ok(branches.length >= 1);
  });

  it("administrador não concede o perfil Proprietário nem altera o próprio acesso", async () => {
    const admin = await addUserWithRole(t.app, ownerA, "admin", "Admin");
    const roles = await runService(t.app, listRoles, ownerA, {});
    const ownerRole = roles.find((r) => r.key === "owner")!;
    await assert.rejects(
      runService(t.app, addMember, admin.actor, { email: "novo-dono@teste.com", name: "Novo", roleId: ownerRole.id, temporaryPassword: PASSWORD }),
      rejectsWith("forbidden"),
    );
    await assert.rejects(
      runService(t.app, updateMember, admin.actor, { membershipId: admin.membershipId, roleId: ownerRole.id, branchIds: null, status: "active" }),
      rejectsWith("conflict"),
    );
  });

  it("empresa não fica sem proprietário ativo", async () => {
    const admin = await addUserWithRole(t.app, ownerA, "admin", "Admin 2");
    const members = await runService(t.app, listMembers, ownerA, {});
    const ownerMembership = members.find((m) => m.userId === companyA.userId)!;
    // O próprio dono não pode se rebaixar; um segundo dono tentando rebaixar o único dono também falha.
    const roles = await runService(t.app, listRoles, ownerA, {});
    const viewerRole = roles.find((r) => r.key === "viewer")!;
    await assert.rejects(
      runService(t.app, updateMember, admin.actor, { membershipId: ownerMembership.membershipId, roleId: viewerRole.id, branchIds: null, status: "active" }),
      rejectsWith("forbidden"),
    );
  });

  it("não concede permissões que o próprio usuário não tem", async () => {
    const roles = await runService(t.app, listRoles, ownerA, {});
    const custom = await runService(t.app, createRole, ownerA, { name: "Gerente de RH", permissions: ["users.view", "users.manage", "roles.view", "roles.manage"] });
    assert.equal(custom.key, "custom_gerente_de_rh");
    const rh = await addUserWithRole(t.app, ownerA, custom.key, "RH");
    await assert.rejects(
      runService(t.app, createRole, rh.actor, { name: "Super", permissions: ["organization.update"] }),
      rejectsWith("forbidden"),
    );
    await assert.rejects(runService(t.app, deleteRole, ownerA, { id: custom.id }), rejectsWith("conflict"));
    const viewer = roles.find((r) => r.key === "viewer")!;
    await assert.rejects(runService(t.app, deleteRole, ownerA, { id: viewer.id }), rejectsWith("conflict"));
    await assert.rejects(
      runService(t.app, createRole, ownerA, { name: "Inválido", permissions: ["sales.delete_everything"] }),
      rejectsWith("invalid_input"),
    );
  });

  it("alteração de permissão vale na próxima resolução do ator", async () => {
    const roles = await runService(t.app, listRoles, ownerA, {});
    const sales = roles.find((r) => r.key === "sales")!;
    const seller = await addUserWithRole(t.app, ownerA, "sales", "Vendedor");
    assert.equal(seller.actor.permissions.has("audit.view"), false);
    await runService(t.app, updateRole, ownerA, { id: sales.id, name: sales.name, permissions: [...sales.permissions, "audit.view"] });
    const refreshed = await resolveActor(t.app, { userId: seller.userId, organizationId: ownerA.organizationId, channel: "telegram" });
    assert.equal(refreshed.permissions.has("audit.view"), true);
  });

  it("desativar o acesso encerra a sessão naquela empresa", async () => {
    const seller = await addUserWithRole(t.app, ownerA, "sales", "Desligado");
    const s = await login(t.app, { email: seller.email, password: PASSWORD });
    await runService(t.app, updateMember, ownerA, { membershipId: seller.membershipId, roleId: (await runService(t.app, listRoles, ownerA, {})).find((r) => r.key === "sales")!.id, branchIds: null, status: "disabled" });
    assert.equal(await getSession(t.app, s.token), null);
    await assert.rejects(actorFor(t.app, seller.userId, ownerA.organizationId), rejectsWith("forbidden"));
  });
});

describe("serviços: validação, auditoria, outbox e idempotência", () => {
  it("valida a entrada antes de abrir transação", async () => {
    await assert.rejects(runService(t.app, createBranch, ownerA, { name: "", code: "inválido!" }), rejectsWith("invalid_input"));
  });

  it("grava auditoria e evento junto com o dado", async () => {
    const branch = await runService(t.app, createBranch, ownerA, { name: "Filial Centro", code: "centro" });
    assert.equal(branch.code, "CENTRO");
    const logs = await runService(t.app, listAuditLogs, ownerA, { entityType: "branch", entityId: branch.id });
    assert.equal(logs.items.length, 1);
    assert.equal(logs.items[0]!.actorName, "Dono");
    const events = await withTenant(t.app, { organizationId: ownerA.organizationId, userId: null }, (tx) =>
      tx.query("SELECT event_type FROM erp.outbox_events WHERE aggregate_id = $1", [branch.id]),
    );
    assert.deepEqual(events.rows.map((r) => r.event_type), ["branch.created"]);
  });

  it("falha no meio da operação não deixa auditoria nem evento", async () => {
    const before = await runService(t.app, listAuditLogs, ownerA, { limit: 200 });
    await assert.rejects(runService(t.app, createBranch, ownerA, { name: "Duplicada", code: "CENTRO" }), rejectsWith("conflict"));
    const afterLogs = await runService(t.app, listAuditLogs, ownerA, { limit: 200 });
    assert.equal(afterLogs.items.length, before.items.length);
  });

  it("mesma chave de idempotência não duplica a operação (Teste G)", async () => {
    const input = { name: "Filial Norte", code: "NORTE" };
    const [a, b] = await Promise.all([
      runService(t.app, createBranch, ownerA, input, { idempotencyKey: "tg:update:1001" }),
      runService(t.app, createBranch, ownerA, input, { idempotencyKey: "tg:update:1001" }),
    ]);
    assert.equal(a.id, b.id);
    const c = await runService(t.app, createBranch, ownerA, input, { idempotencyKey: "tg:update:1001" });
    assert.equal(c.id, a.id);
    const all = await runService(t.app, listBranches, ownerA, {});
    assert.equal(all.filter((x) => x.code === "NORTE").length, 1);
    await assert.rejects(
      runService(t.app, createBranch, ownerA, { name: "Outra", code: "OUTRA" }, { idempotencyKey: "tg:update:1001" }),
      rejectsWith("conflict"),
    );
  });

  it("configurações têm padrão, validação e auditoria", async () => {
    const s = await runService(t.app, getSettings, ownerA, {});
    assert.equal(s["general.week_start"], "monday");
    const r = await runService(t.app, updateSettings, ownerA, { "general.week_start": "sunday" });
    assert.deepEqual(r.changed, ["general.week_start"]);
    const again = await runService(t.app, updateSettings, ownerA, { "general.week_start": "sunday" });
    assert.deepEqual(again.changed, []);
    await assert.rejects(runService(t.app, updateSettings, ownerA, { "general.week_start": "friday" }), rejectsWith("invalid_input"));
    await assert.rejects(runService(t.app, updateSettings, ownerA, { "ai.disable_security": true }), rejectsWith("invalid_input"));
  });

  it("dados da empresa: fuso horário inválido é recusado", async () => {
    await assert.rejects(
      runService(t.app, updateOrganization, ownerA, { name: "Empresa A", legalName: null, document: null, timezone: "Marte/Olympus" }),
      rejectsWith("invalid_input"),
    );
    const org = await runService(t.app, updateOrganization, ownerA, { name: "Empresa A Ltda", legalName: "Empresa A Comércio Ltda", document: "12.345.678/0001-90", timezone: "America/Manaus" });
    assert.equal(org.timezone, "America/Manaus");
  });
});
