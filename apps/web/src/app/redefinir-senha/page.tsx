import Link from "next/link";
import { inspectPasswordToken } from "@erp/core";
import { LogoMark } from "@/components/logo";
import { BRAND_NAME } from "@/lib/brand";
import { db } from "@/lib/db";
import { ResetForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Criar senha", referrer: "no-referrer" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const info = await inspectPasswordToken(db(), token);
  return (
    <main className="auth-page">
      <div className="card auth-card">
        <div className="auth-brand"><LogoMark size={48} /><strong>{BRAND_NAME}</strong></div>
        {info ? (
          <>
            <h1>{info.purpose === "invite" ? "Bem-vindo(a)" : "Nova senha"}</h1>
            <p className="muted">
              {info.purpose === "invite" ? `${info.name}, crie sua senha para entrar.` : `Crie uma nova senha para ${info.email}.`}
            </p>
            <ResetForm token={token} email={info.email} />
          </>
        ) : (
          <>
            <h1>Link inválido</h1>
            <p className="muted">Este link expirou ou já foi usado.</p>
            <div className="actions"><Link className="button" href="/esqueci-senha">Pedir novo link</Link></div>
          </>
        )}
      </div>
    </main>
  );
}
