import { z } from "zod";
import { AppError, notFound } from "../../errors.ts";
import { defineService } from "../../service.ts";

// Fotos dos itens. O painel reduz a imagem no navegador antes de enviar; o
// Telegram e a API mandam a versão já reduzida. Aqui só conferimos o formato
// pelos primeiros bytes e o tamanho.

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGES_PER_PRODUCT = 8;

export interface ProductImage {
  id: string;
  productId: string;
  position: number;
  width: number | null;
  height: number | null;
  bytes: number;
}

export function sniff(data: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
  const ascii = (a: number, b: number) => String.fromCharCode(...data.subarray(a, b));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

const COLUMNS = `id, product_id AS "productId", position, width, height, octet_length(data) AS bytes`;

export const listProductImages = defineService({
  name: "products.images.list",
  description: "Lista as fotos de um item, a capa primeiro",
  permission: "products.view",
  risk: 1,
  input: z.object({ productId: z.string().uuid() }),
  async handler({ tx }, input) {
    const { rows } = await tx.query<ProductImage>(
      `SELECT ${COLUMNS} FROM controle_vendas_estoque.product_images WHERE product_id = $1 ORDER BY position, created_at`,
      [input.productId],
    );
    return rows;
  },
});

export const getProductImage = defineService({
  name: "products.images.get",
  description: "Devolve o arquivo de uma foto",
  permission: "products.view",
  risk: 1,
  input: z.object({ id: z.string().uuid() }),
  async handler({ tx }, input) {
    const { rows } = await tx.query<{ contentType: string; data: Buffer }>(
      `SELECT content_type AS "contentType", data FROM controle_vendas_estoque.product_images WHERE id = $1`,
      [input.id],
    );
    if (!rows[0]) throw notFound("Foto");
    return rows[0];
  },
});

export const addProductImage = defineService({
  name: "products.images.add",
  description: "Adiciona uma foto a um item",
  permission: "products.manage",
  risk: 2,
  input: z.object({
    productId: z.string().uuid(),
    data: z.instanceof(Uint8Array),
    width: z.number().int().min(1).max(10000).optional(),
    height: z.number().int().min(1).max(10000).optional(),
  }),
  async handler({ tx, actor, audit }, input) {
    if (input.data.byteLength === 0) throw new AppError("invalid_input", "Arquivo vazio.");
    if (input.data.byteLength > MAX_IMAGE_BYTES) throw new AppError("invalid_input", "Foto muito grande. O limite é 2 MB.");
    const contentType = sniff(input.data);
    if (!contentType) throw new AppError("invalid_input", "Formato não aceito. Envie JPG, PNG ou WebP.");
    const product = await tx.query<{ name: string }>("SELECT name FROM controle_vendas_estoque.products WHERE id = $1 FOR UPDATE", [input.productId]);
    if (!product.rows[0]) throw notFound("Produto");
    const count = await tx.query<{ n: number; next: number }>(
      "SELECT count(*)::int AS n, coalesce(max(position) + 1, 0)::int AS next FROM controle_vendas_estoque.product_images WHERE product_id = $1",
      [input.productId],
    );
    if (count.rows[0]!.n >= MAX_IMAGES_PER_PRODUCT) throw new AppError("invalid_input", `Cada item pode ter até ${MAX_IMAGES_PER_PRODUCT} fotos.`);
    const { rows } = await tx.query<ProductImage>(
      `INSERT INTO controle_vendas_estoque.product_images
         (organization_id, product_id, position, content_type, data, width, height, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLUMNS}`,
      [actor.organizationId, input.productId, count.rows[0]!.next, contentType, Buffer.from(input.data),
        input.width ?? null, input.height ?? null, actor.userId],
    );
    const image = rows[0]!;
    await audit({ action: "product.image_add", entityType: "product", entityId: input.productId, summary: `Foto adicionada a ${product.rows[0].name}`, after: image });
    return image;
  },
});

export const removeProductImage = defineService({
  name: "products.images.remove",
  description: "Remove uma foto de um item",
  permission: "products.manage",
  risk: 2,
  input: z.object({ id: z.string().uuid() }),
  async handler({ tx, audit }, input) {
    const { rows } = await tx.query<ProductImage>(
      `DELETE FROM controle_vendas_estoque.product_images WHERE id = $1 RETURNING ${COLUMNS}`,
      [input.id],
    );
    if (!rows[0]) throw notFound("Foto");
    await audit({ action: "product.image_remove", entityType: "product", entityId: rows[0].productId, summary: "Foto removida", before: rows[0] });
    return { ok: true };
  },
});

// A capa é a foto de menor posição: a escolhida vai para antes de todas.
export const setProductCover = defineService({
  name: "products.images.cover",
  description: "Define a foto de capa de um item",
  permission: "products.manage",
  risk: 1,
  input: z.object({ id: z.string().uuid() }),
  async handler({ tx }, input) {
    const { rowCount } = await tx.query(
      `UPDATE controle_vendas_estoque.product_images i
          SET position = (SELECT coalesce(min(position), 0) - 1 FROM controle_vendas_estoque.product_images o WHERE o.product_id = i.product_id)
        WHERE id = $1`,
      [input.id],
    );
    if (!rowCount) throw notFound("Foto");
    return { ok: true };
  },
});
