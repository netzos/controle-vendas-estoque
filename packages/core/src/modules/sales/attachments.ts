import { z } from "zod";
import { AppError, notFound } from "../../errors.ts";
import { featureEnabled } from "../../features.ts";
import { defineService } from "../../service.ts";
import { sniff } from "../catalog/images.ts";

// Comprovantes da venda (pedido do Netzcode, 2026-11-09): foto do cupom, print
// do Pix ou PDF guardados dentro da venda, e ligados a uma parcela quando for o
// caso. Chegam pelo painel (botão na venda) ou pela Netz (foto na conversa); a
// Netz guarda o arquivo solto e só liga à venda depois que a pessoa confirma.
// Cada comprovante ligado passa pela conferência automática (attachment-check.ts).

export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_SALE = 20;

export type AttachmentContentType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
export type AttachmentSource = "panel" | "netz" | "telegram" | "whatsapp";
export type AttachmentCheckStatus = "pending" | "match" | "mismatch" | "unreadable" | "failed";

export const ATTACHMENT_CHECK_LABELS: Record<AttachmentCheckStatus, string> = {
  pending: "Conferindo...",
  match: "Confere com a venda",
  mismatch: "Não bate com a venda",
  unreadable: "Não deu para ler",
  failed: "Não conferido",
};

export const ATTACHMENT_SOURCE_LABELS: Record<AttachmentSource, string> = {
  panel: "pelo painel",
  netz: "pela Netz",
  telegram: "pelo Telegram",
  whatsapp: "pelo WhatsApp",
};

export interface SaleAttachment {
  id: string;
  saleId: string | null;
  installmentId: string | null;
  installmentNumber: number | null;
  contentType: AttachmentContentType;
  fileName: string | null;
  bytes: number;
  source: AttachmentSource;
  notes: string | null;
  checkStatus: AttachmentCheckStatus | null;
  checkAmount: string | null;
  checkDate: string | null;
  checkMethod: string | null;
  checkNote: string | null;
  createdAt: Date;
  userName: string | null;
}

/** Tipo pelo conteúdo (primeiros bytes), nunca pelo nome do arquivo. */
export function sniffAttachment(data: Uint8Array): AttachmentContentType | null {
  if (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) return "application/pdf"; // %PDF
  return sniff(data);
}

const COLUMNS = `a.id, a.sale_id AS "saleId", a.installment_id AS "installmentId", i.number AS "installmentNumber",
  a.content_type AS "contentType", a.file_name AS "fileName", octet_length(a.data) AS bytes, a.source, a.notes,
  a.check_status AS "checkStatus", a.check_amount::text AS "checkAmount", to_char(a.check_date, 'YYYY-MM-DD') AS "checkDate",
  a.check_method AS "checkMethod", a.check_note AS "checkNote", a.created_at AS "createdAt", u.name AS "userName"`;
const FROM = `controle_vendas_estoque.sale_attachments a
  LEFT JOIN controle_vendas_estoque.sale_installments i ON i.id = a.installment_id
  LEFT JOIN controle_vendas_estoque.users u ON u.id = a.created_by`;

const uuidOrNull = z.string().uuid().nullable().optional();

function cleanName(name: string | null | undefined): string | null {
  const n = (name ?? "").replace(/[\\/\r\n\t]/g, " ").trim().slice(0, 160);
  return n || null;
}

function validFile(data: Uint8Array): AttachmentContentType {
  if (data.byteLength === 0) throw new AppError("invalid_input", "Arquivo vazio.");
  if (data.byteLength > MAX_ATTACHMENT_BYTES) throw new AppError("invalid_input", "Arquivo muito grande. O limite é 4 MB.");
  const type = sniffAttachment(data);
  if (!type) throw new AppError("invalid_input", "Formato não aceito. Envie uma foto (JPG, PNG ou WebP) ou um PDF.");
  return type;
}

