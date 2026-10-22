"use client";

import { useActionState } from "react";
import { setFeatureAction } from "./actions";

/** Chave liga/desliga de uma empresa: grava na hora. */
export function FeatureToggle({ organizationId, feature, enabled, label, actionText }: { organizationId: string; feature: string; enabled: boolean; label: string; actionText?: string }) {
  const [state, action, pending] = useActionState(setFeatureAction, null);
  return (
    <form action={action} className="imp-inline">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="feature" value={feature} />
      <input type="hidden" name="enabled" value={enabled ? "0" : "1"} />
      {actionText ? (
        <button type="submit" className="secondary small" disabled={pending} aria-label={label}>{actionText}</button>
      ) : (
        <button type="submit" className={`toggle ${enabled ? "on" : ""}`} disabled={pending} aria-pressed={enabled} aria-label={label}>
          {enabled ? "Ligado" : "Desligado"}
        </button>
      )}
      {state && !state.ok && <span className="error">{state.message}</span>}
    </form>
  );
}

/** Padrão da parte para todas as empresas (e as novas). */
export function FeatureDefault({ feature, label, defaultOn }: { feature: string; label: string; defaultOn: boolean }) {
  const [state, action, pending] = useActionState(setFeatureAction, null);
  return (
    <form
      action={action}
      className="imp-inline"
      onSubmit={(e) => {
        if (!window.confirm(`Mudar o padrão de ${label} para todas as empresas? As exceções serão desfeitas.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="feature" value={feature} />
      <button type="submit" name="enabled" value="1" className={defaultOn ? "" : "secondary"} disabled={pending || defaultOn} aria-pressed={defaultOn}>
        Ligado para todas
      </button>
      <button type="submit" name="enabled" value="0" className={defaultOn ? "secondary" : ""} disabled={pending || !defaultOn} aria-pressed={!defaultOn}>
        Desligado para todas
      </button>
      {state && !state.ok && <span className="error">{state.message}</span>}
    </form>
  );
}
