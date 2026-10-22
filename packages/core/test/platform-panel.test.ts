import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  AppError,
  joinOrganizationForSupport,
  leaveOrganizationSupport,
  listPlatformOrganizationRows,
  login,
  organizationHealth,
  platformMemberPasswordLink,
  platformOrganizationDetail,
  savePlatformOrganizationNotes,
  type Actor,
} from "../src/index.ts";
import { actorFor, addUserWithRole, PASSWORD, seedCompany, setupTestDb, type TestDb } from "./helpers.ts";

const rejectsWith = (code: string) => (err: unknown) => {
  assert.ok(err instanceof AppError, `esperava AppError, veio ${String(err)}`);
  assert.equal(err.code, code, err.message);
  return true;
};

let t: TestDb;
let dev: Actor;
let client: Actor;
let clientEmail: string;

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "Equipe netzsales", "dev@netzcode.com.br");
  dev = await actorFor(t.app, a.userId, a.organizationId);
  await t.owner.query("INSERT INTO controle_vendas_estoque.platform_developers (user_id) VALUES ($1)", [a.userId]);
  const b = await seedCompany(t.app, "Loja cliente");
  clientEmail = b.email;
  client = await actorFor(t.app, b.userId, b.organizationId);
});
after(() => t.close());

describe("ficha da empresa na plataforma", () => {
  it("saúde da empresa pelo último uso", () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    assert.equal(organizationHealth("active", null, now), "never");
    assert.equal(organizationHealth("active", new Date(now - day), now), "active");
    assert.equal(organizationHealth("active", new Date(now - 10 * day), now), "cooling");
    assert.equal(organizationHealth("active", new Date(now - 40 * day), now), "idle");
    assert.equal(organizationHealth("suspended", new Date(now), now), "suspended");
  });

  it("só o desenvolvedor vê a lista e a ficha; uso do cliente conta, o da equipe não", async () => {
    await assert.rejects(listPlatformOrganizationRows(t.app, client.userId), rejectsWith("forbidden"));
    await assert.rejects(platformOrganizationDetail(t.app, client.userId, client.organizationId), rejectsWith("forbidden"));

    let row = (await listPlatformOrganizationRows(t.app, dev.userId)).find((o) => o.id === client.organizationId)!;
    assert.equal(row.health, "never");
    assert.equal(row.usersTotal, 1);

    await login(t.app, { email: clientEmail, password: PASSWORD });
    await joinOrganizationForSupport(t.app, dev, client.organizationId);
    row = (await listPlatformOrganizationRows(t.app, dev.userId)).find((o) => o.id === client.organizationId)!;
    assert.equal(row.health, "active");
    assert.equal(row.usersTotal, 1, "a equipe netzsales não conta como usuário do cliente");
    assert.equal(row.usersActive7d, 1);

    const d = await platformOrganizationDetail(t.app, dev.userId, client.organizationId);
    assert.equal(d.dailySales.length, 30);
    assert.equal(d.members.length, 2);
    assert.ok(d.members.some((m) => m.isDeveloper));
    assert.ok(d.activity.some((a) => a.action === "member.support_join"));
    await assert.rejects(platformOrganizationDetail(t.app, dev.userId, "nao-e-uuid"), rejectsWith("not_found"));
  });

  it("anotações internas: só a equipe lê e grava, e não entram na auditoria da empresa", async () => {
    await assert.rejects(savePlatformOrganizationNotes(t.app, client, client.organizationId, { notes: "x" }), rejectsWith("forbidden"));
    await savePlatformOrganizationNotes(t.app, dev, client.organizationId, { notes: "Usa só no balcão.", contact: "Ana · 11 99999-0000" });
    await savePlatformOrganizationNotes(t.app, dev, client.organizationId, { notes: "Usa no balcão e no Telegram.", contact: "" });
    const d = await platformOrganizationDetail(t.app, dev.userId, client.organizationId);
    assert.equal(d.notes.notes, "Usa no balcão e no Telegram.");
    assert.equal(d.notes.contact, null);
    assert.equal(d.notes.updatedByName, "Dono");
    // A empresa não enxerga as anotações nem pelo banco.
    const seen = await t.app.query("SELECT controle_vendas_estoque.is_platform_developer($1) AS dev", [client.userId]);
    assert.equal(seen.rows[0].dev, false);
    assert.ok(!d.activity.some((a) => (a.summary ?? "").includes("balcão")));
  });

  it("link de senha para qualquer pessoa da empresa e saída do suporte", async () => {
    const seller = await addUserWithRole(t.app, client, "sales", "Vendedora");
    const d = await platformOrganizationDetail(t.app, dev.userId, client.organizationId);
    const m = d.members.find((x) => x.userId === seller.userId)!;
    await assert.rejects(platformMemberPasswordLink(t.app, client.userId, client.organizationId, m.membershipId), rejectsWith("forbidden"));
    const link = await platformMemberPasswordLink(t.app, dev.userId, client.organizationId, m.membershipId);
    assert.match(link.url, /redefinir-senha\?token=/);
    assert.equal(link.firstAccess, true);

    await leaveOrganizationSupport(t.app, dev, client.organizationId);
    const after = await platformOrganizationDetail(t.app, dev.userId, client.organizationId);
    assert.equal(after.members.find((x) => x.isDeveloper)!.status, "disabled");
    assert.ok(after.activity.some((a) => a.action === "member.support_leave"));
    // Dono não sai por aqui.
    await assert.rejects(leaveOrganizationSupport(t.app, dev, dev.organizationId), rejectsWith("conflict"));
  });
});
