import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import {
  addMember,
  AppError,
  getSession,
  inspectPasswordToken,
  listRoles,
  login,
  requestPasswordReset,
  resetPassword,
  runService,
  setMailTransport,
  type Actor,
  type MailMessage,
} from "../src/index.ts";
import { actorFor, PASSWORD, seedCompany, setupTestDb, type TestDb } from "./helpers.ts";

const rejectsWith = (code: string) => (err: unknown) => {
  assert.ok(err instanceof AppError, `esperava AppError, veio ${String(err)}`);
  assert.equal(err.code, code, err.message);
  return true;
};

const tokenFrom = (m: MailMessage) => /token=([A-Za-z0-9_-]+)/.exec(m.text)![1]!;

let t: TestDb;
let owner: Actor;
let email: string;
let sent: MailMessage[] = [];

before(async () => {
  t = await setupTestDb();
  const a = await seedCompany(t.app, "Fazenda");
  email = a.email;
  owner = await actorFor(t.app, a.userId, a.organizationId);
});
afterEach(() => {
  setMailTransport(null);
  sent = [];
});
after(() => t.close());

const capture = () => setMailTransport(async (m) => void sent.push(m));

describe("recuperação de senha", () => {
  it("sem e-mail configurado avisa e não cria link", async () => {
    assert.deepEqual(await requestPasswordReset(t.app, email), { mailEnabled: false });
  });

  it("link troca a senha uma vez, encerra sessões e não revela e-mails", async () => {
    capture();
    const old = await login(t.app, { email, password: PASSWORD });
    assert.deepEqual(await requestPasswordReset(t.app, "ninguem@teste.com"), { mailEnabled: true });
    assert.equal(sent.length, 0);

    await requestPasswordReset(t.app, email.toUpperCase());
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.to, email);
    const token = tokenFrom(sent[0]!);
    assert.equal((await inspectPasswordToken(t.app, token))!.purpose, "reset");

    await assert.rejects(resetPassword(t.app, { token, newPassword: "curta" }), rejectsWith("invalid_input"));
    await resetPassword(t.app, { token, newPassword: "nova-senha-forte-1" });
    assert.equal(await getSession(t.app, old.token), null);
    await assert.rejects(resetPassword(t.app, { token, newPassword: "outra-senha-forte" }), rejectsWith("invalid_input"));
    await login(t.app, { email, password: "nova-senha-forte-1" });
  });

  it("link novo invalida o anterior e há limite por hora", async () => {
    capture();
    await requestPasswordReset(t.app, email);
    await requestPasswordReset(t.app, email);
    assert.equal(await inspectPasswordToken(t.app, tokenFrom(sent[0]!)), null);
    assert.ok(await inspectPasswordToken(t.app, tokenFrom(sent[1]!)));
    // O teste anterior já gastou um pedido nesta hora: o limite é 3.
    await requestPasswordReset(t.app, email);
    assert.equal(sent.length, 2);
  });
});

describe("convite por e-mail", () => {
  it("sem e-mail ativo exige senha provisória; com e-mail, convida", async () => {
    const roleId = (await runService(t.app, listRoles, owner, {})).find((r) => r.key === "sales")!.id;
    await assert.rejects(
      runService(t.app, addMember, owner, { email: "vend@teste.com", name: "Vendedor", roleId, branchIds: null }),
      rejectsWith("invalid_input"),
    );
    capture();
    const r = await runService(t.app, addMember, owner, { email: "vend@teste.com", name: "Vendedor", roleId, branchIds: null });
    assert.equal(r.invited, true);
    assert.match(sent[0]!.subject, /Fazenda/);
    const token = tokenFrom(sent[0]!);
    assert.equal((await inspectPasswordToken(t.app, token))!.purpose, "invite");
    await assert.rejects(login(t.app, { email: "vend@teste.com", password: "" }), rejectsWith("unauthenticated"));
    await resetPassword(t.app, { token, newPassword: "senha-do-vendedor" });
    const s = await login(t.app, { email: "vend@teste.com", password: "senha-do-vendedor" });
    assert.equal(s.session.mustChangePassword, false);
  });
});
