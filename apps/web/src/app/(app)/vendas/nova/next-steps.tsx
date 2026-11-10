"use client";

import { useState } from "react";
import { money } from "@/lib/format";
import { DeliverForm } from "../deliver-form";
import { ReceivePaymentForm } from "../receive-form";

type Sale = { id: string; number: number; fulfillment: string; followupOpen: boolean; open: string; installments: boolean };

/**
 * Melhoria 24: logo depois de finalizar a venda, um convite suave para marcar
 * agora a retirada/entrega e o recebimento. "Agora não" fecha sem insistir:
 * a venda fica com os dois pendentes, como já fica hoje.
 */
export function SaleNextSteps({ sale, canDeliver, canReceive }: { sale: Sale; canDeliver: boolean; canReceive: boolean }) {
  const [closed, setClosed] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [received, setReceived] = useState(false);
  const askHandover = canDeliver && sale.followupOpen;
  const askPayment = canReceive && !sale.installments && Number(sale.open) > 0 && !received;
  if (closed || (!askHandover && !askPayment)) return null;
  const took = sale.fulfillment === "delivery" ? "já recebeu a entrega" : "já levou";
  const question = askHandover && askPayment ? `O cliente ${took} e já pagou?` : askHandover ? `O cliente ${took}?` : "O cliente já pagou?";
  return (
    <div className="next-steps">
      <p>
        <b>{question}</b> <span className="muted">Se ainda não, é só deixar: a venda nº {sale.number} fica pendente.</span>
      </p>
      {askHandover && <DeliverForm saleId={sale.id} fulfillment={sale.fulfillment} />}
      {askPayment &&
        (receiving ? (
          <ReceivePaymentForm saleId={sale.id} open={sale.open} onDone={() => setReceived(true)} />
        ) : (
          <button type="button" className="button secondary small" onClick={() => setReceiving(true)}>
            Marcar recebimento de {money(sale.open)}
          </button>
        ))}
      <button type="button" className="link-button" onClick={() => setClosed(true)}>Agora não</button>
    </div>
  );
}
