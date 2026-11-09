import { getSaleAttachment, isAppError } from "@erp/core";
import { query } from "@/lib/actions";

// Comprovante de venda (foto ou PDF). Só quem está logado na empresa dona do
// arquivo consegue abrir: a consulta passa pelo mesmo filtro de empresa.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Não encontrado", { status: 404 });
  try {
    const file = await query(getSaleAttachment, { id });
    const ext = file.contentType === "application/pdf" ? "pdf" : file.contentType.split("/")[1];
    const name = (file.fileName ?? `comprovante.${ext}`).replace(/[^\w.\- ]/g, "_");
    return new Response(new Uint8Array(file.data), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `inline; filename="${name}"`,
        // O conteúdo de um id nunca muda: arquivo novo ganha id novo.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    if (isAppError(err)) return new Response("Não encontrado", { status: 404 });
    throw err;
  }
}
