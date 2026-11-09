"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "./icons";
import { shrinkPhoto } from "@/lib/photo";

// Conversa com a Netz: a mesma lógica serve o balão (computador e telas do
// painel) e a tela cheia do celular (/netz), que abre primeiro no app.

export type NetsMessage = {
  id: string;
  role: "user" | "assistant";
  body: string;
  context: string | null;
  status: "queued" | "processing" | "done" | "failed";
  action: { title: string; service: string } | null;
  actionStatus: "pending" | "running" | "done" | "failed" | "cancelled" | "expired" | null;
  actionResult: string | null;
  attachmentId?: string | null;
  attachmentType?: string | null;
};

const ACTION_LABEL: Record<string, string> = {
  running: "Executando...",
  done: "Feito",
  failed: "Deu erro",
  cancelled: "Cancelado",
  expired: "Ficou sem resposta",
};

// **negrito** e quebras de linha; o resto como texto.
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>,
      )}
    </>
  );
}

export type VoiceState = "idle" | "recording" | "sending";
const VOICE_MAX_MS = 4 * 60 * 1000;

/** Formato que o navegador grava e a transcrição aceita (o iPhone grava em mp4). */
function recorderType(): string | undefined {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return types.find((t) => typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(t));
}

/**
 * Microfone: um toque grava, outro toque para e envia; "cancelar" descarta.
 * O áudio vai para o servidor, que transcreve com a mesma API do Telegram.
 */
export type SpokenAudio = { blob: Blob; seconds: number };

export function useVoice(onText: (text: string, audio: SpokenAudio) => void | Promise<void>, onError: (message: string) => void) {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<VoiceState>("idle");
  const [seconds, setSeconds] = useState(0);
  // Áudio que acabou de ser gravado e está sendo transcrito: já aparece na conversa.
  const [outgoing, setOutgoing] = useState<{ url: string; seconds: number } | null>(null);
  const began = useRef(0);
  // Pausa (como o botão vermelho do WhatsApp) e ondinha ao vivo do microfone.
  const [paused, setPaused] = useState(false);
  const pausedFor = useRef(0);
  const pausedAt = useRef(0);
  const lastLength = useRef(0);
  const [levels, setLevels] = useState<number[]>([]);
  const meter = useRef<{ ctx: AudioContext; timer: ReturnType<typeof setInterval> } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const discard = useRef(false);
  const limit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clock = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const handlers = useRef({ onText, onError });
  handlers.current = { onText, onError };

  useEffect(() => {
    setSupported(typeof window.MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia);
  }, []);

  /** Desliga o microfone de verdade (some o ícone laranja do iPhone). */
  const release = () => {
    if (meter.current) {
      clearInterval(meter.current.timer);
      void meter.current.ctx.close().catch(() => {});
      meter.current = null;
    }
    clearTimeout(limit.current);
    clearInterval(clock.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  useEffect(() => () => {
    discard.current = true;
    try { if (recorder.current?.state === "recording") recorder.current.stop(); } catch { /* já parou */ }
    release();
  }, []);

  const upload = async (blob: Blob, seconds: number) => {
    setState("sending");
    const url = URL.createObjectURL(blob);
    setOutgoing({ url, seconds });
    try {
      const res = await fetch("/api/nets/transcrever", { method: "POST", headers: { "content-type": blob.type || "audio/webm" }, body: blob });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Não consegui transcrever o áudio.");
      await handlers.current.onText(data.text, { blob, seconds });
    } catch (err) {
      handlers.current.onError(err instanceof Error ? err.message : "Não consegui transcrever o áudio.");
    } finally {
      setState("idle");
      setOutgoing(null);
    }
  };

  const finish = (send: boolean) => {
    discard.current = !send;
    lastLength.current = talked();
    pausedAt.current = 0;
    setPaused(false);
    const r = recorder.current;
    try {
      if (r && r.state !== "inactive") r.stop();
      else throw new Error("parado");
    } catch {
      // Gravador já parado: só libera o microfone e volta ao normal.
      release();
      recorder.current = null;
      setState("idle");
    }
    // O microfone desliga na hora, mesmo que o navegador demore para entregar o áudio.
    release();
  };

  const start = async () => {
    if (state !== "idle") return;
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      handlers.current.onError("O celular não liberou o microfone. Permita o acesso ao microfone e tente de novo.");
      return;
    }
    let r: MediaRecorder;
    try {
      const mimeType = recorderType();
      r = mimeType ? new MediaRecorder(s, { mimeType }) : new MediaRecorder(s);
    } catch {
      s.getTracks().forEach((t) => t.stop());
      handlers.current.onError("Este navegador não grava áudio. Digite a mensagem.");
      return;
    }
    const chunks: Blob[] = [];
    discard.current = false;
    r.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    r.onstop = () => {
      release();
      recorder.current = null;
      const blob = new Blob(chunks, { type: (r.mimeType || "audio/webm").split(";")[0] });
      if (!discard.current && blob.size) void upload(blob, Math.max(1, Math.round(lastLength.current / 1000)));
      else setState("idle");
    };
    stream.current = s;
    recorder.current = r;
    r.start();
    setState("recording");
    setSeconds(0);
    began.current = Date.now();
    pausedFor.current = 0;
    setPaused(false);
    setLevels([]);
    clock.current = setInterval(() => setSeconds(Math.floor(talked() / 1000)), 250);
    startMeter(s);
    limit.current = setTimeout(() => finish(true), VOICE_MAX_MS);
  };

  /** Tempo falado, sem contar as pausas. */
  function talked() {
    const now = pausedAt.current || Date.now();
    return now - began.current - pausedFor.current;
  }

  function startMeter(s: MediaStream) {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(s).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const timer = setInterval(() => {
        if (pausedAt.current) return;
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        setLevels((l) => [...l.slice(-39), Math.min(1, peak / 64)]);
      }, 100);
      meter.current = { ctx, timer };
    } catch {
      // Sem ondinha ao vivo; a gravação segue normal.
    }
  }

  const pause = () => {
    const r = recorder.current;
    if (!r) return;
    try {
      if (r.state === "recording") {
        r.pause();
        pausedAt.current = Date.now();
        setPaused(true);
      } else if (r.state === "paused") {
        r.resume();
        pausedFor.current += Date.now() - pausedAt.current;
        pausedAt.current = 0;
        setPaused(false);
      }
    } catch {
      // Navegador sem pausa: continua gravando.
    }
  };

  const toggle = () => (state === "recording" ? finish(true) : void start());
  const cancel = () => state === "recording" && finish(false);
  return { supported, state, toggle, start, cancel, send: () => finish(true), pause, paused, levels, seconds, outgoing };
}

