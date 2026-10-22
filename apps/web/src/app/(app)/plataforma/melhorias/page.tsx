import { requireDeveloper } from "@/lib/auth";
import { ImprovementsBoard, type Search } from "../../melhorias/board";

// A análise da IA pode levar alguns segundos.
export const maxDuration = 120;

export const metadata = { title: "Melhorias da plataforma" };

export default async function PlatformImprovementsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireDeveloper();
  return <ImprovementsBoard mode="platform" searchParams={searchParams} />;
}
