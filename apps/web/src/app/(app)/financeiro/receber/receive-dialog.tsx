"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ReceivePaymentForm } from "../../vendas/receive-form";

/**
 * Botão "Receber" da lista de parcelas. Abre o formulário numa janela no meio da tela
 * (fora da tabela), para não ficar cortado pela rolagem da tabela nem pelo cartão de vidro.
 */
export function ReceiveDialog({ saleId, open, installmentId, hint, title }: { saleId: string; open: string; installmentId?: string; hint?: string; title: string }) {
  const [isOpen, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [isOpen, close]);

  return (
    <>
      <button type="button" className="button secondary small" onClick={() => setOpen(true)}>Receber</button>
      {isOpen && createPortal(
        <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
          <button type="button" className="modal-backdrop" aria-label="Fechar" onClick={close} />
          <div className="modal-panel">
            <div className="modal-head">
              <strong>{title}</strong>
              <button type="button" className="modal-close" aria-label="Fechar" onClick={close}>×</button>
            </div>
            <ReceivePaymentForm saleId={saleId} open={open} installmentId={installmentId} hint={hint} onDone={close} />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
