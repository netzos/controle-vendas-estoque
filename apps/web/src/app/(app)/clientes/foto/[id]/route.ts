import { getCustomerPhoto, isAppError } from "@erp/core";
import { query } from "@/lib/actions";

// Foto do cliente, só para quem está logado na empresa dele. Foto nova ganha id novo.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Não encontrada", { status: 404 });
  try {
    const photo = await query(getCustomerPhoto, { photoId: id });
    return new Response(new Uint8Array(photo.data), {
      headers: { "Content-Type": photo.contentType, "Cache-Control": "private, max-age=31536000, immutable" },
    });
  } catch (err) {
    if (isAppError(err)) return new Response("Não encontrada", { status: 404 });
    throw err;
  }
}
