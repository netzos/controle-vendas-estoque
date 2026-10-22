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

type Defaults = Map<string, boolean>;

/** Padrão de cada parte: o que o administrador escolheu para todas ou, sem escolha, o do código. */
async function featureDefaults(db: Db): Promise<Defaults> {
  const { rows } = await db.query<{ feature_key: string; enabled: boolean }>(
    "SELECT feature_key, enabled FROM controle_vendas_estoque.platform_feature_defaults",
  );
  return new Map(rows.map((r) => [r.feature_key, r.enabled]));
}

function defaultOf(defaults: Defaults, key: FeatureKey): boolean {
  return defaults.get(key) ?? FEATURES.find((f) => f.key === key)!.defaultOn;
}

function effective(defaults: Defaults, rows: Array<{ feature_key: string; enabled: boolean }>): Set<FeatureKey> {
  const chosen = new Map(rows.map((r) => [r.feature_key, r.enabled]));
  return new Set(FEATURES.filter((f) => chosen.get(f.key) ?? defaultOf(defaults, f.key)).map((f) => f.key));
}

/** Partes liberadas para a empresa. */
export async function enabledFeatures(db: Db, organizationId: string): Promise<Set<FeatureKey>> {
  const [defaults, rows] = await Promise.all([
    featureDefaults(db),
    withTenant(db, { organizationId, userId: null }, async (tx) =>
      (await tx.query<{ feature_key: string; enabled: boolean }>(
        "SELECT feature_key, enabled FROM controle_vendas_estoque.organization_features WHERE organization_id = $1",
        [organizationId],
      )).rows,
    ),
  ]);
  return effective(defaults, rows);
}

async function assertDeveloper(db: Db, userId: string) {
  const { rows } = await db.query<{ dev: boolean }>("SELECT controle_vendas_estoque.is_platform_developer($1) AS dev", [userId]);
  if (!rows[0]!.dev) throw forbidden("Só o administrador da plataforma pode fazer isso.");
}

/** Liberações de todas as empresas: organizationId → partes ligadas. */
export async function platformFeatures(db: Db, developerUserId: string): Promise<Map<string, Set<FeatureKey>>> {
  await assertDeveloper(db, developerUserId);
  const [defaults, { rows }, orgs] = await Promise.all([
    featureDefaults(db),
    db.query<{ organization_id: string; feature_key: string; enabled: boolean }>(
      "SELECT organization_id, feature_key, enabled FROM controle_vendas_estoque.platform_features($1)",
      [developerUserId],
    ),
    db.query<{ id: string }>("SELECT id FROM controle_vendas_estoque.platform_organizations($1)", [developerUserId]),
  ]);
  const byOrg = new Map<string, Array<{ feature_key: string; enabled: boolean }>>();
  for (const r of rows) byOrg.set(r.organization_id, [...(byOrg.get(r.organization_id) ?? []), r]);
  const out = new Map<string, Set<FeatureKey>>();
  for (const o of orgs.rows) out.set(o.id, effective(defaults, byOrg.get(o.id) ?? []));
  return out;
}

export interface FeatureRollout {
  key: FeatureKey;
  label: string;
  description: string;
  /** Vale para todas as empresas, inclusive as novas. */
  defaultOn: boolean;
  /** Empresas de cliente com a parte ligada / total de empresas de cliente. */
  enabledCount: number;
  total: number;
  /** Empresas que fogem do padrão. */
  exceptions: Array<{ id: string; name: string; kind: string; enabled: boolean }>;
}

/**
 * Situação de cada parte do sistema: o padrão e as exceções. Funciona igual
 * com 3 ou com milhares de empresas (a tela mostra só o padrão e as exceções).
 */
export async function featureRollouts(db: Db, developerUserId: string): Promise<FeatureRollout[]> {
  await assertDeveloper(db, developerUserId);
  const [defaults, { rows }, orgs] = await Promise.all([
    featureDefaults(db),
    db.query<{ organization_id: string; feature_key: string; enabled: boolean }>(
      "SELECT organization_id, feature_key, enabled FROM controle_vendas_estoque.platform_features($1)",
      [developerUserId],
    ),
    db.query<{ id: string; name: string; kind: string }>("SELECT id, name, kind FROM controle_vendas_estoque.platform_organizations($1)", [developerUserId]),
  ]);
  const orgById = new Map(orgs.rows.map((o) => [o.id, o]));
  const customers = orgs.rows.filter((o) => o.kind === "customer").length;
  return FEATURES.map((f) => {
    const def = defaultOf(defaults, f.key);
    const exceptions = rows
      .filter((r) => r.feature_key === f.key && r.enabled !== def && orgById.has(r.organization_id))
      .map((r) => ({ ...orgById.get(r.organization_id)!, enabled: r.enabled }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    const customerExceptions = exceptions.filter((e) => e.kind === "customer").length;
    return {
      key: f.key,
      label: f.label,
      description: f.description,
      defaultOn: def,
      enabledCount: def ? customers - customerExceptions : customerExceptions,
      total: customers,
      exceptions,
    };
  });
}

/** Liga ou desliga uma parte para uma empresa (exceção ao padrão). */
export async function setFeature(
  db: Db,
  developer: { userId: string; userName: string },
  organizationId: string | null,
  key: string,
  enabled: boolean,
): Promise<void> {
  await assertDeveloper(db, developer.userId);
  if (!isFeatureKey(key)) throw new AppError("invalid_input", "Parte do sistema desconhecida.");
  if (!organizationId) return setFeatureDefault(db, developer, key, enabled);
  const orgs = (await db.query<{ id: string; name: string }>("SELECT id, name FROM controle_vendas_estoque.platform_organizations($1)", [developer.userId])).rows;
  const org = orgs.find((o) => o.id === organizationId);
  if (!org) throw notFound("Empresa");
  const label = FEATURES.find((f) => f.key === key)!.label;
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

/** Liga ou desliga uma parte para todas as empresas, inclusive as novas (desfaz as exceções). */
export async function setFeatureDefault(db: Db, developer: { userId: string }, key: string, enabled: boolean): Promise<void> {
  await assertDeveloper(db, developer.userId);
  if (!isFeatureKey(key)) throw new AppError("invalid_input", "Parte do sistema desconhecida.");
  await db.query("SELECT controle_vendas_estoque.platform_set_feature_default($1, $2, $3)", [developer.userId, key, enabled]);
}
