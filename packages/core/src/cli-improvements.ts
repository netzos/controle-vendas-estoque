import { readFileSync } from "node:fs";
import { createPool } from "@erp/db";
import {
  claudeCommentImprovement,
  claudeCreateImprovement,
  claudeGetImprovement,
  claudeListImprovements,
  claudeMoveImprovement,
  type ImprovementModule,
  type ImprovementStatus,
} from "./modules/improvements/service.ts";

// Comando do Claude para o quadro Melhorias (mesmo papel do netzos-improvements):
//   pnpm improvements list [status]
//   pnpm improvements show <id>
//   echo "Análise: ..." | pnpm improvements comment <id>
//   echo "Análise: ..." | pnpm improvements status <id> analysis|building
//   echo "O que mudou"  | pnpm improvements status <id> published <https://link>
//   echo "Descrição"    | pnpm improvements create <modulo> <título...>
// O Claude não aprova nem recusa: isso é só do desenvolvedor, no painel.

const stdin = () => (process.stdin.isTTY ? "" : readFileSync(0, "utf8").trim());

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const db = createPool(process.env.DATABASE_URL, 2);
  try {
    switch (command) {
      case "list": {
        const status = args[0] ? [args[0] as ImprovementStatus] : undefined;
        for (const i of await claudeListImprovements(db, { status })) {
          console.log(`${i.id}  #${i.number}  [${i.status}] [${i.module}] ${i.title}  · ${i.organizationName ?? "plataforma"} · ${i.createdByName}`);
        }
        break;
      }
      case "show": {
        const { item, messages } = await claudeGetImprovement(db, args[0] ?? "");
        console.log(JSON.stringify({ item, messages }, null, 2));
        break;
      }
      case "comment":
        await claudeCommentImprovement(db, args[0] ?? "", stdin());
        console.log("ok");
        break;
      case "status": {
        const [id, status, link] = args;
        const item = await claudeMoveImprovement(db, id ?? "", status as ImprovementStatus, { link, body: stdin() });
        console.log(`ok: #${item.number} agora está em ${item.status}`);
        break;
      }
      case "create": {
        const [module, ...titleParts] = args;
        const item = await claudeCreateImprovement(db, { module: module as ImprovementModule, title: titleParts.join(" "), body: stdin() });
        console.log(`criado ${item.id} (#${item.number})`);
        break;
      }
      default:
        console.error("Uso: pnpm improvements list|show|comment|status|create");
        process.exitCode = 1;
    }
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
