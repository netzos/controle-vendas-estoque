import { redirect } from "next/navigation";
import { can, enabledFeatures, isPlatformDeveloper } from "@erp/core";
import { currentActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { managerMode } from "@/lib/nav-visible";
import { NetsScreen } from "./netz-screen";

export const metadata = { title: "Netz" };

// Tela cheia da conversa com a Netz. No celular é a primeira tela do app
// (o ícone da tela de início abre aqui), como o ChatGPT.
export default async function NetzPage() {
  const actor = await currentActor();
  const [developer, features] = await Promise.all([isPlatformDeveloper(db(), actor.userId), enabledFeatures(db(), actor.organizationId)]);
  if (managerMode(actor, developer) || !can(actor, "nets.use") || !features.has("netz")) redirect("/");
  return <NetsScreen firstName={actor.userName.split(/\s+/)[0] ?? ""} />;
}
