import { can, type Actor } from "../../context.ts";
import { AppError, forbidden } from "../../errors.ts";
import { transcribeAudio, transcriptionConfigured, type AudioFile } from "../../transcribe.ts";

// Microfone do balão da Netz: o navegador grava e manda o áudio; a transcrição
// é a mesma do Telegram (OpenAI ou Groq).

// A Vercel recusa corpos acima de 4,5 MB (uns 5 minutos de fala gravada).
export const NETS_AUDIO_MAX_BYTES = 4 * 1024 * 1024;

const EXT: Record<string, string> = { webm: "webm", ogg: "ogg", mp4: "m4a", "x-m4a": "m4a", aac: "m4a", mpeg: "mp3", wav: "wav" };

/** Nome com a extensão que a API de transcrição reconhece, a partir do tipo do arquivo. */
export function audioFileName(mimeType: string): string {
  const sub = /^audio\/([\w-]+)/.exec(mimeType.toLowerCase())?.[1] ?? "webm";
  return `fala.${EXT[sub] ?? "webm"}`;
}

export async function transcribeForNets(actor: Actor, audio: { data: Uint8Array<ArrayBuffer>; mimeType: string }): Promise<{ text: string }> {
  if (!can(actor, "nets.use")) throw forbidden("Você não tem permissão para conversar com a Netz.");
  if (!transcriptionConfigured()) throw new AppError("invalid_input", "A transcrição de áudio ainda não foi ligada (falta OPENAI_API_KEY na Vercel).");
  if (audio.data.byteLength === 0) throw new AppError("invalid_input", "Não chegou nenhum áudio. Tente de novo.");
  if (audio.data.byteLength > NETS_AUDIO_MAX_BYTES) throw new AppError("invalid_input", "A gravação ficou longa demais. Fale em partes de até 4 minutos.");
  const file: AudioFile = { data: audio.data, fileName: audioFileName(audio.mimeType), mimeType: audio.mimeType.split(";")[0] };
  let text: string;
  try {
    text = await transcribeAudio(file);
  } catch (err) {
    console.error("nets transcribe", err instanceof Error ? err.message : err);
    throw new AppError("invalid_input", "Não consegui transcrever agora. Tente de novo ou digite.");
  }
  if (!text.trim()) throw new AppError("invalid_input", "Não consegui entender o áudio. Pode repetir?");
  return { text: text.trim() };
}
