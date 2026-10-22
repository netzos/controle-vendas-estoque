"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "./icons";

type Message = {
  id: string;
  role: "user" | "assistant";
  body: string;
  context: string | null;
  status: "queued" | "processing" | "done" | "failed";
  action: { title: string; service: string } | null;
  actionStatus: "pending" | "running" | "done" | "failed" | "cancelled" | "expired" | null;
  actionResult: string | null;
};
type Position = { right: number; bottom: number };

const STORAGE = "nets-bubble-position";
const DEFAULT: Position = { right: 20, bottom: 20 };
const ACTION_LABEL: Record<string, string> = {
  running: "Executando...",
  done: "Feito",
  failed: "Deu erro",
  cancelled: "Cancelado",
  expired: "Ficou sem resposta",
};

function readPosition(): Position {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE) || "null");
    if (raw && typeof raw.right === "number" && typeof raw.bottom === "number") return raw;
  } catch {
    // Armazenamento bloqueado: fica no canto padrão.
  }
  return DEFAULT;
}

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

type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };

// Microfone do navegador (Chrome, Edge, Safari): fala vira texto na caixa para revisar e enviar.
function useDictation(onText: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    setSupported(!!(w.SpeechRecognition ?? w.webkitSpeechRecognition));
  }, []);
  const toggle = () => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "pt-BR";
    r.interimResults = false;
    r.continuous = true;
    r.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      if (last?.[0]?.transcript) onText(last[0].transcript.trim());
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  };
  return { supported, listening, toggle };
}

// A Nets em todas as telas: arrastável, minimiza sem perder o rascunho e sabe
// qual tela está aberta. Mesmo esquema do Netz no NetOS.
export function NetsBubble() {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position>(DEFAULT);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const drag = useRef<{ x: number; y: number; start: Position; moved: boolean } | null>(null);
  const request = useRef<{ id: string; text: string } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const dictation = useDictation((text) => setDraft((d) => (d.trim() ? `${d.trimEnd()} ` : "") + text));

  useEffect(() => setPosition(readPosition()), []);

  // O histórico é lido só com o balão aberto; enquanto a Nets responde, a cada 2 s.
  useEffect(() => {
    if (!open) return;
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
  }, [open, tick]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, pending, open]);

  const where = useCallback(() => {
    const title = document.querySelector(".page-header h1")?.textContent?.trim();
    const q = search.toString();
    return [title, `${pathname}${q ? `?${q}` : ""}`].filter(Boolean).join(" · ").slice(0, 200);
  }, [pathname, search]);

  const send = async () => {
    const text = draft.trim();
    if (busy || pending || !text) return;
    setBusy(true);
    setError("");
    if (request.current?.text !== text) request.current = { id: crypto.randomUUID(), text };
    try {
      const res = await fetch("/api/nets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: request.current.id, text, context: where() }),
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
      // A tela aberta mostra o que acabou de mudar.
      if (decision === "confirm") router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha.");
    }
    setTick((v) => v + 1);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    drag.current = { x: e.clientX, y: e.clientY, start: position, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    const clamp = (v: number, max: number) => Math.max(8, Math.min(max, v));
    setPosition({ right: clamp(d.start.right - dx, window.innerWidth - 64), bottom: clamp(d.start.bottom - dy, window.innerHeight - 64) });
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) {
      try {
        window.localStorage.setItem(STORAGE, JSON.stringify(position));
      } catch {
        // A posição só não fica lembrada.
      }
      return;
    }
    setOpen((v) => !v);
  };

  return (
    <div className="nets-root" style={{ right: position.right, bottom: position.bottom }}>
      {open && (
        <section className="nets-panel" aria-label="Conversa com a Nets">
          <header>
            <div>
              <strong>Nets</strong>
              <span>Peça qualquer coisa do sistema. Eu confirmo antes de mudar algo.</span>
            </div>
            <button type="button" className="nets-icon-btn" aria-label="Minimizar a Nets" onClick={() => setOpen(false)}>
              <Icon name="minus" size={18} />
            </button>
          </header>
          <div className="nets-list" ref={list}>
            {!loaded && <p className="nets-note">Carregando...</p>}
            {loaded && messages.length === 0 && (
              <div className="nets-empty">
                <p>Oi! Sou a Nets. Fale comigo como falaria com alguém da equipe:</p>
                <ul>
                  <li>quanto vendi esta semana?</li>
                  <li>vendi 3 latas pro João no Pix</li>
                  <li>o que está com estoque baixo?</li>
                </ul>
              </div>
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
            {pending && <div className="nets-msg assistant"><div className="nets-bubble-text nets-typing" aria-label="A Nets está respondendo"><i /><i /><i /></div></div>}
          </div>
          {error && <p className="nets-error" role="alert">{error}</p>}
          <form className="nets-composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <textarea
              value={draft}
              rows={2}
              maxLength={12000}
              placeholder={dictation.listening ? "Pode falar..." : "O que você precisa?"}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            {dictation.supported && (
              <button type="button" className={`nets-icon-btn${dictation.listening ? " live" : ""}`} aria-label={dictation.listening ? "Parar de ouvir" : "Falar"} onClick={dictation.toggle}>
                <Icon name={dictation.listening ? "stop" : "mic"} size={18} />
              </button>
            )}
            <button type="submit" className="nets-send" aria-label="Enviar para a Nets" disabled={busy || pending || !draft.trim()}>
              <Icon name="send" size={18} />
            </button>
          </form>
        </section>
      )}
      <button
        type="button"
        className={`nets-fab${open ? " open" : ""}`}
        aria-label={open ? "Minimizar a Nets" : "Abrir a Nets"}
        aria-expanded={open}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <Icon name="bot" size={24} />
        {!open && draft.trim() && <span className="nets-dot" aria-hidden="true" />}
      </button>
    </div>
  );
}
