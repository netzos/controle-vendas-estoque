import Link from "next/link";
import { can, listBranches } from "@erp/core";
import { requirePermission } from "@/lib/auth";
import { query } from "@/lib/actions";
import { ImportForm } from "./forms";

export const metadata = { title: "Trazer clientes de uma planilha" };

export default async function ImportCustomersPage() {
  const actor = await requirePermission("customers.manage");
  const branches = can(actor, "branches.view") ? await query(listBranches, {}) : [];
  return (
    <>
      <p className="back-link"><Link href="/primeiros-passos">‹ Primeiros passos</Link></p>
      <div className="page-header">
        <h1>Trazer clientes de uma planilha</h1>
        <p>Escolha o arquivo CSV ou cole as linhas copiadas do Excel ou do Google Planilhas, com o cabeçalho. Você vê a prévia antes de gravar qualquer coisa.</p>
      </div>
      <ImportForm branches={branches.length > 1 ? branches.map((b) => ({ id: b.id, name: b.name })) : []} />
    </>
  );
}
