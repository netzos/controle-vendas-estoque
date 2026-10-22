"use client";

import { useActionState } from "react";
import { setFeatureAction } from "./actions";

/** Chave liga/desliga: grava na hora. Sem empresa, vale para todas. */
export function FeatureToggle({ organizationId, feature, enabled, label }: { organizationId?: string; feature: string; enabled: boolean; label: string }) {
  const [state, action, pending] = useActionState(setFeatureAction, null);
  return (
    <form action={action} className="imp-inline">
      <input type="hidden" name="organizationId" value={organizationId ?? ""} />
      <input type="hidden" name="feature" value={feature} />
      <input type="hidden" name="enabled" value={enabled ? "0" : "1"} />
      <button type="submit" className={`toggle ${enabled ? "on" : ""}`} disabled={pending} aria-pressed={enabled} aria-label={label}>
        {enabled ? "Ligado" : "Desligado"}
      </button>
      {state && !state.ok && <span className="error">{state.message}</span>}
    </form>
  );
}

export function FeatureAll({ feature, label }: { feature: string; label: string }) {
  const [, action, pending] = useActionState(setFeatureAction, null);
  return (
    <form action={action} className="imp-inline">
      <input type="hidden" name="feature" value={feature} />
      <button type="submit" name="enabled" value="1" className="secondary small" disabled={pending} aria-label={`Ligar ${label} para todas`}>Ligar para todas</button>
      <button type="submit" name="enabled" value="0" className="secondary small" disabled={pending} aria-label={`Desligar ${label} para todas`}>Desligar para todas</button>
    </form>
  );
}