/** Histórico, envio e confirmação de ações. `active` = a conversa está na tela. */
export function useNetsConversation(active: boolean) {
  const [messages, setMessages] = useState<NetsMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const request = useRef<{ id: string; text: string } | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();

  // O histórico é lido com a conversa aberta; enquanto a Netz responde, a cada 2 s.
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const res = await fetch("/api/nets", { signal: controller.signal, cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Não foi possível carregar a conversa.");
        setMessages(data.messages);
        setPending(data.pending);
        setLoaded(true);
        if (data.pending) timer = setTimeout(load, 2000);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Falha ao carregar.");
      }
    };
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [active, tick]);

  const where = useCallback(() => {
    const title = document.querySelector(".page-header h1")?.textContent?.trim();
    const q = search.toString();
    return [title, `${pathname}${q ? `?${q}` : ""}`].filter(Boolean).join(" · ").slice(0, 200);
  }, [pathname, search]);

  // heard = fala transcrita: vai direto, junto com o que já estiver escrito.
  const send = async (heard?: string, audio?: SpokenAudio) => {
    const typed = draftRef.current;
    const text = (heard ? `${typed.trim()} ${heard}` : typed).trim();
    if (busy || pending || !text) return;
    setBusy(true);
    setError("");
    if (request.current?.text !== text) request.current = { id: crypto.randomUUID(), text };
    let context = "";
    try {
      const res = await fetch("/api/nets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: request.current.id, text, context: (context = heard ? `${VOICE_TAG}${audio ? ` (${clock(audio.seconds)})` : ""} · ${where()}`.slice(0, 200) : where()) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha ao enviar.");
      // O áudio fica guardado neste aparelho para tocar de novo, como no WhatsApp.
      if (audio && data.id) rememberAudio(data.id, audio.blob);
      // Aparece na hora, sem esperar a próxima leitura da conversa.
      if (data.id) {
        const mine: NetsMessage = { id: data.id, role: "user", body: text, context, status: "queued", action: null, actionStatus: null, actionResult: null, attachmentId: null, attachmentType: null };
        setMessages((ms) => (ms.some((m) => m.id === data.id) ? ms : [...ms, mine]));
        setPending(true);
      }
      request.current = null;
      setDraft("");
      setTick((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar. Tente de novo.");
    } finally {
      setBusy(false);
    }
  };

  // Comprovante (foto ou PDF): a foto é reduzida aqui antes de subir; o texto digitado vai junto.
  const sendFile = async (file: File) => {
    if (busy || pending) return;
    setBusy(true);
    setError("");
    try {
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      const body = new FormData();
      body.set("file", isPdf ? file : (await shrinkPhoto(file)).blob);
      body.set("name", file.name);
      body.set("text", draftRef.current.trim());
      body.set("context", where());
      body.set("requestId", crypto.randomUUID());
      const res = await fetch("/api/nets/anexo", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha ao enviar o arquivo.");
      if (data.id) {
        const text = draftRef.current.trim() || (isPdf ? "Mandei um PDF de comprovante." : "Mandei uma foto de comprovante.");
        const mine: NetsMessage = { id: data.id, role: "user", body: text, context: where(), status: "queued", action: null, actionStatus: null, actionResult: null, attachmentId: data.attachmentId, attachmentType: data.attachmentType };
        setMessages((ms) => (ms.some((m) => m.id === data.id) ? ms : [...ms, mine]));
        setPending(true);
      }
      setDraft("");
      setTick((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível ler este arquivo. Tente outro.");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (id: string, decision: "confirm" | "cancel") => {
    setError("");
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, actionStatus: decision === "confirm" ? "running" : "cancelled" } : m)));
    try {
      const res = await fetch(`/api/nets/acoes/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha.");
      if (decision === "confirm") router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha.");
    }
    setTick((v) => v + 1);
  };

  const voice = useVoice(
    (heard, audio) => send(heard, audio),
    (message) => setError(message),
  );

  return { messages, loaded, pending, draft, setDraft, busy, error, setError, send, sendFile, decide, voice };
}

export type NetsConversation = ReturnType<typeof useNetsConversation>;

/** Lista de mensagens com os cartões de confirmação. */
export function NetsMessages({ chat, listRef, intro, initials }: { chat: NetsConversation; listRef: React.RefObject<HTMLDivElement | null>; intro?: React.ReactNode; initials?: string }) {
  const { messages, loaded, pending, decide } = chat;
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, pending, listRef, chat.voice.outgoing]);
  return (
    <div className="nets-list" ref={listRef}>
      {!loaded && <p className="nets-note">Carregando...</p>}
      {loaded && messages.length === 0 && (
        intro ?? (
          <div className="nets-empty">
            <p>Oi! Sou a Netz. Fale comigo como falaria com alguém da equipe:</p>
            <ul>
              <li>quanto vendi esta semana?</li>
              <li>vendi 3 latas pro João no Pix</li>
              <li>o que está com estoque baixo?</li>
            </ul>
          </div>
        )
      )}
      {messages.map((m) => (
        <div key={m.id} className={`nets-msg ${m.role}`}>
          {m.role === "user" && spokenLength(m.context) !== null ? (
            <VoiceBubble id={m.id} seconds={spokenLength(m.context)!} transcript={m.body} initials={initials} />
          ) : (
            <>
              {m.attachmentId && <AttachmentPreview id={m.attachmentId} type={m.attachmentType ?? null} />}
              <div className="nets-bubble-text"><Rich text={m.body} /></div>
            </>
          )}
          {m.action && (
            <div className={`nets-action ${m.actionStatus}`}>
              <span>{m.action.title}</span>
              {m.actionStatus === "pending" ? (
                <div className="nets-action-buttons">
                  <button type="button" className="small" onClick={() => decide(m.id, "confirm")}>Confirmar</button>
                  <button type="button" className="secondary small" onClick={() => decide(m.id, "cancel")}>Cancelar</button>
                </div>
              ) : (
                <small>{ACTION_LABEL[m.actionStatus ?? "expired"]}{m.actionStatus === "failed" && m.actionResult ? `: ${m.actionResult}` : ""}</small>
              )}
            </div>
          )}
        </div>
      ))}
      {chat.voice.outgoing && (
        <div className="nets-msg user">
          <VoiceBubble url={chat.voice.outgoing.url} seconds={chat.voice.outgoing.seconds} transcript={null} initials={initials} />
        </div>
      )}
      {pending && <div className="nets-msg assistant"><div className="nets-bubble-text nets-typing" aria-label="A Netz está respondendo"><i /><i /><i /></div></div>}
    </div>
  );
}

/** Miniatura do comprovante na conversa; toca para abrir em tamanho real. */
function AttachmentPreview({ id, type }: { id: string; type: string | null }) {
  const pdf = type === "application/pdf";
  return (
    <a className={`nets-file${pdf ? " pdf" : ""}`} href={`/anexos/${id}`} target="_blank" rel="noreferrer">
      {pdf ? (
        <><Icon name="clip" size={16} /> Comprovante em PDF</>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/anexos/${id}`} alt="Comprovante enviado" loading="lazy" />
      )}
    </a>
  );
}

