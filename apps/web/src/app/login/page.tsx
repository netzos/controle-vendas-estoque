import { Icon } from "@/components/icons";
import { redirect } from "next/navigation";
import { isSetupDone } from "@erp/core";
import { db } from "@/lib/db";
import { currentSession } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entrar" };

export default async function LoginPage() {
  if (!(await isSetupDone(db()))) redirect("/setup");
  if (await currentSession()) redirect("/");
  return (
    <main className="auth-page">
      <div className="card auth-card">
        <div className="auth-logo"><Icon name="logo" size={26} /></div>
        <h1>Controle de vendas e estoque</h1>
        <p className="muted">Entre com sua conta para continuar.</p>
        <LoginForm />
      </div>
    </main>
  );
}
