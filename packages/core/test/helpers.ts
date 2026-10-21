import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, migrate, type Db } from "@erp/db";
import { syncPermissionCatalog } from "../src/catalog.ts";
import { resolveActor, type Actor, type Channel } from "../src/context.ts";
import { hashPassword } from "../src/auth/password.ts";
import { createOrganization, setupFirstAdmin } from "../src/modules/organizations/bootstrap.ts";
import { addMember } from "../src/modules/access/members.ts";
import { listRoles } from "../src/modules/access/roles.ts";
import { runService } from "../src/service.ts";

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../db/migrations");

// TEST_OWNER_DATABASE_URL: papel dono (aplica migrations e limpa o banco).
// TEST_DATABASE_URL: papel da aplicação (erp_app), sujeito ao RLS.
const OWNER_URL = process.env.TEST_OWNER_DATABASE_URL ?? "postgres://erp_owner:erp@localhost/erp_test";
const APP_URL = process.env.TEST_DATABASE_URL ?? "postgres://erp_app_login:app@localhost/erp_test";

export interface TestDb {
  owner: Db;
  app: Db;
  close(): Promise<void>;
}

export async function setupTestDb(): Promise<TestDb> {
  const owner = createPool(OWNER_URL, 4);
  await owner.query("DROP SCHEMA IF EXISTS erp CASCADE; DROP TABLE IF EXISTS public.erp_schema_migrations;");
  await migrate(owner, MIGRATIONS);
  await syncPermissionCatalog(owner);
  const app = createPool(APP_URL, 8);
  return {
    owner,
    app,
    async close() {
      await app.end();
      await owner.end();
    },
  };
}

export const PASSWORD = "senha-forte-123";

export async function seedCompany(db: Db, name = "Empresa Teste", email = `dono-${Math.random().toString(36).slice(2)}@teste.com`) {
  // setupFirstAdmin só roda no banco vazio; nos demais casos criamos direto.
  const { rows } = await db.query("SELECT 1 FROM erp.users LIMIT 1");
  if (rows.length === 0) {
    const r = await setupFirstAdmin(db, { name: "Dono", email, password: PASSWORD, organization: { name } });
    return { ...r, email };
  }
  const u = await db.query<{ id: string }>(
    "INSERT INTO erp.users (email, name, password_hash) VALUES ($1, 'Dono', $2) RETURNING id",
    [email, await hashPassword(PASSWORD)],
  );
  const org = await createOrganization(db, u.rows[0]!.id, { name });
  return { userId: u.rows[0]!.id, ...org, email };
}

export function actorFor(db: Db, userId: string, organizationId: string, channel: Channel = "web"): Promise<Actor> {
  return resolveActor(db, { userId, organizationId, channel });
}

export async function addUserWithRole(db: Db, owner: Actor, roleKey: string, name = "Usuário") {
  const roles = await runService(db, listRoles, owner, {});
  const role = roles.find((r) => r.key === roleKey)!;
  const email = `${roleKey}-${Math.random().toString(36).slice(2)}@teste.com`;
  const r = await runService(db, addMember, owner, { email, name, roleId: role.id, branchIds: null, temporaryPassword: PASSWORD });
  return { ...r, email, actor: await actorFor(db, r.userId, owner.organizationId) };
}
