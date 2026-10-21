import { requireSession } from "@/lib/auth";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Alterar senha" };

export default async function PasswordPage({ searchParams }: { searchParams: Promise<{ primeiro?: string }> }) {
  const session = await requireSession();
  const first = (await searchParams).primeiro === "1" && session.mustChangePassword;
  return (
    <main className="auth-page">
      <div className="card auth-card">
        <h1>Alterar senha</h1>
        <p className="muted">
          {first ? "Sua conta foi criada com uma senha provisória. Defina uma senha própria para continuar." : session.email}
        </p>
        <PasswordForm />
      </div>
    </main>
  );
}
