import { LogoMark } from "@/components/logo";
import { BRAND_NAME } from "@/lib/brand";
import { redirect } from "next/navigation";
import { isSetupDone } from "@erp/core";
import { db } from "@/lib/db";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Configuração inicial" };

const BR_TIMEZONES = Intl.supportedValuesOf("timeZone").filter((tz) =>
  ["America/Sao_Paulo", "America/Manaus", "America/Fortaleza", "America/Recife", "America/Bahia", "America/Belem", "America/Cuiaba", "America/Campo_Grande", "America/Porto_Velho", "America/Boa_Vista", "America/Rio_Branco", "America/Noronha", "America/Araguaina", "America/Maceio", "America/Santarem"].includes(tz),
);

// Disponível apenas enquanto não existe nenhum usuário no sistema.
export default async function SetupPage() {
  if (await isSetupDone(db())) redirect("/login");
  return (
    <main className="auth-page">
      <div className="card auth-card" style={{ maxWidth: 560 }}>
        <h1>Configuração inicial</h1>
        <p className="muted">Cadastre a empresa e a conta do proprietário. Esta tela só aparece uma vez.</p>
        <SetupForm timezones={BR_TIMEZONES} />
      </div>
    </main>
  );
}
