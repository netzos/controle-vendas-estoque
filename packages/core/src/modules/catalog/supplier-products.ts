import { z } from "zod";
import { AppError, notFound } from "../../errors.ts";
import { defineService } from "../../service.ts";
import { daysField, decimalField, optionalText } from "./fields.ts";

// Preço combinado com cada fornecedor, por produto. Um produto pode ter
// vários fornecedores; o mais barato aparece primeiro na ficha do produto.

export interface SupplierProduct {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierWhatsapp: string | null;
  productId: string;
  productName: string;
  sku: string;
  unitCode: string;
  costPrice: string;
  agreedPrice: string;
  supplierCode: string | null;
  // Prazo do vínculo; se vazio, o prazo padrão do fornecedor.
  leadTimeDays: number | null;
  notes: string | null;
  updatedAt: Date;
}

const COLUMNS = `sp.id, sp.supplier_id AS "supplierId", s.name AS "supplierName", s.whatsapp AS "supplierWhatsapp",
  sp.product_id AS "productId", p.name AS "productName", p.sku, u.code AS "unitCode", p.cost_price::text AS "costPrice",
  sp.agreed_price::text AS "agreedPrice", sp.supplier_code AS "supplierCode",
  coalesce(sp.lead_time_days, s.lead_time_days) AS "leadTimeDays", sp.notes, sp.updated_at AS "updatedAt"`;
const FROM = `controle_vendas_estoque.supplier_products sp
  JOIN controle_vendas_estoque.suppliers s ON s.id = sp.supplier_id
  JOIN controle_vendas_estoque.products p ON p.id = sp.product_id
  JOIN controle_vendas_estoque.units u ON u.id = p.unit_id`;

export const listSupplierProducts = defineService({
  name: "suppliers.prices.list",
  description: "Lista os preços combinados com fornecedores, de um fornecedor ou de um produto",
  permission: "suppliers.view",
  risk: 1,
  input: z.object({ supplierId: z.string().uuid().optional(), productId: z.string().uuid().optional() }),
  async handler({ tx }, input) {
    const { rows } = await tx.query<SupplierProduct>(
      `SELECT ${COLUMNS} FROM ${FROM}
        WHERE ($1::uuid IS NULL OR sp.supplier_id = $1) AND ($2::uuid IS NULL OR sp.product_id = $2)
        ORDER BY ${input.productId ? "sp.agreed_price, lower(s.name)" : "lower(p.name)"}`,
      [input.supplierId ?? null, input.productId ?? null],
    );
    return rows;
  },
});

export const setSupplierProduct = defineService({
  name: "suppliers.prices.set",
  description: "Grava o preço combinado de um produto com um fornecedor",
  permission: "suppliers.manage",
  risk: 2,
  input: z.object({
    supplierId: z.string().uuid("Escolha o fornecedor."),
    productId: z.string().uuid("Escolha o produto."),
    agreedPrice: decimalField(4, "Preço combinado"),
    supplierCode: optionalText(60),
    leadTimeDays: daysField,
    notes: optionalText(500),
  }),
  async handler({ tx, actor, audit, emit }, input) {
    const supplier = await tx.query<{ name: string }>("SELECT name FROM controle_vendas_estoque.suppliers WHERE id = $1", [input.supplierId]);
    if (!supplier.rows[0]) throw notFound("Fornecedor");
    const product = await tx.query<{ name: string }>("SELECT name FROM controle_vendas_estoque.products WHERE id = $1", [input.productId]);
    if (!product.rows[0]) throw notFound("Produto");
    const previous = await tx.query<{ price: string }>(
      "SELECT agreed_price::text AS price FROM controle_vendas_estoque.supplier_products WHERE supplier_id = $1 AND product_id = $2 FOR UPDATE",
      [input.supplierId, input.productId],
    );
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO controle_vendas_estoque.supplier_products
         (organization_id, supplier_id, product_id, agreed_price, supplier_code, lead_time_days, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (organization_id, supplier_id, product_id) DO UPDATE
         SET agreed_price = EXCLUDED.agreed_price, supplier_code = EXCLUDED.supplier_code,
             lead_time_days = EXCLUDED.lead_time_days, notes = EXCLUDED.notes
       RETURNING id`,
      [actor.organizationId, input.supplierId, input.productId, input.agreedPrice, input.supplierCode ?? null,
        input.leadTimeDays ?? null, input.notes ?? null],
    );
    const id = rows[0]!.id;
    const after = (await tx.query<SupplierProduct>(`SELECT ${COLUMNS} FROM ${FROM} WHERE sp.id = $1`, [id])).rows[0]!;
    const previousPrice = previous.rows[0]?.price ?? null;
    await audit({
      action: "supplier.price_set",
      entityType: "supplier",
      entityId: input.supplierId,
      summary: `Preço combinado de ${product.rows[0].name} com ${supplier.rows[0].name}: ${after.agreedPrice}`,
      before: previousPrice == null ? undefined : { agreedPrice: previousPrice },
      after,
    });
    if (previousPrice == null || Number(previousPrice) !== Number(after.agreedPrice)) {
      await emit("supplier.price_set", { supplierId: input.supplierId, productId: input.productId, agreedPrice: after.agreedPrice, previousPrice }, { type: "supplier", id: input.supplierId });
    }
    return after;
  },
});

export const removeSupplierProduct = defineService({
  name: "suppliers.prices.remove",
  description: "Desfaz o vínculo de um produto com um fornecedor",
  permission: "suppliers.manage",
  risk: 2,
  input: z.object({ id: z.string().uuid() }),
  async handler({ tx, audit, emit }, input) {
    const current = (await tx.query<SupplierProduct>(`SELECT ${COLUMNS} FROM ${FROM} WHERE sp.id = $1 FOR UPDATE OF sp`, [input.id])).rows[0];
    if (!current) throw new AppError("not_found", "Este preço combinado não existe mais.");
    await tx.query("DELETE FROM controle_vendas_estoque.supplier_products WHERE id = $1", [input.id]);
    await audit({
      action: "supplier.price_remove",
      entityType: "supplier",
      entityId: current.supplierId,
      summary: `${current.productName} deixou de ser comprado de ${current.supplierName}`,
      before: current,
    });
    await emit("supplier.price_removed", { supplierId: current.supplierId, productId: current.productId }, { type: "supplier", id: current.supplierId });
    return { ok: true };
  },
});
