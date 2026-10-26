"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import type { CompanyFeatureChoice } from "@erp/core";
import type { FormState } from "@/lib/actions";
import { FormMessage } from "@/components/form";
import { setFeatureAction } from "./actions";

/** Onde configurar cada recurso depois de ligado. */
const CONFIGURE: Record<string, { href: string; label: string } | undefined> = {
  deliveries: { href: "/etapas", label: "Configurar etapas" },
  costs: { href: "/custos/tipos", label: "Tipos de custo" },
  custom_fields: { href: "/campos-personalizados", label: "Criar campos" },
};

export function FeatureSwitches({ features, canChange }: { features: CompanyFeatureChoice[]; canChange: boolean }) {
  const [state, setState] = useState<FormState>(null);
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(features, (list, change: { key: string; enabled: boolean }) =>
    list.map((f) => (f.key === change.key ? { ...f, enabled: change.enabled } : f)),
  );

  const toggle = (key: string, enabled: boolean) =>
    startTransition(async () => {
      setShown({ key, enabled });
      setState(await setFeatureAction(key, enabled));
    });

  return (
    <>
      {state && !state.ok && <FormMessage state={state} />}
      <div className="feature-list">
        {shown.map((f) => (
          <div key={f.key} className={`card feature-row${f.enabled ? " on" : ""}`}>
            <div className="feature-text">
              <strong>{f.label}</strong>
              <span className="muted">{f.hint}</span>
              {f.enabled && CONFIGURE[f.key] && <Link href={CONFIGURE[f.key]!.href} className="feature-link">{CONFIGURE[f.key]!.label} →</Link>}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={f.enabled}
              aria-label={f.label}
              className="switch"
              disabled={!canChange || pending}
              onClick={() => toggle(f.key, !f.enabled)}
            >
              <span />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
