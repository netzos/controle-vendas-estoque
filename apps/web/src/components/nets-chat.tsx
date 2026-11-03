"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "./icons";

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

/**
 * iPhone e iPad: o reconhecimento de voz do Safari junto com a gravação trava a
 * tela (no app da tela de início ele falha e se religa sem parar, e o microfone
 * fica aceso). Neles gravamos só o áudio; o texto vem do servidor.
 */
function isAppleMobile(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

// Reconhecimento de voz do navegador (Chrome, Edge). Onde não existe ou não é
// seguro, a gravação funciona igual, só sem o texto ao vivo.
interface LiveRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type LiveRecognitionCtor = new () => LiveRecognition;

/** Formato que o navegador grava e a transcrição aceita (o iPhone grava em mp4). */
function recorderType(): string | undefined {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return types.find((t) => typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(t));
}

/**
 * Microfone: um toque grava, outro toque para e envia; "cancelar" descarta.
 * O áudio vai para o servidor, que transcreve com a mesma API do Telegram.
 */
export function useVoice(onText: (text: string) => void, onError: (message: string) => void) {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<VoiceState>("idle");
  const [seconds, setSeconds] = useState(0);
  // Melhoria 16: o que o navegador entende enquanto a pessoa fala.
  const [live, setLive] = useState("");
  const recognition = useRef<LiveRecognition | null>(null);
  const restarts = useRef(0);
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

  const stopLive = () => {
    const rec = recognition.current;
    recognition.current = null;
    try { rec?.abort(); } catch { /* já parou */ }
  };
  /** Desliga o microfone de verdade (some o ícone laranja do iPhone). */
  const release = () => {
    clearTimeout(limit.current);
    clearInterval(clock.current);
    stopLive();
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  useEffect(() => () => {
    discard.current = true;
    try { if (recorder.current?.state === "recording") recorder.current.stop(); } catch { /* já parou */ }
    release();
  }, []);

  const startLive = () => {
    setLive("");
    if (isAppleMobile()) return;
    const w = window as unknown as { SpeechRecognition?: LiveRecognitionCtor; webkitSpeechRecognition?: LiveRecognitionCtor };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    restarts.current = 0;
    try {
      const rec = new Ctor();
      rec.lang = "pt-BR";
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (e) => {
        let text = "";
        for (let i = 0; i < e.results.length; i++) text += e.results[i]![0]!.transcript;
        setLive(text.trim());
      };
      rec.onerror = () => {};
      // Alguns navegadores param depois de um silêncio: volta a ouvir, com pausa e no máximo 5 vezes.
      rec.onend = () => {
        if (recognition.current !== rec || recorder.current?.state !== "recording" || restarts.current >= 5) return;
        restarts.current += 1;
        setTimeout(() => {
          if (recognition.current === rec && recorder.current?.state === "recording") {
            try { rec.start(); } catch { /* desiste do texto ao vivo */ }
          }
        }, 300);
      };
      recognition.current = rec;
      rec.start();
    } catch {
      recognition.current = null;
    }
  };

  const upload = async (blob: Blob) => {
    setState("sending");
    try {
      const res = await fetch("/api/nets/transcrever", { method: "POST", headers: { "content-type": blob.type || "audio/webm" }, body: blob });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Não consegui transcrever o áudio.");
      handlers.current.onText(data.text);
    } catch (err) {
      handlers.current.onError(err instanceof Error ? err.message : "Não consegui transcrever o áudio.");
    } finally {
      setState("idle");
      setLive("");
    }
  };

  const finish = (send: boolean) => {
    discard.current = !send;
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
      if (!discard.current && blob.size) void upload(blob);
      else setState("idle");
    };
    stream.current = s;
    recorder.current = r;
    r.start();
    setState("recording");
    setSeconds(0);
    const began = Date.now();
    clock.current = setInterval(() => setSeconds(Math.floor((Date.now() - began) / 1000)), 500);
    startLive();
    limit.current = setTimeout(() => finish(true), VOICE_MAX_MS);
  };

  const toggle = () => (state === "recording" ? finish(true) : void start());
  const cancel = () => state === "recording" && finish(false);
  return { supported, state, toggle, start, cancel, send: () => finish(true), live, seconds };
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
  const send = async (heard?: string) => {
    const typed = draftRef.current;
    const text = (heard ? `${typed.trim()} ${heard}` : typed).trim();
    if (busy || pending || !text) return;
    setBusy(true);
    setError("");
    if (request.current?.text !== text) request.current = { id: crypto.randomUUID(), text };
    try {
      const res = await fetch("/api/nets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: request.current.id, text, context: heard ? `voz transcrita · ${where()}`.slice(0, 200) : where() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha ao enviar.");
      request.current = null;
      setDraft("");
      setTick((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar. Tente de novo.");
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
    (heard) => void send(heard),
    (message) => setError(message),
  );

  return { messages, loaded, pending, draft, setDraft, busy, error, setError, send, decide, voice };
}

export type NetsConversation = ReturnType<typeof useNetsConversation>;

/** Lista de mensagens com os cartões de confirmação. */
export function NetsMessages({ chat, listRef, intro }: { chat: NetsConversation; listRef: React.RefObject<HTMLDivElement | null>; intro?: React.ReactNode }) {
  const { messages, loaded, pending, decide } = chat;
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, pending, listRef]);
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
          <div className="nets-bubble-text"><Rich text={m.body} /></div>
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
      {pending && <div className="nets-msg assistant"><div className="nets-bubble-text nets-typing" aria-label="A Netz está respondendo"><i /><i /><i /></div></div>}
    </div>
  );
}

export const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Barra de gravação: lixeira, tempo e enviar (como no WhatsApp). */
export function RecordingBar({ chat, big = false }: { chat: NetsConversation; big?: boolean }) {
  const { voice } = chat;
  return (
    <div className={`nets-recording${big ? " big" : ""}`} role="group" aria-label="Gravando áudio">
      <button type="button" className="nets-rec-cancel" aria-label="Cancelar o áudio" onClick={voice.cancel}>
        <Icon name="trash" size={big ? 24 : 18} />
      </button>
      <div className="nets-rec-info" aria-live="polite">
        <i aria-hidden="true" />
        <strong>{clock(voice.seconds)}</strong>
        <span>{voice.live || "Gravando..."}</span>
      </div>
      <button type="button" className="nets-rec-send" aria-label="Enviar o áudio" onClick={voice.send}>
        <Icon name="send" size={big ? 26 : 18} />
      </button>
    </div>
  );
}
