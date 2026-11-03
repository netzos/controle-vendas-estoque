"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { LogoMark } from "@/components/logo";
import { NetsMessages, RecordingBar, useNetsConversation } from "@/components/nets-chat";

const SUGGESTIONS = ["Quanto vendi hoje?", "O que está com estoque baixo?", "Quem está me devendo?"];

/**
 * Conversa em tela cheia, estilo WhatsApp: mensagens no meio e, embaixo, o
 * campo de texto com o botão grande do microfone (vira "enviar" quando há texto).
 */
export function NetsScreen({ firstName }: { firstName: string }) {
  const chat = useNetsConversation(true);
  const { draft, setDraft, busy, pending, error, setError, send, voice } = chat;
  const list = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  // Teclado do celular aberto: a conversa ocupa só a parte visível e a barra de baixo some.
  const [viewport, setViewport] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const keyboard = window.innerHeight - vv.height > 120;
      setViewport(keyboard ? { top: vv.offsetTop, height: vv.height } : null);
      document.documentElement.classList.toggle("kb-open", keyboard);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.documentElement.classList.remove("kb-open");
    };
  }, []);
  useEffect(() => {
    document.documentElement.classList.add("netz-screen-on");
    return () => document.documentElement.classList.remove("netz-screen-on");
  }, []);

  // O campo cresce com o texto, até umas 5 linhas.
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [draft]);

  const typing = draft.trim().length > 0;
  const blocked = busy || pending || voice.state === "sending";

  return (
    <section className="netz-screen" aria-label="Conversa com a Netz" style={viewport ? { top: viewport.top, height: viewport.height, bottom: "auto" } : undefined}>
      <header className="netz-head">
        <LogoMark size={38} />
        <div>
          <strong>Netz</strong>
          <span>{pending ? "digitando..." : voice.state === "sending" ? "ouvindo seu áudio..." : "sua assistente de vendas"}</span>
        </div>
        <Link href="/" className="netz-head-btn" aria-label="Ir para o Início">
          <Icon name="grid" size={20} />
        </Link>
      </header>

      <NetsMessages
        chat={chat}
        listRef={list}
        initials={firstName.slice(0, 1).toUpperCase()}
        intro={
          <div className="netz-hello">
            <p>
              <strong>Oi{firstName ? `, ${firstName}` : ""}!</strong> Toque no microfone e fale, como num áudio de WhatsApp. Eu registro vendas, dou baixa e respondo dúvidas. Antes de mudar algo, eu peço sua confirmação.
            </p>
            <div className="netz-chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="netz-chip" disabled={blocked} onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {error && <p className="nets-error" role="alert">{error}</p>}

      {voice.state === "recording" ? (
        <RecordingBar chat={chat} big />
      ) : (
        <form
          className="netz-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={field}
            value={draft}
            rows={1}
            maxLength={12000}
            enterKeyHint="send"
            placeholder={voice.state === "sending" ? "Transcrevendo o áudio..." : "Mensagem"}
            disabled={busy || voice.state !== "idle"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // No computador, Enter envia; no celular o Enter quebra a linha e o botão envia.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {typing || !voice.supported ? (
            <button type="submit" className="netz-main-btn" aria-label="Enviar" disabled={blocked || !typing}>
              <Icon name="send" size={24} />
            </button>
          ) : (
            <button
              type="button"
              className={`netz-main-btn${voice.state === "sending" ? " busy" : ""}`}
              aria-label="Gravar áudio"
              disabled={blocked}
              onClick={() => {
                setError("");
                voice.toggle();
              }}
            >
              <Icon name="mic" size={26} />
            </button>
          )}
        </form>
      )}
    </section>
  );
}
