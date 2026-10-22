import { z } from "zod";
import { AppError } from "../../errors.ts";
import { defineService } from "../../service.ts";

// Configurações gerais da organização. Cada chave tem schema e valor padrão;
// as fases seguintes registram as suas aqui (vendas, estoque, IA...).
export const SETTINGS = {
  "general.trade_name_on_documents": {
    label: "Nome exibido em documentos e mensagens",
    description: "Se vazio, usa o nome da empresa.",
    schema: z.string().trim().max(120),
    default: "",
  },
  "general.week_start": {
    label: "Primeiro dia da semana nos relatórios",
    description: "Usado em resumos semanais e comparativos.",
    schema: z.enum(["sunday", "monday"]),
    default: "monday" as "sunday" | "monday",
  },
  "general.quantity_decimals": {
    label: "Casas decimais em quantidades",
    description: "Precisão padrão para quantidades fracionadas (kg, litros).",
    schema: z.number().int().min(0).max(4),
    default: 3,
  },
  "sales.default_fulfillment": {
    label: "Como a venda chega ao cliente, por padrão",
    description: "Retirada no local não cobra frete nem abre a etapa Entrega. Dá para trocar em cada venda.",
    schema: z.enum(["pickup", "delivery"]),
    default: "pickup" as "pickup" | "delivery",
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValues = { [K in SettingKey]: z.output<(typeof SETTINGS)[K]["schema"]> };

const keys = Object.keys(SETTINGS) as SettingKey[];

export const getSettings = defineService({
  name: "settings.get",
  description: "Consulta as configurações gerais da empresa",
  permission: null,
  risk: 1,
  input: z.object({}),
  async handler({ tx }) {
    const { rows } = await tx.query<{ key: string; value: unknown }>(
      "SELECT key, value FROM controle_vendas_estoque.organization_settings WHERE key = ANY($1::text[])",
      [keys],
    );
    const stored = new Map(rows.map((r) => [r.key, r.value]));
    const values = {} as Record<string, unknown>;
    for (const key of keys) {
      const parsed = SETTINGS[key].schema.safeParse(stored.get(key));
      values[key] = parsed.success ? parsed.data : SETTINGS[key].default;
    }
    return values as SettingValues;
  },
});

export const updateSettings = defineService({
  name: "settings.update",
  description: "Altera configurações gerais da empresa",
  permission: "settings.update",
  risk: 3,
  input: z.record(z.string(), z.unknown()),
  async handler({ tx, actor, audit, emit }, input) {
    const changed: string[] = [];
    for (const [key, raw] of Object.entries(input)) {
      if (!(key in SETTINGS)) throw new AppError("invalid_input", `Configuração desconhecida: ${key}`);
      const def = SETTINGS[key as SettingKey];
      const parsed = def.schema.safeParse(raw);
      if (!parsed.success) throw new AppError("invalid_input", `Valor inválido para "${def.label}".`);
      const prev = await tx.query<{ value: unknown }>("SELECT value FROM controle_vendas_estoque.organization_settings WHERE key = $1", [key]);
      const before = prev.rows[0]?.value ?? def.default;
      if (JSON.stringify(before) === JSON.stringify(parsed.data)) continue;
      await tx.query(
        `INSERT INTO controle_vendas_estoque.organization_settings (organization_id, key, value, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (organization_id, key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [actor.organizationId, key, JSON.stringify(parsed.data), actor.userId],
      );
      await audit({ action: "settings.update", entityType: "setting", entityId: key, summary: `Configuração "${def.label}" alterada`, before, after: parsed.data });
      await emit("settings.updated", { key }, { type: "setting", id: key });
      changed.push(key);
    }
    return { changed };
  },
});
