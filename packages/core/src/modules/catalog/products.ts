import { z } from "zod";
import { can } from "../../context.ts";
import { AppError, forbidden, notFound } from "../../errors.ts";
import { defineService } from "../../service.ts";
import { applyMovement } from "../stock/movements.ts";
import { decimalField, optionalText, statusField, uuidOrNull } from "./fields.ts";

export interface Category {
  id: string;
  name: string;
  status: "active" | "inactive";
  productCount: number;
}

export interface Unit {
  id: string;
  code: string;
  name: string;
  decimals: number;
  status: "active" | "inactive";
}

export interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  unitId: string;
  unitCode: string;
  supplierId: string | null;
  supplierName: string | null;
  // numeric chega como texto: "12.50".
  salePrice: string;
  costPrice: string;
  minStock: string;
  stockQty: string;
  /** Falso para serviços e itens sem estoque. */
  trackStock: boolean;
  status: "active" | "inactive";
  createdAt: Date;
}

// Categorias ---------------------------------------------------------------------

const categoryFields = z.object({ name: z.string().trim().min(2, "Informe o nome da categoria.").max(80) });

export const listCategories = defineService({
  name: "categories.list",
  description: "Lista as categorias de produtos",
  permission: "products.view",
  risk: 1,
  input: z.object({ includeInactive: z.boolean().default(false) }),
  async handler({ tx }, input) {
    const { rows } = await tx.query<Category>(
      `SELECT c.id, c.name, c.status,
              (SELECT count(*) FROM controle_vendas_estoque.products p WHERE p.category_id = c.id)::int AS "productCount"
         FROM controle_vendas_estoque.categories c
        WHERE ($1 OR c.status = 'active') ORDER BY lower(c.name)`,
      [input.includeInactive],
    );
    return rows;
  },
});

async function assertCategoryNameFree(tx: import("@erp/db").Tx, name: string, id?: string) {
  const dup = await tx.query("SELECT 1 FROM controle_vendas_estoque.categories WHERE lower(name) = lower($1) AND ($2::uuid IS NULL OR id <> $2)", [name, id ?? null]);
  if (dup.rowCount) throw new AppError("conflict", `Já existe a categoria ${name}.`);
}

export const createCategory = defineService({
  name: "categories.create",
  description: "Cadastra uma categoria de produtos",
  permission: "products.manage",
  risk: 2,
  input: categoryFields,
  async handler({ tx, actor, audit, emit }, input) {
    await assertCategoryNameFree(tx, input.name);
    const { rows } = await tx.query<{ id: string; name: string }>(
      `INSERT INTO controle_vendas_estoque.categories (organization_id, name) VALUES ($1, $2) RETURNING id, name`,
      [actor.organizationId, input.name],
    );
    const c = rows[0]!;
    await audit({ action: "category.create", entityType: "category", entityId: c.id, summary: `Categoria ${c.name} criada`, after: c });
    await emit("category.created", { categoryId: c.id }, { type: "category", id: c.id });
    return c;
  },
});

export const updateCategory = defineService({
  name: "categories.update",
  description: "Renomeia ou desativa uma categoria",
  permission: "products.manage",
  risk: 2,
  input: categoryFields.extend({ id: z.string().uuid(), status: statusField }),
  async handler({ tx, audit, emit }, input) {
    const before = await tx.query<{ id: string; name: string; status: string }>(
      "SELECT id, name, status FROM controle_vendas_estoque.categories WHERE id = $1 FOR UPDATE",
      [input.id],
    );
    const current = before.rows[0];
    if (!current) throw notFound("Categoria");
    await assertCategoryNameFree(tx, input.name, input.id);
    const { rows } = await tx.query<{ id: string; name: string; status: string }>(
      "UPDATE controle_vendas_estoque.categories SET name = $2, status = $3 WHERE id = $1 RETURNING id, name, status",
      [input.id, input.name, input.status],
    );
    const after = rows[0]!;
    const fields = (["name", "status"] as const).filter((f) => current[f] !== after[f]);
    if (fields.length > 0) {
      await audit({ action: "category.update", entityType: "category", entityId: after.id, summary: `Categoria ${after.name} alterada`, before: current, after });
      await emit("category.updated", { categoryId: after.id, fields: [...fields] }, { type: "category", id: after.id });
    }
    return after;
  },
});

// Unidades de medida ---------------------------------------------------------------

