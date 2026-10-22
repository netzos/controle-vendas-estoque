import { ImprovementsBoard, type Search } from "./board";

export const metadata = { title: "Melhorias" };

export default function ImprovementsPage({ searchParams }: { searchParams: Promise<Search> }) {
  return <ImprovementsBoard mode="company" searchParams={searchParams} />;
}