/** Venda e parcela conferidas antes de ligar um comprovante. */
async function saleTarget(tx: import("@erp/db").Tx, saleId: string, installmentId: string | null | undefined) {
  const sale = await tx.query<{ number: number }>("SELECT number FROM controle_vendas_estoque.sales WHERE id = $1 FOR UPDATE", [saleId]);
  if (!sale.rows[0]) throw notFound("Venda");
  if (installmentId) {
    const inst = await tx.query("SELECT 1 FROM controle_vendas_estoque.sale_installments WHERE id = $1 AND sale_id = $2", [installmentId, saleId]);
    if (!inst.rowCount) throw new AppError("invalid_input", "Essa parcela não é desta venda.");
  }
  const count = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM controle_vendas_estoque.sale_attachments WHERE sale_id = $1", [saleId]);
  if (count.rows[0]!.n >= MAX_ATTACHMENTS_PER_SALE) throw new AppError("invalid_input", `Cada venda pode ter até ${MAX_ATTACHMENTS_PER_SALE} comprovantes.`);
  return sale.rows[0];
}

async function requireFeature(tx: import("@erp/db").Tx, organizationId: string) {
  if (!(await featureEnabled(tx, organizationId, "attachments"))) {
    throw new AppError("forbidden", "Comprovantes nas vendas estão desligados. Ligue em Ajustes › Recursos.");
  }
}

/** Sem chave da IA não há conferência: o comprovante fica guardado sem selo. */
const initialCheck = () => (process.env.ANTHROPIC_API_KEY ? "pending" : null);

export const listSaleAttachments = defineService({
  name: "sales.attachments.list",
  description: "Lista os comprovantes de pagamento (fotos e PDFs) anexados a uma venda, com o resultado da conferência automática (valor lido e se bate com a venda)",
  permission: "sales.view",
  risk: 1,
  input: z.object({ saleId: z.string().uuid() }),
  async handler({ tx }, input) {
    const { rows } = await tx.query<SaleAttachment>(`SELECT ${COLUMNS} FROM ${FROM} WHERE a.sale_id = $1 ORDER BY a.created_at`, [input.saleId]);
    return rows;
  },
});

export const getSaleAttachment = defineService({
  name: "sales.attachments.get",
  description: "Devolve o arquivo de um comprovante",
  permission: "sales.view",
  risk: 1,
  input: z.object({ id: z.string().uuid() }),
  async handler({ tx }, input) {
    const { rows } = await tx.query<{ contentType: AttachmentContentType; fileName: string | null; data: Buffer }>(
      `SELECT content_type AS "contentType", file_name AS "fileName", data FROM controle_vendas_estoque.sale_attachments WHERE id = $1`,
      [input.id],
    );
    if (!rows[0]) throw notFound("Comprovante");
    return rows[0];
  },
});

