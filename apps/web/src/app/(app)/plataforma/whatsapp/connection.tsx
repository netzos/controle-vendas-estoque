"use client";

import { useEffect, useRef, useState } from "react";
import type { WhatsAppPlatformStatus } from "@erp/core";
import { whatsappDisconnectAction, whatsappQrAction, whatsappStatusAction } from "./actions";

// Mesma tela do NetzOS (presenting-netzos/app/global-whatsapp-connection.tsx):
// gera o QR, mostra a contagem, consulta o estado a cada 4 segundos e pede
// confirmação antes de desconectar.
export function WhatsAppConnection({ initial }: { initial: WhatsAppPlatformStatus }) {
  const [status, setStatus] = useState(initial);
  const [qr, setQr] = useState<{ image: string; expires: number } | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const lock = useRef(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const s = await whatsappStatusAction();
        if (!alive) return;
        setStatus(s);
        if (s.loggedIn) setQr(null);
      } catch {
        /* tenta de novo no próximo ciclo */
      }
      if (alive) timer = setTimeout(() => void load(), 4000);
    };
    timer = setTimeout(() => void load(), 4000);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!qr) {
      setSeconds(0);
      return;
    }
    const tick = () => setSeconds(Math.max(0, Math.ceil((qr.expires - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [qr]);

  const pair = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await whatsappQrAction();
      if (r.ok) setQr({ image: r.image, expires: Date.now() + r.expiresIn * 1000 });
      else setError(r.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await whatsappDisconnectAction();
      if (r.ok) {
        setStatus({ ...status, connected: false, loggedIn: false, phone: null });
        setConfirm(false);
      } else setError(r.message ?? "Não foi possível desconectar.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const connected = status.loggedIn;
  return (
    <section className="card">
      <h2>Número do netzsales</h2>
      <dl className="org-facts">
        <dt>Número conectado</dt>
        <dd>{status.phone ? `+${status.phone}` : connected ? "O WhatsApp não informou o número" : "Nenhum número conectado"}</dd>
        <dt>Situação</dt>
        <dd>{connected ? <span className="tag ok">Conectado</span> : <span className="tag off">Desconectado</span>}</dd>
        <dt>Pessoas ligadas</dt>
        <dd>{status.linkedPeople}</dd>
      </dl>
      {status.error && <p className="alert" role="alert">{status.error}</p>}
      {error && <p className="alert" role="alert">{error}</p>}
      {!connected && (
        <>
          {qr && seconds > 0 ? (
            <div className="whatsapp-qr">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr.image} width={256} height={256} alt="QR Code para conectar o WhatsApp do netzsales" />
              <p role="status">Válido por {seconds}s.</p>
            </div>
          ) : qr ? (
            <p role="status">O QR Code venceu. Gere um novo para continuar.</p>
          ) : null}
          <p className="muted">No celular do chip do netzsales: WhatsApp › Aparelhos conectados › Conectar um aparelho, e aponte a câmera para o QR Code.</p>
          <button type="button" className="button" disabled={busy || (!!qr && seconds > 0)} onClick={() => void pair()}>
            {busy ? "Preparando..." : qr ? "Gerar novo QR Code" : "Conectar número"}
          </button>
        </>
      )}
      {connected && !confirm && (
        <button type="button" className="button secondary" disabled={busy} onClick={() => setConfirm(true)}>
          Desconectar WhatsApp
        </button>
      )}
      {confirm && (
        <div className="alert" role="alertdialog" aria-labelledby="wa-disconnect">
          <p id="wa-disconnect">
            <strong>Desconectar o WhatsApp?</strong> A Netz deixa de receber e responder neste número até ler um QR Code de novo. As pessoas ligadas continuam
            ligadas e voltam a conversar assim que o número for reconectado.
          </p>
          <div className="actions">
            <button type="button" className="button secondary" disabled={busy} onClick={() => setConfirm(false)}>
              Cancelar
            </button>
            <button type="button" className="button danger" disabled={busy} onClick={() => void disconnect()}>
              {busy ? "Desconectando..." : "Confirmar desconexão"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
