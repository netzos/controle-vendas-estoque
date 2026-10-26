"use client";

import { useState } from "react";
import type { FormState } from "@/lib/actions";
import { Field } from "./form";

export interface AddressValue {
  zipCode: string;
  street: string;
  streetNumber: string;
  complement: string;
  district: string;
  city: string;
  state: string;
}

const EMPTY: AddressValue = { zipCode: "", street: "", streetNumber: "", complement: "", district: "", city: "", state: "" };

/**
 * Endereço completo começando pelo CEP: com os 8 números, busca rua, bairro,
 * cidade e UF no ViaCEP (serviço público e gratuito dos Correios) e leva a
 * pessoa direto para o número. Os campos continuam editáveis.
 */
export function AddressFields({ initial, state }: { initial?: Partial<AddressValue>; state?: FormState }) {
  const [v, setV] = useState<AddressValue>({ ...EMPTY, ...Object.fromEntries(Object.entries(initial ?? {}).map(([k, x]) => [k, x ?? ""])) });
  const [status, setStatus] = useState<"" | "busy" | "notfound" | "offline">("");
  const set = (k: keyof AddressValue) => (e: React.ChangeEvent<HTMLInputElement>) => setV((o) => ({ ...o, [k]: e.target.value }));

  async function lookup(raw: string) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length !== 8) return;
    setStatus("busy");
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = (await res.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string; complemento?: string };
      if (data.erro) {
        setStatus("notfound");
        return;
      }
      setV((o) => ({
        ...o,
        street: data.logradouro || o.street,
        district: data.bairro || o.district,
        city: data.localidade || o.city,
        state: data.uf || o.state,
      }));
      setStatus("");
      document.getElementById("streetNumber")?.focus();
    } catch {
      setStatus("offline");
    }
  }

  const hint =
    status === "busy" ? "Buscando endereço..." : status === "notfound" ? "CEP não encontrado. Preencha à mão." : status === "offline" ? "Sem conexão com a busca de CEP. Preencha à mão." : "Digite o CEP e a rua aparece sozinha.";

  return (
    <div className="grid-3 address-fields">
      <Field label="CEP" name="zipCode" state={state} hint={hint}>
        <input
          id="zipCode"
          name="zipCode"
          value={v.zipCode}
          inputMode="numeric"
          maxLength={9}
          placeholder="00000-000"
          autoComplete="postal-code"
          onChange={(e) => {
            const d = e.target.value.replace(/\D/g, "").slice(0, 8);
            setV((o) => ({ ...o, zipCode: d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d }));
            if (d.length === 8) lookup(d);
          }}
        />
      </Field>
      <Field label="Rua" name="street" state={state}>
        <input id="street" name="street" value={v.street} onChange={set("street")} maxLength={160} autoComplete="address-line1" />
      </Field>
      <Field label="Número" name="streetNumber" state={state}>
        <input id="streetNumber" name="streetNumber" value={v.streetNumber} onChange={set("streetNumber")} maxLength={20} />
      </Field>
      <Field label="Complemento" name="complement" state={state}>
        <input id="complement" name="complement" value={v.complement} onChange={set("complement")} maxLength={80} placeholder="Apto, bloco, referência" />
      </Field>
      <Field label="Bairro" name="district" state={state}>
        <input id="district" name="district" value={v.district} onChange={set("district")} maxLength={80} />
      </Field>
      <div className="grid-city">
        <Field label="Cidade" name="city" state={state}>
          <input id="city" name="city" value={v.city} onChange={set("city")} maxLength={80} autoComplete="address-level2" />
        </Field>
        <Field label="UF" name="state" state={state}>
          <input id="state" name="state" value={v.state} onChange={(e) => setV((o) => ({ ...o, state: e.target.value.toUpperCase() }))} maxLength={2} placeholder="PA" />
        </Field>
      </div>
    </div>
  );
}