export const addSaleAttachment = defineService({
  name: "sales.attachments.add",
  description: "Anexa um comprovante de pagamento (foto ou PDF) a uma venda",
  permission: "sales.receive",
  risk: 2,
  input: z.object({
    saleId: z.string().uuid(),
    installmentId: uuidOrNull,
    data: z.instanceof(Uint8Array),
    fileName: z.string().max(300).nullable().optional(),
    notes: z.string().trim().max(300).nullable().optional(),
  }),
  async handler({ tx, actor, audit }, input) {
    await requireFeature(tx, actor.organizationId);
    const contentType = validFile(input.data);
    const sale = await saleTarget(tx, input.saleId, input.installmentId);
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO controle_vendas_estoque.sale_attachments
         (organization_id, sale_id, installment_id, content_type, file_name, data, source, notes, check_status, linked_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'panel', $7, $8, now(), $9) RETURNING id`,
      [actor.organizationId, input.saleId, input.installmentId ?? null, contentType, cleanName(input.fileName), Buffer.from(input.data),
        input.notes || null, initialCheck(), actor.userId],
    );
    const id = rows[0]!.id;
    await audit({
      action: "sale.attachment_add", entityType: "sale", entityId: input.saleId,
      summary: `Comprovante anexado à venda nº ${sale.number}`, after: { attachmentId: id, contentType, installmentId: input.installmentId ?? null },
    });
    return { id, saleId: input.saleId };
  },
});

/** Comprovante que chegou pela conversa: fica guardado, ainda sem venda. */
export const stashSaleAttachment = defineService({
  name: "sales.attachments.stash",
  description: "Guarda um comprovante que chegou pela conversa, antes de ligar a uma venda",
  permission: "sales.view",
  risk: 2,
  input: z.object({
    data: z.instanceof(Uint8Array),
    fileName: z.string().max(300).nullable().optional(),
    source: z.enum(["netz", "telegram", "whatsapp"]),
  }),
  async handler({ tx, actor }, input) {
    await requireFeature(tx, actor.organizationId);
    const contentType = validFile(input.data);
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO controle_vendas_estoque.sale_attachments (organization_id, content_type, file_name, data, source, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [actor.organizationId, contentType, cleanName(input.fileName), Buffer.from(input.data), input.source, actor.userId],
    );
    return { id: rows[0]!.id, contentType };
  },
});

export const linkSaleAttachment = defineService({
  name: "sales.attachments.link",
  description:
    "Liga à venda o comprovante de pagamento (foto ou PDF) que a pessoa mandou na conversa; o id vem na mensagem [Anexo: comprovante ...]. Se o pagamento for de uma parcela, informe installmentId. Depois de ligado, o sistema confere o comprovante com a venda",
  permission: "sales.receive",
  risk: 2,
  input: z.object({
    attachmentId: z.string().uuid(),
    saleId: z.string().uuid(),
    installmentId: uuidOrNull,
    notes: z.string().trim().max(300).nullable().optional(),
  }),
  async handler({ tx, actor, audit }, input) {
    await requireFeature(tx, actor.organizationId);
    const found = await tx.query<{ saleId: string | null }>(
      `SELECT sale_id AS "saleId" FROM controle_vendas_estoque.sale_attachments WHERE id = $1 FOR UPDATE`,
      [input.attachmentId],
    );
    if (!found.rows[0]) throw notFound("Comprovante");
    if (found.rows[0].saleId && found.rows[0].saleId !== input.saleId) {
      throw new AppError("conflict", "Esse comprovante já está ligado a outra venda.");
    }
    const sale = await saleTarget(tx, input.saleId, input.installmentId);
    await tx.query(
      `UPDATE controle_vendas_estoque.sale_attachments
          SET sale_id = $2, installment_id = $3, notes = coalesce($4, notes), linked_at = now(),
              check_status = $5, check_amount = NULL, check_date = NULL, check_method = NULL, check_note = NULL, checked_at = NULL
        WHERE id = $1`,
      [input.attachmentId, input.saleId, input.installmentId ?? null, input.notes || null, initialCheck()],
    );
    await audit({
      action: "sale.attachment_link", entityType: "sale", entityId: input.saleId,
      summary: `Comprovante ligado à venda nº ${sale.number}`, after: { attachmentId: input.attachmentId, installmentId: input.installmentId ?? null },
    });
    return { id: input.attachmentId, saleId: input.saleId, saleNumber: sale.number, check: initialCheck() ? "O sistema vai conferir o comprovante com a venda." : null };
  },
});

export const removeSaleAttachment = defineService({
  name: "sales.attachments.remove",
  description: "Remove um comprovante de uma venda",
  permission: "sales.receive",
  risk: 2,
  input: z.object({ id: z.string().uuid() }),
  async handler({ tx, audit }, input) {
    const { rows } = await tx.query<{ saleId: string | null; number: number | null }>(
      `SELECT a.sale_id AS "saleId", s.number FROM controle_vendas_estoque.sale_attachments a
         LEFT JOIN controle_vendas_estoque.sales s ON s.id = a.sale_id WHERE a.id = $1 FOR UPDATE OF a`,
      [input.id],
    );
    if (rows[0]) await tx.query("DELETE FROM controle_vendas_estoque.sale_attachments WHERE id = $1", [input.id]);
    if (!rows[0]) throw notFound("Comprovante");
    if (rows[0].saleId) {
      await audit({ action: "sale.attachment_remove", entityType: "sale", entityId: rows[0].saleId, summary: `Comprovante removido da venda nº ${rows[0].number}`, before: { attachmentId: input.id } });
    }
    return { ok: true };
  },
});

/** Pedir a conferência de novo (ex.: depois de corrigir a venda). */
export const recheckSaleAttachment = defineService({
  name: "sales.attachments.recheck",
  description: "Pede para conferir de novo um comprovante com a venda",
  permission: "sales.receive",
  risk: 1,
  input: z.object({ id: z.string().uuid() }),
  async handler({ tx }, input) {
    if (!initialCheck()) throw new AppError("invalid_input", "A conferência automática precisa da chave da IA (ANTHROPIC_API_KEY).");
    const { rowCount } = await tx.query(
      "UPDATE controle_vendas_estoque.sale_attachments SET check_status = 'pending' WHERE id = $1 AND sale_id IS NOT NULL",
      [input.id],
    );
    if (!rowCount) throw notFound("Comprovante");
    return { ok: true };
  },
});
