"use client";

import { useEffect, useState } from "react";
import { LogoMark } from "./logo";
import { BRAND_NAME } from "@/lib/brand";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const HIDE_KEY = "netzsales.install-hidden";

/**
 * Faixa "Adicionar à tela de início" no login (como no Premazon): no Android e
 * no Chrome instala com um toque; no iPhone mostra o passo a passo do Safari.
 * Some quando o netzsales já está aberto como app ou se a pessoa fechar.
 */
export function InstallApp() {
  const [mode, setMode] = useState<"ios" | "prompt" | null>(null);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [steps, setSteps] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    if (standalone) return;
    try {
      if (localStorage.getItem(HIDE_KEY)) return;
    } catch {}
    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (ios) setMode("ios");
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
      setMode("prompt");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!mode) return null;

  const hide = () => {
    try {
      localStorage.setItem(HIDE_KEY, "1");
    } catch {}
    setMode(null);
  };
  const install = async () => {
    if (mode === "ios") {
      setSteps(true);
      return;
    }
    if (!prompt) return;
    await prompt.prompt();
    const choice = await prompt.userChoice.catch(() => ({ outcome: "dismissed" }));
    if (choice.outcome === "accepted") setMode(null);
  };

  return (
    <>
      <div className="install-bar" role="region" aria-label="Instalar o app">
        <LogoMark size={40} />
        <div>
          <strong>Use o {BRAND_NAME} como app</strong>
          <span>Coloque o ícone na tela de início do celular.</span>
        </div>
        <button type="button" className="small" onClick={install}>Adicionar</button>
        <button type="button" className="install-close" aria-label="Fechar o aviso" onClick={hide}>×</button>
      </div>
      {steps && (
        <div className="install-sheet" role="dialog" aria-label="Como adicionar à tela de início">
          <button type="button" className="install-backdrop" aria-label="Fechar" onClick={() => setSteps(false)} />
          <div className="install-panel">
            <div className="install-head">
              <LogoMark size={52} />
              <div>
                <strong>Adicionar à tela de início</strong>
                <span>O ícone do {BRAND_NAME} fica junto dos seus apps.</span>
              </div>
            </div>
            <ol className="install-steps">
              <li>
                <span className="install-num">1</span>
                <span>
                  Toque em <b>Compartilhar</b> <ShareIcon /> na barra do Safari (embaixo, ou em cima ao lado do endereço).
                </span>
              </li>
              <li>
                <span className="install-num">2</span>
                <span>
                  Role a lista e toque em <b>Adicionar à Tela de Início</b> <PlusIcon />.
                </span>
              </li>
              <li>
                <span className="install-num">3</span>
                <span>
                  Toque em <b>Adicionar</b>, no canto de cima. Pronto: abra pelo ícone.
                </span>
              </li>
            </ol>
            <p className="muted install-note">Não aparece a opção? Abra este endereço no Safari.</p>
            <button type="button" className="install-ok" onClick={() => setSteps(false)}>Entendi</button>
          </div>
        </div>
      )}
    </>
  );
}

function ShareIcon() {
  return (
    <svg className="install-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0a84ff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-label="ícone Compartilhar">
      <path d="M12 3v12M8 7l4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="install-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-label="ícone de mais">
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}
