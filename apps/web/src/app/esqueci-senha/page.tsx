import { LogoMark } from "@/components/logo";
import { BRAND_NAME } from "@/lib/brand";
import { ForgotForm } from "./form";

export const metadata = { title: "Esqueci minha senha" };

export default function ForgotPage() {
  return (
    <main className="auth-page">
      <div className="card auth-card">
        <div className="auth-brand"><LogoMark size={48} /><strong>{BRAND_NAME}</strong></div>
        <h1>Esqueci minha senha</h1>
        <p className="muted">Informe seu e-mail. Enviamos um link para você criar uma senha nova.</p>
        <ForgotForm />
      </div>
    </main>
  );
}