const unitFields = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,6}$/, "Use até 6 letras ou números, por exemplo UN ou KG."),
  name: z.string().trim().min(2, "Informe o nome da unidade.").max(40),
  decimals: z.coerce.number().int().min(0).max(3),
});

const UNIT_COLUMNS = "id, code, name, decimals, status";

export const listUnits = defineService({
  name: "units.list",
  description: "Lista as unidades de medida",
  permission: "products.view",
  risk: 1,
  input: z.object({ includeInactive: z.boolean().default(false) }),
  async handler({ tx }, input) {
    const { rows } = await tx.query<Unit>(
      `SELECT ${UNIT_COLUMNS} FROM controle_vendas_estoque.units WHERE ($1 OR status = 'active') ORDER BY code`,
      [input.includeInactive],
    );
    return rows;
  },
});

export const createUnit = defineService({
  name: "units.create",
  description: "Cadastra uma unidade de medida",
  permission: "products.manage",
  risk: 2,
  input: unitFields,
  async handler({ tx, actor, audit, emit }, input) {
    const dup = await tx.query("SELECT 1 FROM controle_vendas_estoque.units WHERE code = $1", [input.code]);
    if (dup.rowCount) throw new AppError("conflict", `Já existe a unidade ${input.code}.`);
    const { rows } = await tx.query<Unit>(
      `INSERT INTO controle_vendas_estoque.units (organization_id, code, name, decimals) VALUES ($1, $2, $3, $4) RETURNING ${UNIT_COLUMNS}`,
      [actor.organizationId, input.code, input.name, input.decimals],
    );
    const u = rows[0]!;
    await audit({ action: "unit.create", entityType: "unit", entityId: u.id, summary: `Unidade ${u.code} criada`, after: u });
    await emit("unit.created", { unitId: u.id }, { type: "unit", id: u.id });
    return u;
  },
});

export const updateUnit = defineService({
  name: "units.update",
  description: "Altera ou desativa uma unidade de medida",
  permission: "products.manage",
  risk: 2,
  input: unitFields.extend({ id: z.string().uuid(), status: statusField }),
  async handler({ tx, audit, emit }, input) {
    const before = await tx.query<Unit>(`SELECT ${UNIT_COLUMNS} FROM controle_vendas_estoque.units WHERE id = $1 FOR UPDATE`, [input.id]);
    const current = before.rows[0];
    if (!current) throw notFound("Unidade");
    const dup = await tx.query("SELECT 1 FROM controle_vendas_estoque.units WHERE code = $1 AND id <> $2", [input.code, input.id]);
    if (dup.rowCount) throw new AppError("conflict", `Já existe a unidade ${input.code}.`);
    if (input.status === "inactive" && current.status === "active") {
      const used = await tx.query("SELECT 1 FROM controle_vendas_estoque.products WHERE unit_id = $1 AND status = 'active' LIMIT 1", [input.id]);
      if (used.rowCount) throw new AppError("conflict", "Há produtos ativos usando esta unidade.");
    }
    const { rows } = await tx.query<Unit>(
      `UPDATE controle_vendas_estoque.units SET code = $2, name = $3, decimals = $4, status = $5 WHERE id = $1 RETURNING ${UNIT_COLUMNS}`,
      [input.id, input.code, input.name, input.decimals, input.status],
    );
    const after = rows[0]!;
    const fields = (["code", "name", "decimals", "status"] as const).filter((f) => current[f] !== after[f]);
    if (fields.length > 0) {
      await audit({ action: "unit.update", entityType: "unit", entityId: after.id, summary: `Unidade ${after.code} alterada`, before: current, after });
      await emit("unit.updated", { unitId: after.id, fields: [...fields] }, { type: "unit", id: after.id });
    }
    return after;
  },
});

// Produtos -------------------------------------------------------------------------

const PRODUCT_COLUMNS = `p.id, p.sku, p.barcode, p.name, p.description, p.category_id AS "categoryId", c.name AS "categoryName",
  p.unit_id AS "unitId", u.code AS "unitCode", p.supplier_id AS "supplierId", s.name AS "supplierName",
  p.sale_price::text AS "salePrice", p.cost_price::text AS "costPrice", p.min_stock::text AS "minStock",
  p.stock_qty::text AS "stockQty", p.track_stock AS "trackStock", p.status, p.created_at AS "createdAt"`;
