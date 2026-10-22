import { getProductImage, isAppError } from "@erp/core";
import { query } from "@/lib/actions";

// Foto de item. Só quem está logado na empresa dona da foto consegue ver
// (a consulta passa pelo mesmo filtro de empresa do resto do sistema).
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Não encontrada", { status: 404 });
  try {
    const image = await query(getProductImage, { id });
    return new Response(new Uint8Array(image.data), {
      headers: {
        "Content-Type": image.contentType,
        // O id nunca muda de conteúdo: foto nova ganha id novo.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    if (isAppError(err)) return new Response("Não encontrada", { status: 404 });
    throw err;
  }
}
