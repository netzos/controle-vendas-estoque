import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, migrate, migrationStatus } from "@erp/db";
import { syncPermissionCatalog } from "./catalog.ts";

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../db/migrations");

// Usa MIGRATION_DATABASE_URL (papel dono das tabelas) quando definida.
async function main() {
  const command = process.argv[2] ?? "migrate";
  const db = createPool(process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL, 2);
  try {
    if (command === "migrate") {
      const result = await migrate(db, MIGRATIONS_DIR);
      for (const name of result.applied) console.log(`aplicada  ${name}`);
      if (result.applied.length === 0) console.log("nenhuma migration pendente");
      const sync = await syncPermissionCatalog(db);
      console.log(`permissões: ${sync.total} no catálogo, ${sync.removed} removidas, ${sync.grantedToAdmins} concedidas a administradores`);
    } else if (command === "status") {
      for (const m of await migrationStatus(db, MIGRATIONS_DIR)) {
        console.log(`${m.appliedAt ? "aplicada " : "pendente "} ${m.name}${m.appliedAt ? `  ${m.appliedAt.toISOString()}` : ""}`);
      }
    } else if (command === "developer") {
      // Desenvolvedores da plataforma: os únicos que aprovam pedidos em Melhorias.
      const [action, email] = process.argv.slice(3);
      const user = await db.query<{ id: string }>("SELECT id FROM controle_vendas_estoque.users WHERE email = lower($1)", [email ?? ""]);
      if (!user.rows[0]) throw new Error(`Usuário não encontrado: ${email}`);
      if (action === "add") {
        await db.query("INSERT INTO controle_vendas_estoque.platform_developers (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [user.rows[0].id]);
        console.log(`${email} agora é desenvolvedor da plataforma`);
      } else if (action === "remove") {
        await db.query("DELETE FROM controle_vendas_estoque.platform_developers WHERE user_id = $1", [user.rows[0].id]);
        console.log(`${email} deixou de ser desenvolvedor da plataforma`);
      } else {
        throw new Error("Use: developer add|remove <email>");
      }
    } else {
      console.error(`Comando desconhecido: ${command}. Use migrate, status ou developer.`);
      process.exitCode = 1;
    }
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
