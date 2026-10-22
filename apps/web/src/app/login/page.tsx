import { LogoMark } from "@/components/logo";
import { BRAND_NAME } from "@/lib/brand";
import { redirect } from "next/navigation";
import { isSetupDone } from "@erp/core";
import { db } from "@/lib/db";
import { currentSession } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ senha?: string }> }) {
  if (!(await isSetupDone(db()))) redirect("/setup");
  if (await currentSession()) redirect("/");
  return (
    <main className="auth-page">
      <div className="card auth-card">
        <div className="auth-brand"><LogoMark size={48} /><strong>{BRAND_NAME}</strong></div>
        <h1>Entrar</h1>
        <p className="muted">Entre com sua conta para continuar.</p>
        {(await searchParams).senha === "nova" && <div className="alert success" role="status">Senha salva. Entre com a senha nova.</div>}
        <LoginForm />
      </div>
    </main>
  );
}
