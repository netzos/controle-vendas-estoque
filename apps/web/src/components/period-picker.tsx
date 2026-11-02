"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Seletor de período compacto: um botão só ("Últimos 30 dias · 03/10 a 01/11")
// que abre a lista de períodos. As datas aparecem só em "Escolher datas".
// Filial e vendedor mudam a tela na hora, sem botão Aplicar.

export type PeriodOption = { key: string; label: string };
type Choice = { id: string; name: string };

export function PeriodPicker({
  options,
  current,
  label,
  range,
  from,
  to,
  links,
  customLink,
  branches,
  branch,
  branchLinks,
  sellers,
  seller,
  sellerLinks,
}: {
  options: PeriodOption[];
  current: string;
  label: string;
  range: string;
  from: string;
  to: string;
  /** Endereço de cada período, já com filial e vendedor. */
  links: Record<string, string>;
  /** Endereço base para datas escolhidas; recebe de e ate. */
  customLink: string;
  branches?: Choice[];
  branch?: string;
  /** Endereço de cada filial ("" = todas). */
  branchLinks?: Record<string, string>;
  sellers?: Choice[];
  seller?: string;
  sellerLinks?: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(current === "custom");
  const [de, setDe] = useState(from);
  const [ate, setAte] = useState(to);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  const withDates = () => {
    const sep = customLink.includes("?") ? "&" : "?";
    const [a, b] = de <= ate ? [de, ate] : [ate, de];
    go(`${customLink}${sep}de=${a}&ate=${b}`);
  };

  return (
    <div className="period-bar">
      <div className="period-picker" ref={box}>
        <button type="button" className="period-button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((v) => !v)}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="period-name">{label}</span>
          <span className="period-range">{range}</span>
          <svg className="chev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {open && (
          <div className="period-pop" role="dialog" aria-label="Escolher período">
            <ul>
              {options.map((o) => (
                <li key={o.key}>
                  <button type="button" className={current === o.key ? "active" : ""} onClick={() => go(links[o.key]!)}>
                    {o.label}
                    {current === o.key && <span aria-hidden="true">✓</span>}
                  </button>
                </li>
              ))}
              <li>
                <button type="button" className={current === "custom" ? "active" : ""} onClick={() => setCustom((v) => !v)} aria-expanded={custom}>
                  Escolher datas
                  {current === "custom" ? <span aria-hidden="true">✓</span> : <span aria-hidden="true">{custom ? "−" : "+"}</span>}
                </button>
              </li>
            </ul>
            {custom && (
              <form
                className="period-custom"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (de && ate) withDates();
                }}
              >
                <label>
                  De
                  <input type="date" value={de} max={ate || undefined} onChange={(e) => setDe(e.target.value)} required />
                </label>
                <label>
                  Até
                  <input type="date" value={ate} min={de || undefined} onChange={(e) => setAte(e.target.value)} required />
                </label>
                <button type="submit">Ver período</button>
              </form>
            )}
          </div>
        )}
      </div>

      {branches && branches.length > 1 && branchLinks && (
        <select className="period-select" value={branch ?? ""} aria-label="Filial" onChange={(e) => router.push(branchLinks[e.target.value] ?? branchLinks[""]!)}>
          <option value="">Todas as filiais</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      )}
      {sellers && sellers.length > 1 && sellerLinks && (
        <select className="period-select" value={seller ?? ""} aria-label="Vendedor" onChange={(e) => router.push(sellerLinks[e.target.value] ?? sellerLinks[""]!)}>
          <option value="">Todos os vendedores</option>
          {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
    </div>
  );
}
