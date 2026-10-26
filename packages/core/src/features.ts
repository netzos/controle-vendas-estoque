import type { Db, Tx } from "@erp/db";
import { setTenant, withTenant, withTransaction } from "@erp/db";
import { recordAudit } from "./audit.ts";
import { AppError, forbidden, notFound } from "./errors.ts";

// Duas camadas, como as Liberações do NetzOS:
// 1. Liberações: o administrador da plataforma diz o que cada empresa PODE usar.
//    Sem escolha gravada, vale defaultOn. Uma novidade entra com defaultOn: false.
// 2. Recursos (Ajustes › Recursos): a própria empresa liga só o que faz sentido
//    para o negócio dela. Os que têm `company` aparecem lá. Empresa nova nasce
//    com a escolha gravada (company.defaultOn); empresa antiga, sem escolha
//    gravada, segue como era (ligado). O básico de vender não tem botão.
export const FEATURES = [
  {
    key: "deliveries",
    label: "Entregas e serviços depois da venda",
    description: "Entregas e etapas depois da venda (instalação, montagem...).",
    defaultOn: true,
    company: { defaultOn: false, hint: "Para quem entrega em casa, instala ou monta. Abre a escolha Retirada ou Entrega na venda e a página Entregas e serviços." },
  },
  {
    key: "trade_in",
    label: "Receber item na troca",
    description: "O cliente dá um item como parte do pagamento (carro de entrada, celular usado).",
    defaultOn: true,
    company: { defaultOn: false, hint: "O item recebido entra no estoque com o valor da troca como custo. Aparece o botão \"Recebeu um item na troca\" na venda." },
  },
  {
    key: "costs",
    label: "Custos e lucro real",
    description: "Painel de custos, custo de obtenção e tipos de custo.",
    defaultOn: true,
    company: { defaultOn: false, hint: "Lance aluguel, frete, mão de obra e veja quanto sobra de verdade depois de todos os gastos." },
  },
  {
    key: "custom_fields",
    label: "Campos personalizados",
    description: "Campos extras no cadastro dos produtos.",
    defaultOn: true,
    company: { defaultOn: false, hint: "Informações a mais em cada produto, como cor, tamanho ou número de série." },
  },
  { key: "netz", label: "Netz no painel", description: "O balão da assistente em todas as telas.", defaultOn: true },
  { key: "telegram", label: "Telegram", description: "Conversar com a Netz pelo Telegram.", defaultOn: true },
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

export const SETTING_PREFIX = "features.";

type CompanyFeature = Extract<(typeof FEATURES)[number], { company: unknown }>;
export type CompanyFeatureKey = CompanyFeature["key"];
export const COMPANY_FEATURES = FEATURES.filter((f): f is CompanyFeature => "company" in f);

export function isCompanyFeatureKey(key: string): key is CompanyFeatureKey {
  return COMPANY_FEATURES.some((f) => f.key === key);
}

/** O que a empresa escolheu ligar. Sem escolha gravada (empresa de antes dos Recursos), fica ligado. */
function companyAllows(chosen: Map<string, unknown>, key: FeatureKey): boolean {
  const v = chosen.get(SETTING_PREFIX + key);
  return typeof v === "boolean" ? v : true;
}

/** Empresa nova: grava a escolha inicial de cada recurso (só o básico ligado). */
export async function seedCompanyFeatures(tx: Tx, organizationId: string): Promise<void> {
  await tx.query(
    `INSERT INTO controle_vendas_estoque.organization_settings (organization_id, key, value)
     SELECT $1, k, v FROM unnest($2::text[], $3::jsonb[]) AS t(k, v)`,
    [organizationId, COMPANY_FEATURES.map((f) => SETTING_PREFIX + f.key), COMPANY_FEATURES.map((f) => JSON.stringify(f.company.defaultOn))],
  );
}

interface FeatureState {
  /** Liberadas pela plataforma. */
  available: Set<FeatureKey>;
  /** Liberadas e ligadas pela empresa: o que vale nas telas e nos serviços. */
  enabled: Set<FeatureKey>;
}

async function featureState(tx: Tx, defaults: Defaults, organizationId: string): Promise<FeatureState> {
  const [platform, company] = await Promise.all([
    tx.query<{ feature_key: string; enabled: boolean }>(
      "SELECT feature_key, enabled FROM controle_vendas_estoque.organization_features WHERE organization_id = $1",
      [organizationId],
    ),
    tx.query<{ key: string; value: unknown }>(
      "SELECT key, value FROM controle_vendas_estoque.organization_settings WHERE organization_id = $1 AND key LIKE 'features.%'",
      [organizationId],
    ),
  ]);
  const available = effective(defaults, platform.rows);
  const chosen = new Map(company.rows.map((r) => [r.key, r.value]));
  return { available, enabled: new Set([...available].filter((k) => companyAllows(chosen, k))) };
}

/** Partes que valem para a empresa: liberadas pela plataforma e ligadas pela empresa. */
export async function enabledFeatures(db: Db, organizationId: string): Promise<Set<FeatureKey>> {
  const defaults = await featureDefaults(db);
  return (await withTenant(db, { organizationId, userId: null }, (tx) => featureState(tx, defaults, organizationId))).enabled;
}

/** Dentro de um serviço: a parte vale para a empresa atual? */
export async function featureEnabled(tx: Tx, organizationId: string, key: FeatureKey): Promise<boolean> {
  const { rows } = await tx.query<{ feature_key: string; enabled: boolean }>(
    "SELECT feature_key, enabled FROM controle_vendas_estoque.platform_feature_defaults",
  );
  const defaults: Defaults = new Map(rows.map((r) => [r.feature_key, r.enabled]));
  return (await featureState(tx, defaults, organizationId)).enabled.has(key);
}

export interface CompanyFeatureChoice {
  key: CompanyFeatureKey;
  label: string;
  hint: string;
  enabled: boolean;
}

/** Recursos que a empresa pode ligar e desligar em Ajustes (só os liberados pela plataforma). */
export async function companyFeatureChoices(db: Db, organizationId: string): Promise<CompanyFeatureChoice[]> {
  const defaults = await featureDefaults(db);
  const state = await withTenant(db, { organizationId, userId: null }, (tx) => featureState(tx, defaults, organizationId));
  return COMPANY_FEATURES.filter((f) => state.available.has(f.key)).map((f) => ({
    key: f.key,
    label: f.label,
    hint: f.company.hint,
    enabled: state.enabled.has(f.key),
  }));
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