/** Botão de clipe: escolhe foto (ou tira na hora, no celular) ou PDF do comprovante. */
export function AttachButton({ chat, className, size = 18 }: { chat: NetsConversation; className?: string; size?: number }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className={className ?? "nets-icon-btn"}
        aria-label="Anexar comprovante (foto ou PDF)"
        title="Anexar comprovante (foto ou PDF)"
        disabled={chat.busy || chat.pending || chat.voice.state !== "idle"}
        onClick={() => input.current?.click()}
      >
        <Icon name="clip" size={size} />
      </button>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void chat.sendFile(f);
        }}
      />
    </>
  );
}

export const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * Gravação no mesmo lugar e na mesma altura do campo de mensagem (nada pula):
 * lixeira, tempo com a ondinha ao vivo, pausa e enviar no lugar do microfone.
 */
export function RecordingBar({ chat, big = false }: { chat: NetsConversation; big?: boolean }) {
  const { voice } = chat;
  const bars = [...Array(Math.max(0, 28 - voice.levels.length)).fill(0), ...voice.levels.slice(-28)] as number[];
  return (
    <div className={`nets-recording${big ? " big" : ""}${voice.paused ? " paused" : ""}`} role="group" aria-label="Gravando áudio">
      <button type="button" className="nets-rec-cancel" aria-label="Apagar o áudio" onClick={voice.cancel}>
        <Icon name="trash" size={big ? 22 : 18} />
      </button>
      <div className="nets-rec-pill" aria-live="polite">
        <i className="nets-rec-dot" aria-hidden="true" />
        <strong>{clock(voice.seconds)}</strong>
        <div className="nets-rec-wave" aria-hidden="true">
          {bars.map((v, i) => (
            <i key={i} style={{ height: `${Math.max(3, Math.round(v * 22))}px` }} />
          ))}
        </div>
        <button type="button" className="nets-rec-pause" aria-label={voice.paused ? "Continuar gravando" : "Pausar"} onClick={voice.pause}>
          <Icon name={voice.paused ? "mic" : "pause"} size={big ? 18 : 16} />
        </button>
      </div>
      <button type="button" className="nets-rec-send" aria-label="Enviar o áudio" onClick={voice.send}>
        <Icon name="send" size={big ? 24 : 18} />
      </button>
    </div>
  );
}

