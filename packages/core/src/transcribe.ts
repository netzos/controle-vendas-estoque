// Transcrição de áudio (mensagens de voz do Telegram). Usa a API da OpenAI
// (OPENAI_API_KEY) ou, se só existir GROQ_API_KEY, o Whisper da Groq; as duas
// falam o mesmo formato. Desligada enquanto nenhuma chave estiver na Vercel.

export interface AudioFile {
  data: Uint8Array<ArrayBuffer>;
  fileName: string;
  mimeType?: string;
}

export type Transcriber = (audio: AudioFile) => Promise<string>;

let override: Transcriber | null = null;

// Para testes: substitui a transcrição real.
export function setTranscriber(transcriber: Transcriber | null) {
  override = transcriber;
}

function provider(): { url: string; key: string; model: string } | null {
  const openai = (process.env.OPENAI_API_KEY ?? "").trim();
  if (openai) return { url: "https://api.openai.com/v1/audio/transcriptions", key: openai, model: process.env.TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe" };
  const groq = (process.env.GROQ_API_KEY ?? "").trim();
  if (groq) return { url: "https://api.groq.com/openai/v1/audio/transcriptions", key: groq, model: process.env.TRANSCRIBE_MODEL ?? "whisper-large-v3-turbo" };
  return null;
}

export function transcriptionConfigured(): boolean {
  return override !== null || provider() !== null;
}

export interface Transcription {
  text: string;
  provider: string;
  model: string;
  /** Duração do áudio, para o custo de uso. */
  seconds: number;
}

/** Transcreve e diz quem transcreveu e quantos segundos tinha o áudio. */
export async function transcribeAudioDetailed(audio: AudioFile, knownSeconds?: number): Promise<Transcription> {
  // Sem a duração, estima pelo tamanho (fala gravada em opus fica perto de 3 KB por segundo).
  const estimate = knownSeconds ?? Math.max(1, audio.data.byteLength / 3000);
  if (override) return { text: await override(audio), provider: "teste", model: "teste", seconds: estimate };
  const p = provider();
  if (!p) throw new Error("Transcrição de áudio não configurada");
  const form = new FormData();
  form.append("file", new Blob([audio.data], { type: audio.mimeType ?? "audio/ogg" }), audio.fileName);
  form.append("model", p.model);
  form.append("language", "pt");
  form.append("response_format", "json");
  const res = await fetch(p.url, { method: "POST", headers: { Authorization: `Bearer ${p.key}` }, body: form });
  const data = (await res.json().catch(() => null)) as { text?: string; usage?: { seconds?: number }; error?: { message?: string } } | null;
  if (!res.ok) throw new Error(`Falha na transcrição (${res.status}${data?.error?.message ? `: ${data.error.message}` : ""})`);
  return {
    text: (data?.text ?? "").trim(),
    provider: p.url.includes("groq") ? "groq" : "openai",
    model: p.model,
    seconds: data?.usage?.seconds ?? estimate,
  };
}

export async function transcribeAudio(audio: AudioFile): Promise<string> {
  return (await transcribeAudioDetailed(audio)).text;
}
