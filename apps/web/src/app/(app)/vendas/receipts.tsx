"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SaleAttachment } from "@erp/core";
import type { FormState } from "@/lib/actions";
import { FormMessage } from "@/components/form";
import { shrinkPhoto } from "@/lib/photo";
import { addAttachmentAction, recheckAttachmentAction, removeAttachmentAction } from "./attachment-actions";

// Os rótulos ficam aqui (e não no @erp/core) porque o componente roda no navegador.
const CHECK: Record<string, string> = {
  pending: "Conferindo...",
  match: "Confere",
  mismatch: "Não bate",
  unreadable: "Não deu para ler",
  failed: "Não conferido",
};
const SOURCE: Record<string, string> = { panel: "pelo painel", netz: "pela Netz", telegram: "pelo Telegram", whatsapp: "pelo WhatsApp" };

const money = (v: string) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const day = (d: string) => d.split("-").reverse().join("/");

/** Comprovantes da venda: lista com a conferência e botão para anexar foto ou PDF. */
export function SaleReceipts({
  saleId,
  attachments,
  installments,
  defaultInstallment,
  canManage,
}: {
  saleId: string;
  attachments: SaleAttachment[];
  installments: { id: string; label: string }[];
  defaultInstallment?: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [installmentId, setInstallmentId] = useState(defaultInstallment ?? "");
  const [state, setState] = useState<FormState>(null);
  const [busy, setBusy] = useState("");
  const [, startTransition] = useTransition();
  const refresh = () => startTransition(() => router.refresh());

  // Enquanto a conferência roda (alguns segundos), a lista se atualiza sozinha.
  const checking = attachments.some((a) => a.checkStatus === "pending");
  const polls = useRef(0);
  useEffect(() => {
    if (!checking || polls.current > 20) return;
    const t = setTimeout(() => {
      polls.current += 1;
      refresh();
    }, 3000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checking, attachments]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy("Enviando...");
    try {
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      const form = new FormData();
      form.set("saleId", saleId);
      form.set("installmentId", installmentId);
      form.set("name", file.name);
      form.set("file", isPdf ? file : (await shrinkPhoto(file, 2000)).blob);
      setState(await addAttachmentAction(form));
      polls.current = 0;
    } catch {
      setState({ ok: false, message: "Não foi possível ler este arquivo. Tente outra foto ou outro PDF." });
    }
    setBusy("");
    if (input.current) input.current.value = "";
    refresh();
  }

  const act = (fn: () => Promise<FormState>) => async () => {
    setState(await fn());
    polls.current = 0;
    refresh();
  };

  return (
    <>
      <h3 className="form-section">Comprovantes</h3>
      {attachments.length === 0 ? (
        <p className="muted">Nenhum comprovante ainda. Anexe a foto do cupom, o print do Pix ou o PDF do pagamento: ele fica guardado aqui e o sistema confere se o valor bate.</p>
      ) : (
        <ul className="receipt-list">
          {attachments.map((a) => (
            <li key={a.id} className="receipt">
              <a className="receipt-thumb" href={`/anexos/${a.id}`} target="_blank" rel="noreferrer" aria-label="Abrir comprovante">
                {a.contentType === "application/pdf" ? "PDF" : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/anexos/${a.id}`} alt="" loading="lazy" />
                )}
              </a>
              <div className="receipt-body">
                <p>
                  {a.checkStatus && <span className={`tag check-${a.checkStatus}`}>{CHECK[a.checkStatus]}</span>}{" "}
                  {a.installmentNumber ? <b>Parcela {a.installmentNumber}</b> : <b>Venda</b>}
                  {a.checkAmount && <> · lido {money(a.checkAmount)}</>}
                  {a.checkDate && <> em {day(a.checkDate)}</>}
                  {a.checkMethod && <> · {a.checkMethod}</>}
                </p>
                {a.checkNote && <p className="muted">{a.checkNote}</p>}
                <p className="muted small-text">
                  Anexado {SOURCE[a.source] ?? ""}{a.userName ? ` por ${a.userName.split(" ")[0]}` : ""} em {new Date(a.createdAt).toLocaleDateString("pt-BR")}
                  {a.fileName ? ` · ${a.fileName}` : ""}
                </p>
                {canManage && (
                  <div className="receipt-actions">
                    {a.checkStatus && a.checkStatus !== "pending" && a.checkStatus !== "match" && (
                      <button type="button" className="secondary small" onClick={act(() => recheckAttachmentAction(a.id))}>Conferir de novo</button>
                    )}
                    <button type="button" className="secondary small" onClick={act(() => removeAttachmentAction(a.id))}>Remover</button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <FormMessage state={state} />
      {canManage && (
        <div className="receipt-add">
          {installments.length > 0 && (
            <select value={installmentId} onChange={(e) => setInstallmentId(e.target.value)} aria-label="Comprovante de qual pagamento">
              <option value="">Da venda (sem parcela)</option>
              {installments.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
            </select>
          )}
          <button type="button" className="secondary" disabled={!!busy} onClick={() => input.current?.click()}>
            {busy || "+ Anexar comprovante"}
          </button>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
            hidden
            onChange={(e) => upload(e.target.files?.[0])}
          />
        </div>
      )}
    </>
  );
}
