import Link from "next/link";

export const metadata = { title: "Sem permissão" };

export default function NoPermissionPage() {
  return (
    <main className="auth-page">
      <div className="card auth-card">
        <h1>Sem permissão</h1>
        <p className="muted">Seu perfil de acesso não permite abrir esta página.</p>
        <Link className="button" href="/">Voltar ao início</Link>
      </div>
    </main>
  );
}
