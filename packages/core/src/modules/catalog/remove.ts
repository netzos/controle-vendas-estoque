import type { Tx } from "@erp/db";
import { z } from "zod";
import { can } from "../../context.ts";
import { forbidden, notFound } from "../../errors.ts";
import type { Permission } from "../../permissions.ts";
import { defineService } from "../../service.ts";

// Excluir qualquer cadastro. Sem histórico, apaga de verdade; com histórico
// (vendas, movimentos, custos...), desativa e esconde para não perder o passado.

interface Kind {
  table: string;
  label: string;
  name: string;
  permission: Permission;
  // Configuração que some junto (não é histórico).
  cleanup?: string[];
  // Uso que não aparece como chave estrangeira.
  inUse?: (tx: Tx, id: string, name: string) => Promise<boolean>;
}

const S = "controle_vendas_estoque";

const KINDS = {
  product: { table: "products", label: "Produto", name: "name", permission: "products.manage", cleanup: [`DELETE FROM ${S}.supplier_products WHERE product_id = $1`, `DELETE FROM ${S}.product_cost_parts WHERE product_id = $1`] },
  category: { table: "categories", label: "Categoria", name: "name", permission: "products.manage" },
  unit: { table: "units", label: "Unidade", name: "name", permission: "products.manage" },
  customer: { table: "customers", label: "Cliente", name: "name", permission: "customers.manage" },
  supplier: { table: "suppliers", label: "Fornecedor", name: "name", permission: "suppliers.manage", cleanup: [`DELETE FROM ${S}.supplier_products WHERE supplier_id = $1`] },
  cost_type: { table: "cost_types", label: "Tipo de custo", name: "name", permission: "costs.manage" },
  step_type: {
    table: "step_types", label: "Etapa", name: "name", permission: "deliveries.manage",
    inUse: async (tx, _id, name) =>
      ((await tx.query(
        `SELECT 1 FROM ${S}.products WHERE $1 = ANY(after_sale_steps) UNION ALL SELECT 1 FROM ${S}.sale_steps WHERE lower(name) = lower($1) LIMIT 1`,
        [name],
      )).rowCount ?? 0) > 0,
  },
  custom_field: {
    table: "custom_fields", label: "Campo", name: "label", permission: "custom_fields.manage",
    inUse: async (tx, id) =>
      ((await tx.query(
        `SELECT 1 FROM ${S}.products p, ${S}.custom_fields f WHERE f.id = $1 AND p.custom_values ? f.key AND p.custom_values ->> f.key <> '' LIMIT 1`,
        [id],
      )).rowCount ?? 0) > 0,
  },
} satisfies Record<string, Kind>;

export type RemovableKind = keyof typeof KINDS;
export const REMOVABLE_KINDS = Object.keys(KINDS) as RemovableKind[];

export interface RemoveResult {
  result: "deleted" | "deactivated";
  message: string;
}

export const removeRecord = defineService({
  name: "records.remove",
  description:
    "Exclui um cadastro (produto, categoria, unidade, cliente, fornecedor, tipo de custo, etapa ou campo personalizado). Se já tiver histórico, desativa em vez de apagar.",
  permission: null,
  risk: 3,
  input: z.object({ kind: z.enum(REMOVABLE_KINDS as [RemovableKind, ...RemovableKind[]]), id: z.string().uuid() }),
  async handler({ tx, actor, audit }, input): Promise<RemoveResult> {
    const kind: Kind = KINDS[input.kind];
    if (!can(actor, kind.permission)) throw forbidden();
    const { rows } = await tx.query<{ name: string; status: string }>(
      `SELECT ${kind.name} AS name, status FROM ${S}.${kind.table} WHERE id = $1 FOR UPDATE`,
      [input.id],
    );
    const row = rows[0];
    if (!row) throw notFound(kind.label);

    let deleted = false;
    if (!(await kind.inUse?.(tx, input.id, row.name))) {
      await tx.query("SAVEPOINT remove_record");
      try {
        for (const sql of kind.cleanup ?? []) await tx.query(sql, [input.id]);
        await tx.query(`DELETE FROM ${S}.${kind.table} WHERE id = $1`, [input.id]);
        await tx.query("RELEASE SAVEPOINT remove_record");
        deleted = true;
      } catch (err) {
        // 23503: outra tabela aponta para este cadastro, então ele tem histórico.
        if ((err as { code?: string }).code !== "23503") throw err;
        await tx.query("ROLLBACK TO SAVEPOINT remove_record");
      }
    }
    if (!deleted) await tx.query(`UPDATE ${S}.${kind.table} SET status = 'inactive' WHERE id = $1`, [input.id]);

    const summary = deleted ? `${kind.label} ${row.name} excluído(a)` : `${kind.label} ${row.name} desativado(a) porque já tem histórico`;
    await audit({ action: `${input.kind}.${deleted ? "delete" : "deactivate"}`, entityType: input.kind, entityId: input.id, summary, before: row });
    return {
      result: deleted ? "deleted" : "deactivated",
      message: deleted
        ? `${row.name} foi excluído(a).`
        : `${row.name} já tem histórico (vendas, movimentos ou custos), então foi desativado(a) e escondido(a) em vez de apagado(a). Dá para reativar em "Mostrar inativos".`,
    };
  },
});
