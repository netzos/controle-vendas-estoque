import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  AppError,
  createPlatformOrganization,
  inspectPasswordToken,
  listMembers,
  listPlatformOrganizations,
  listUserOrganizations,
  platformOwnerPasswordLink,
  resetPassword,
  runService,
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
let other: Actor;

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "Empresa do desenvolvedor", "dev@netzcode.com.br");
  dev = await actorFor(t.app, a.userId, a.organizationId);
  await t.owner.query("INSERT INTO controle_vendas_estoque.platform_developers (user_id) VALUES ($1)", [a.userId]);
  const b = await seedCompany(t.app, "Outra empresa");
  other = await actorFor(t.app, b.userId, b.organizationId);
});
after(() => t.close());

describe("empresas da plataforma", () => {
  it("só o desenvolvedor lista e cria empresas", async () => {
    await assert.rejects(listPlatformOrganizations(t.app, other.userId), rejectsWith("forbidden"));
    await assert.rejects(
      createPlatformOrganization(t.app, other, { organizationName: "Intrusa", ownerName: "Xavier", ownerEmail: "x@teste.com" }),
      rejectsWith("forbidden"),
    );
    const list = await listPlatformOrganizations(t.app, dev.userId);
    assert.deepEqual(list.map((o) => o.name), ["Empresa do desenvolvedor", "Outra empresa"]);
  });

  it("cria a empresa com o dono novo e devolve o link para ele criar a senha", async () => {
    const r = await createPlatformOrganization(t.app, dev, {
      organizationName: "Apple Ends",
      ownerName: "Anne",
      ownerEmail: "Anne@AppleEnds.com",
      joinAsOwner: true,
    });
    assert.ok(r.link);
    const token = new URL(r.link.url).searchParams.get("token")!;
    const info = await inspectPasswordToken(t.app, token);
    assert.equal(info?.purpose, "invite");
    assert.equal(info?.email, "anne@appleends.com");

    const org = (await listPlatformOrganizations(t.app, dev.userId)).find((o) => o.name === "Apple Ends")!;
    assert.equal(org.ownerName, "Anne"); // o dono principal não é o desenvolvedor
    assert.equal(org.members, 2);
    assert.equal(org.developerIsMember, true);

    // Anne cria a senha e já tem a empresa como proprietária.
    await resetPassword(t.app, { token, newPassword: "senha-da-anne-123" });
    const anne = await t.app.query<{ id: string }>("SELECT id FROM controle_vendas_estoque.users WHERE email = 'anne@appleends.com'");
    const orgs = await listUserOrganizations(t.app, anne.rows[0]!.id);
    assert.deepEqual(orgs.map((o) => o.name), ["Apple Ends"]);
    const anneActor = await actorFor(t.app, anne.rows[0]!.id, r.organizationId);
    assert.equal(anneActor.isOwner, true);
    const members = await runService(t.app, listMembers, anneActor, {});
    assert.equal(members.length, 2);

    // Link novo pela tela de empresas.
    const again = await platformOwnerPasswordLink(t.app, dev.userId, r.organizationId);
    assert.equal(again.name, "Anne");
  });

  it("sem entrar junto, o desenvolvedor não vê os dados da empresa", async () => {
    const r = await createPlatformOrganization(t.app, dev, { organizationName: "Loja do Pepe", ownerName: "Pepe", ownerEmail: "pepe@teste.com" });
    const org = (await listPlatformOrganizations(t.app, dev.userId)).find((o) => o.id === r.organizationId)!;
    assert.equal(org.developerIsMember, false);
    assert.equal(org.members, 1);
    await assert.rejects(actorFor(t.app, dev.userId, r.organizationId));
  });

  it("dono que já tem conta não recebe link; nome repetido é recusado", async () => {
    const r = await createPlatformOrganization(t.app, dev, {
      organizationName: "Segunda loja",
      ownerName: "Qualquer",
      ownerEmail: "anne@appleends.com",
    });
    assert.equal(r.link, null);
    assert.equal(r.ownerName, "Anne");
    await assert.rejects(
      createPlatformOrganization(t.app, dev, { organizationName: "apple ends", ownerName: "Beto", ownerEmail: "b@teste.com" }),
      rejectsWith("conflict"),
    );
  });
});
