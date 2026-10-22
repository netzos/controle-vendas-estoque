import { requireFeature } from "@/lib/auth";

// Parte que a Plataforma pode desligar por empresa (Plataforma › Liberações).
export default async function FeatureLayout({ children }: { children: React.ReactNode }) {
  await requireFeature("custom_fields");
  return children;
}
