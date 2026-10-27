"use client";

import { useActionState, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/form";
import { importCustomersAction, type ImportState } from "./actions";

const FIELD_LABELS: Record<string, string> = {
  code: "Código", name: "Nome", phone: "Telefone", email: "E-mail", document: "CPF/CNPJ", city: "Cidade", state: "UF",
  street: "Endereço", streetNumber: "Número", complement: "Complemento", district: "Bairro", zipCode: "CEP",
  customerSince: "Cliente desde", notes: "Observações",
};

export function ImportForm({ branches }: { branches: { id: string; name: string }[] }) {
  const [state, action] = useActionState<ImportState, FormData>(importCustomersAction, null);
  const [text, setText] = useState("");
  const result = state?.result;
  const fresh = result?.rows.filter((r) => r.status === "new").length ?? 0;
  const dup = result?.rows.filter((r) => r.status === "duplicate").length ?? 0;
  const bad = result?.rows.filter((r) => r.status === "error").length ?? 0;

  async function pick(file: File | undefined) {
    if (!file) return;
    const buf = await file.arrayBuffer();
    // CSV salvo pelo Excel costuma vir em Windows-1252; UTF-8 inválido cai nele.
    let content = new TextDecoder("utf-8").decode(buf);
    if (content.includes("�")) content = new TextDecoder("windows-1252").decode(buf);
    setText(content);
  }

  return (
    <form action={action}>
      <section className="card">
        <FormMessage state={state} />
        <div className="field">
          <label htmlFor="file">Arquivo CSV</label>
          <input id="file" type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(e) => pick(e.target.files?.[0])} />
        </div>
        <div className="field">
          <label htmlFor="text">Ou cole aqui</label>
          <textarea
            id="text"
            name="text"
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"codigo;nome;telefone;email;cpf_cnpj;cidade;endereco;data_cadastro;observacoes\nC01;Ana Lima;91 99999-0001;ana@email.com;;Belém;Rua A, 10;25/03/2021;"}
            required
          />
          <span className="hint">A primeira linha diz o que é cada coluna. Só o nome é obrigatório; o resto entra se tiver.</span>
        </div>
        {branches.length > 0 && (
          <div className="field">
            <label htmlFor="branchId">Filial destes clientes</label>
            <select id="branchId" name="branchId" defaultValue="">
              <option value="">Todas as filiais</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
        <div className="actions">
          <SubmitButton className="secondary" pendingText="Lendo...">Ver prévia</SubmitButton>
        </div>
      </section>

      {result && !state?.confirmed && (
        <section className="card">
          <div className="card-head">
            <h2>Prévia</h2>
            <span className="muted">{fresh} novos · {dup} já cadastrados · {bad} com erro</span>
          </div>
          <p className="muted small-text">
            Colunas reconhecidas: {result.columns.map((c) => (c.field ? `${c.header} → ${FIELD_LABELS[c.field] ?? c.field}` : `${c.header} (ignorada)`)).join(", ")}.
          </p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Linha</th><th>Nome</th><th>Situação</th></tr></thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.line} className={r.status === "error" ? "row-warn" : ""}>
                    <td>{r.line}</td>
                    <td>{r.name || <span className="muted">sem nome</span>}</td>
                    <td>{r.status === "new" ? <span className="tag ok">Novo</span> : r.status === "duplicate" ? <span className="tag">{r.message}</span> : <span className="tag off">{r.message}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small-text">Os já cadastrados e os com erro ficam de fora. Corrija na planilha e importe de novo quando quiser: os que já entraram não duplicam.</p>
          {fresh > 0 && (
            <div className="actions">
              <button type="submit" name="confirm" value="1">Cadastrar {fresh} {fresh === 1 ? "cliente" : "clientes"}</button>
            </div>
          )}
        </section>
      )}
    </form>
  );
}
