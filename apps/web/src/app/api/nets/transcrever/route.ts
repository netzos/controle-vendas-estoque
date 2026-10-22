import { NETS_AUDIO_MAX_BYTES, transcribeForNets } from "@erp/core";
import { apiError, unauthorized } from "@/lib/claude-api";
import { netsActor } from "@/lib/nets-api";

export const dynamic = "force-dynamic";

// Recebe a gravação do balão da Netz (corpo = o áudio) e devolve o texto.
export async function POST(req: Request) {
  const actor = await netsActor(req);
  if (!actor) return unauthorized();
  const size = Number(req.headers.get("content-length") ?? 0);
  if (size > NETS_AUDIO_MAX_BYTES) return Response.json({ error: "A gravação ficou longa demais. Fale em partes de até 4 minutos." }, { status: 413 });
  try {
    const data = new Uint8Array(await req.arrayBuffer());
    return Response.json(await transcribeForNets(actor, { data, mimeType: req.headers.get("content-type") ?? "audio/webm" }));
  } catch (err) {
    return apiError(err);
  }
}
