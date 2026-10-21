import { logoutAction } from "../login/actions";
import { requireSession } from "@/lib/auth";

export const metadata = { title: "Sem acesso" };

export default async function NoOrganizationPage() {
  const session = await requireSession();
  return (
    <main className="auth-page">
      <div className="card auth-card">
        <h1>Sem empresa ativa</h1>
        <p className="muted">
          A conta {session.email} não tem acesso ativo a nenhuma empresa. Peça a um administrador para liberar o seu acesso.
        </p>
        <form action={logoutAction} className="actions">
          <button type="submit" className="secondary">Sair</button>
        </form>
      </div>
    </main>
  );
}