const PRODUCT_FROM = `controle_vendas_estoque.products p
  JOIN controle_vendas_estoque.units u ON u.id = p.unit_id
  LEFT JOIN controle_vendas_estoque.categories c ON c.id = p.category_id
  LEFT JOIN controle_vendas_estoque.suppliers s ON s.id = p.supplier_id`;

async function getProduct(tx: import("@erp/db").Tx, id: string, lock = false): Promise<Product | undefined> {
  // FOR UPDATE OF p: bloqueia só o produto, não as tabelas ligadas.
  const { rows } = await tx.query<Product>(`SELECT ${PRODUCT_COLUMNS} FROM ${PRODUCT_FROM} WHERE p.id = $1${lock ? " FOR UPDATE OF p" : ""}`, [id]);
  return rows[0];
}

const productFields = z.object({
  sku: z.string().trim().regex(/^[A-Za-z0-9._/-]{1,40}$/, "Código: até 40 letras, números, ponto, hífen ou barra."),
  barcode: z.preprocess(
    (v) => (typeof v === "string" ? (v.replace(/\D/g, "") || null) : v),
    z.string().regex(/^[0-9]{8,14}$/, "Código de barras: de 8 a 14 dígitos.").nullable().optional(),
  ),
  name: z.string().trim().min(2, "Informe o nome do produto.").max(160),
  description: optionalText(2000),
  categoryId: uuidOrNull,
  unitId: z.string().uuid("Escolha a unidade de medida."),
  supplierId: uuidOrNull,
  salePrice: decimalField(2, "Preço de venda"),
  costPrice: decimalField(4, "Custo"),
  minStock: decimalField(3, "Estoque mínimo"),
  trackStock: z.boolean().default(true),
});

async function assertProductRefs(tx: import("@erp/db").Tx, input: z.output<typeof productFields>, id?: string) {
  const sku = await tx.query("SELECT 1 FROM controle_vendas_estoque.products WHERE sku = $1 AND ($2::uuid IS NULL OR id <> $2)", [input.sku, id ?? null]);
  if (sku.rowCount) throw new AppError("conflict", `Já existe um produto com o código ${input.sku}.`);
  if (input.barcode) {
    const bc = await tx.query<{ name: string }>(
      "SELECT name FROM controle_vendas_estoque.products WHERE barcode = $1 AND ($2::uuid IS NULL OR id <> $2)",
      [input.barcode, id ?? null],
    );
    if (bc.rows[0]) throw new AppError("conflict", `Este código de barras já é do produto ${bc.rows[0].name}.`);
  }
  // As referências são conferidas sob RLS: id de outra empresa não aparece.
  const unit = await tx.query("SELECT 1 FROM controle_vendas_estoque.units WHERE id = $1 AND status = 'active'", [input.unitId]);
  if (!unit.rowCount) throw new AppError("invalid_input", "Unidade de medida não encontrada ou inativa.");
  if (input.categoryId) {
    const c = await tx.query("SELECT 1 FROM controle_vendas_estoque.categories WHERE id = $1", [input.categoryId]);
    if (!c.rowCount) throw new AppError("invalid_input", "Categoria não encontrada.");
  }
  if (input.supplierId) {
    const s = await tx.query("SELECT 1 FROM controle_vendas_estoque.suppliers WHERE id = $1", [input.supplierId]);
    if (!s.rowCount) throw new AppError("invalid_input", "Fornecedor não encontrado.");
  }
}

export const listProducts = defineService({
  name: "products.list",
  description: "Lista e busca produtos por nome, código ou código de barras",
  permission: "products.view",
  risk: 1,
  input: z.object({
    search: z.string().trim().max(100).optional(),
    categoryId: z.string().uuid().optional(),
    includeInactive: z.boolean().default(false),
    limit: z.number().int().min(1).max(500).default(200),
  }),
  async handler({ tx }, input) {
    const params: unknown[] = [input.includeInactive];
    let where = "";
    if (input.search) {
      params.push(`%${input.search.toLowerCase()}%`);
      where += ` AND (lower(p.name) LIKE $${params.length} OR lower(p.sku) LIKE $${params.length} OR p.barcode = $${params.length + 1})`;
      params.push(input.search.replace(/\D/g, "") || null);
    }
    if (input.categoryId) {
      params.push(input.categoryId);
      where += ` AND p.category_id = $${params.length}`;
    }
    params.push(input.limit);
    const { rows } = await tx.query<Product>(
      `SELECT ${PRODUCT_COLUMNS} FROM ${PRODUCT_FROM}
        WHERE ($1 OR p.status = 'active')${where} ORDER BY lower(p.name) LIMIT $${params.length}`,
      params,
    );
    return rows;
  },
});

