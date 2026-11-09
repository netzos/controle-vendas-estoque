"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";
import { AttachButton, NetsMessages, RecordingBar, useNetsConversation } from "./nets-chat";

type Position = { right: number; bottom: number };

const STORAGE = "nets-bubble-position";
const DEFAULT: Position = { right: 20, bottom: 20 };

// No celular o balão fica acima da barra de menu de baixo, sem cobri-la.
const MOBILE_BOTTOM = 84;

function readPosition(): Position {
  const mobile = window.innerWidth <= 860;
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE) || "null");
    if (raw && typeof raw.right === "number" && typeof raw.bottom === "number") {
      return mobile ? { right: raw.right, bottom: Math.max(raw.bottom, MOBILE_BOTTOM) } : raw;
    }
  } catch {
    // Armazenamento bloqueado: fica no canto padrão.
  }
  return mobile ? { right: 12, bottom: MOBILE_BOTTOM } : DEFAULT;
}

// A Netz em todas as telas: arrastável, minimiza sem perder o rascunho e sabe
// qual tela está aberta. Mesmo esquema do Netz no NetOS.
export function NetsBubble() {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position>(DEFAULT);
  const drag = useRef<{ x: number; y: number; start: Position; moved: boolean } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const chat = useNetsConversation(open);
  const { draft, setDraft, busy, pending, error, setError, send, voice } = chat;

  useEffect(() => setPosition(readPosition()), []);

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

  // Na tela cheia da Netz o balão sobraria.
  if (pathname === "/netz") return null;

  return (
    <div className="nets-root" style={{ right: position.right, bottom: position.bottom }}>
      {open && (
        <section className="nets-panel" aria-label="Conversa com a Netz">
          <header>
            <div>
              <strong>Netz</strong>
              <span>Peça qualquer coisa do sistema. Eu confirmo antes de mudar algo.</span>
            </div>
            <button type="button" className="nets-icon-btn" aria-label="Minimizar a Netz" onClick={() => setOpen(false)}>
              <Icon name="minus" size={18} />
            </button>
          </header>
          <NetsMessages chat={chat} listRef={list} />
          {error && <p className="nets-error" role="alert">{error}</p>}
          {voice.state === "recording" ? (
            <RecordingBar chat={chat} />
          ) : (
          <form className="nets-composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <textarea
              value={draft}
              rows={2}
              maxLength={12000}
              placeholder={voice.state === "sending" ? "Transcrevendo o áudio..." : "O que você precisa?"}
              disabled={busy || voice.state !== "idle"}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <AttachButton chat={chat} />
            {voice.supported && (
              <button
                type="button"
                className="nets-icon-btn"
                aria-label="Gravar áudio"
                disabled={voice.state === "sending" || busy || pending}
                onClick={() => {
                  setError("");
                  voice.toggle();
                }}
              >
                <Icon name="mic" size={18} />
              </button>
            )}
            <button type="submit" className="nets-send" aria-label="Enviar para a Netz" disabled={busy || pending || !draft.trim()}>
              <Icon name="send" size={18} />
            </button>
          </form>
          )}
        </section>
      )}
      <button
        type="button"
        className={`nets-fab${open ? " open" : ""}`}
        aria-label={open ? "Minimizar a Netz" : "Abrir a Netz"}
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
        <Icon name="bot" size={22} />
        <span className="nets-fab-label">Netz</span>
        {!open && draft.trim() && <span className="nets-dot" aria-hidden="true" />}
      </button>
    </div>
  );
}
