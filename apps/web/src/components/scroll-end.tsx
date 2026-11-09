"use client";

import { useEffect, useRef } from "react";

// Caixa que rola para o lado e já abre no fim (os dias mais recentes).
export function ScrollEnd({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);
  return <div ref={ref} className={className}>{children}</div>;
}
