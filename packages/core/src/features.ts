import type { Db } from "@erp/db";
import { setTenant, withTenant, withTransaction } from "@erp/db";
import { recordAudit } from "./audit.ts";
import { AppError, forbidden, notFound } from "./errors.ts";

// Liberações: partes do sistema que o administrador da plataforma liga ou
// desliga por empresa. Sem escolha gravada, vale defaultOn. Uma novidade entra
// aqui com defaultOn: false e só aparece para quem for liberado.
export const FEATURES = [
  { key: "costs", label: "Custos", description: "Painel de custos, custo de obtenção e tipos de custo.", defaultOn: true },
  { key: "deliveries", label: "Entregas e etapas", description: "Entregas e etapas depois da venda (instalação, montagem...).", defaultOn: true },
  { key: "netz", label: "Netz no painel", description: "O balão da assistente em todas as telas.", defaultOn: true },
  { key: "telegram", label: "Telegram", description: "Conversar com a Netz pelo Telegram.", defaultOn: true },
  { key: "custom_fields", label: "Campos personalizados", description: "Campos extras no cadastro dos produtos.", defaultOn: true },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];

export function isFeatureKey(key: string): key is FeatureKey {
  return FEATURES.some((f) => f.key === key);
}

function effective(rows: Array<{ feature_key: string; enabled: boolean }>): Set<FeatureKey> {
  const chosen = new Map(rows.map((r) => [r.feature_key, r.enabled]));
  return new Set(FEATURES.filter((f) => chosen.get(f.key) ?? f.defaultOn).map((f) => f.key));
}

/** Partes liberadas para a empresa. */
export async function enabledFeatures(db: Db, organizationId: string): Promise<Set<FeatureKey>> {
  const rows = await withTenant(db, { organizationId, userId: null }, async (tx) =>
    (await tx.query<{ feature_key: string; enabled: boolean }>(
      "SELECT feature_key, enabled FROM controle_vendas_estoque.organization_features WHERE organization_id = $1",
      [organizationId],
    )).rows,
  );
  return effective(rows);
}

async function assertDeveloper(db: Db, userId: string) {
  const { rows } = await db.query<{ dev: boolean }>("SELECT controle_vendas_estoque.is_platform_developer($1) AS dev", [userId]);
  if (!rows[0]!.dev) throw forbidden("Só o administrador da plataforma pode fazer isso.");
}

/** Liberações de todas as empresas: organizationId → partes ligadas. */
export async function platformFeatures(db: Db, developerUserId: string): Promise<Map<string, Set<FeatureKey>>> {
  await assertDeveloper(db, developerUserId);
  const { rows } = await db.query<{ organization_id: string; feature_key: string; enabled: boolean }>(
    "SELECT organization_id, feature_key, enabled FROM controle_vendas_estoque.platform_features($1)",
    [developerUserId],
  );
  const byOrg = new Map<string, Array<{ feature_key: string; enabled: boolean }>>();
  for (const r of rows) byOrg.set(r.organization_id, [...(byOrg.get(r.organization_id) ?? []), r]);
  const out = new Map<string, Set<FeatureKey>>();
  const orgs = await db.query<{ id: string }>("SELECT id FROM controle_vendas_estoque.platform_organizations($1)", [developerUserId]);
  for (const o of orgs.rows) out.set(o.id, effective(byOrg.get(o.id) ?? []));
  return out;
}

/** Liga ou desliga uma parte para uma empresa (ou para todas, com organizationId null). */
export async function setFeature(
  db: Db,
  developer: { userId: string; userName: string },
  organizationId: string | null,
  key: string,
  enabled: boolean,
): Promise<void> {
  await assertDeveloper(db, developer.userId);
  if (!isFeatureKey(key)) throw new AppError("invalid_input", "Parte do sistema desconhecida.");
  const orgs = (await db.query<{ id: string; name: string }>("SELECT id, name FROM controle_vendas_estoque.platform_organizations($1)", [developer.userId])).rows;
  const targets = organizationId ? orgs.filter((o) => o.id === organizationId) : orgs;
  if (organizationId && targets.length === 0) throw notFound("Empresa");
  const label = FEATURES.find((f) => f.key === key)!.label;
  for (const org of targets) {
    await withTransaction(db, async (tx) => {
      await setTenant(tx, { organizationId: org.id, userId: developer.userId });
      await tx.query(
        `INSERT INTO controle_vendas_estoque.organization_features (organization_id, feature_key, enabled, updated_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (organization_id, feature_key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [org.id, key, enabled, developer.userId],
      );
      await recordAudit(tx, { organizationId: org.id, userId: developer.userId, channel: "web" }, {
        action: enabled ? "feature.enable" : "feature.disable",
        entityType: "organization",
        entityId: org.id,
        summary: `${label} ${enabled ? "liberado" : "desligado"} por ${developer.userName}`,
      });
    });
  }
}
