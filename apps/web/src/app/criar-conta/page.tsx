import { redirect } from "next/navigation";
import { LogoMark } from "@/components/logo";
import { BRAND_NAME } from "@/lib/brand";
import { currentSession } from "@/lib/auth";
import { SignupForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Criar conta" };

export default async function SignupPage() {
  if (await currentSession()) redirect("/");
  return (
    <main className="auth-page">
      <div className="card auth-card">
        <div className="auth-brand"><LogoMark size={48} /><strong>{BRAND_NAME}</strong></div>
        <h1>Criar conta</h1>
        <p className="muted">Conte um pouco sobre você e sua empresa. Cada conta é liberada pela nossa equipe; avisamos assim que estiver pronta.</p>
        <SignupForm />
      </div>
    </main>
  );
}