export const createProduct = defineService({
  name: "products.create",
  description: "Cadastra um produto com código, unidade, preço de venda, custo e estoque mínimo",
  permission: "products.manage",
  risk: 2,
  input: productFields.extend({ initialStock: decimalField(3, "Estoque inicial").default("0") }),
  async handler({ tx, actor, audit, emit }, input) {
    if ((Number(input.salePrice) !== 0 || Number(input.costPrice) !== 0) && !can(actor, "products.update_price")) {
      throw forbidden("Você não tem permissão para definir preço e custo. Cadastre sem preço e peça a quem tem.");
    }
    await assertProductRefs(tx, input);
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO controle_vendas_estoque.products
         (organization_id, sku, barcode, name, description, category_id, unit_id, supplier_id, sale_price, cost_price, min_stock, track_stock)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [actor.organizationId, input.sku, input.barcode ?? null, input.name, input.description ?? null, input.categoryId ?? null,
        input.unitId, input.supplierId ?? null, input.salePrice, input.costPrice, input.minStock, input.trackStock],
    );
    if (input.trackStock && Number(input.initialStock) > 0) {
      if (!can(actor, "stock.manage")) throw forbidden("Você não tem permissão para lançar estoque. Cadastre sem estoque inicial.");
      await applyMovement(tx, actor, { productId: rows[0]!.id, kind: "in", quantity: input.initialStock, unitCost: input.costPrice, notes: "Estoque inicial" });
    }
    const product = (await getProduct(tx, rows[0]!.id))!;
    await audit({ action: "product.create", entityType: "product", entityId: product.id, summary: `Produto ${product.name} (${product.sku}) cadastrado`, after: product });
    await emit("product.created", { productId: product.id }, { type: "product", id: product.id });
    return product;
  },
});

export const updateProduct = defineService({
  name: "products.update",
  description: "Altera dados, preço ou situação de um produto",
  permission: "products.manage",
  risk: 2,
  input: productFields.extend({ id: z.string().uuid(), status: statusField }),
  async handler({ tx, actor, audit, emit }, input) {
    const current = await getProduct(tx, input.id, true);
    if (!current) throw notFound("Produto");
    const priceChanged = Number(current.salePrice) !== Number(input.salePrice) || Number(current.costPrice) !== Number(input.costPrice);
    if (priceChanged && !can(actor, "products.update_price")) {
      throw forbidden("Você não tem permissão para alterar preço ou custo.");
    }
    await assertProductRefs(tx, input, input.id);
    await tx.query(
      `UPDATE controle_vendas_estoque.products SET sku = $2, barcode = $3, name = $4, description = $5, category_id = $6,
              unit_id = $7, supplier_id = $8, sale_price = $9, cost_price = $10, min_stock = $11, status = $12, track_stock = $13
        WHERE id = $1`,
      [input.id, input.sku, input.barcode ?? null, input.name, input.description ?? null, input.categoryId ?? null, input.unitId,
        input.supplierId ?? null, input.salePrice, input.costPrice, input.minStock, input.status, input.trackStock],
    );
    const after = (await getProduct(tx, input.id))!;
    const fields = (["sku", "barcode", "name", "description", "categoryId", "unitId", "supplierId", "salePrice", "costPrice", "minStock", "trackStock", "status"] as const)
      .filter((f) => current[f] !== after[f]);
    if (fields.length > 0) {
      await audit({ action: "product.update", entityType: "product", entityId: after.id, summary: `Produto ${after.name} (${after.sku}) alterado`, before: current, after });
      await emit("product.updated", { productId: after.id, fields: [...fields] }, { type: "product", id: after.id });
    }
    if (priceChanged) {
      await audit({
        action: "product.price_change",
        entityType: "product",
        entityId: after.id,
        summary: `Preço de ${after.name}: venda ${current.salePrice} → ${after.salePrice}, custo ${current.costPrice} → ${after.costPrice}`,
        before: { salePrice: current.salePrice, costPrice: current.costPrice },
        after: { salePrice: after.salePrice, costPrice: after.costPrice },
      });
      await emit(
        "product.price_changed",
        { productId: after.id, salePrice: after.salePrice, costPrice: after.costPrice, previousSalePrice: current.salePrice, previousCostPrice: current.costPrice },
        { type: "product", id: after.id },
      );
    }
    return after;
  },
});