// ---------- Áudio na conversa, como no WhatsApp ----------

const VOICE_TAG = "voz transcrita";

/** Mensagem que veio de áudio: devolve a duração em segundos (0 se não souber); null se foi digitada. */
function spokenLength(context: string | null): number | null {
  if (!context || !context.includes(VOICE_TAG)) return null;
  const m = /voz transcrita \((\d+):(\d{2})\)/.exec(context);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

// Os áudios ficam no próprio aparelho (IndexedDB), pela identificação da mensagem.
const AUDIO_DB = "netzsales-audios";
const memory = new Map<string, string>();

function openAudioDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(AUDIO_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("audios");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function rememberAudio(id: string, blob: Blob) {
  memory.set(id, URL.createObjectURL(blob));
  void openAudioDb()
    .then((db) => {
      db.transaction("audios", "readwrite").objectStore("audios").put(blob, id);
    })
    .catch(() => {
      // Sem armazenamento: o áudio só toca até fechar o app; a transcrição continua.
    });
}

async function findAudio(id: string): Promise<string | null> {
  const known = memory.get(id);
  if (known) return known;
  try {
    const db = await openAudioDb();
    const blob = await new Promise<Blob | undefined>((resolve, reject) => {
      const req = db.transaction("audios").objectStore("audios").get(id);
      req.onsuccess = () => resolve(req.result as Blob | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    memory.set(id, url);
    return url;
  } catch {
    return null;
  }
}

// Ondinha fixa (desenho), igual para todos os áudios.
const WAVE = [4, 9, 6, 12, 8, 14, 10, 6, 11, 15, 9, 5, 12, 8, 13, 7, 10, 14, 6, 9, 12, 5, 8, 11, 7, 4];

/** Balão de áudio com play, ondinha, tempo e a transcrição logo abaixo. */
function VoiceBubble({ id, url: given, seconds, transcript, initials }: { id?: string; url?: string; seconds: number; transcript: string | null; initials?: string }) {
  const [url, setUrl] = useState<string | null>(given ?? null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  // Como no WhatsApp: a transcrição fica escondida e abre na setinha.
  const [showText, setShowText] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (given || !id) return;
    let alive = true;
    void findAudio(id).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [id, given]);
  useEffect(() => () => audio.current?.pause(), []);

  const toggle = () => {
    if (!url) return;
    if (!audio.current) {
      const a = new Audio(url);
      a.ontimeupdate = () => {
        const total = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : seconds || 1;
        setElapsed(Math.floor(a.currentTime));
        setProgress(Math.min(1, a.currentTime / total));
      };
      a.onended = () => {
        setPlaying(false);
        setProgress(0);
        setElapsed(0);
      };
      audio.current = a;
    }
    if (playing) {
      audio.current.pause();
      setPlaying(false);
    } else {
      void audio.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  };

  const knob = Math.round(progress * 100);
  return (
    <div className="nets-voice">
      <div className="nets-voice-player">
        <span className="nets-voice-avatar" aria-hidden="true">
          {initials || <Icon name="mic" size={18} />}
          <i><Icon name="mic" size={11} /></i>
        </span>
        <button type="button" className="nets-voice-play" onClick={toggle} disabled={!url} aria-label={url ? (playing ? "Pausar o áudio" : "Ouvir o áudio") : "Áudio gravado em outro aparelho"}>
          <Icon name={playing ? "pause" : "play"} size={22} />
        </button>
        <div className="nets-voice-track">
          <div className="nets-voice-wave" aria-hidden="true">
            {WAVE.map((h, i) => (
              <i key={i} style={{ height: h * 1.4 }} className={i / WAVE.length < progress ? "on" : ""} />
            ))}
            <b style={{ left: `${knob}%` }} />
          </div>
          <small>{playing || elapsed ? clock(elapsed) : seconds ? clock(seconds) : ""}</small>
        </div>
        {transcript !== null && (
          <button
            type="button"
            className={`nets-voice-more${showText ? " open" : ""}`}
            aria-label={showText ? "Esconder a transcrição" : "Ver a transcrição"}
            aria-expanded={showText}
            onClick={() => setShowText((v) => !v)}
          >
            <Icon name="chevron" size={16} />
          </button>
        )}
      </div>
      {transcript === null && <p className="nets-voice-text"><em>Transcrevendo...</em></p>}
      {transcript !== null && showText && <p className="nets-voice-text">{transcript}</p>}
    </div>
  );
}
