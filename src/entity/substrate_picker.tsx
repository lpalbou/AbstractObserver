/**
 * The mind-substrate picker (maintainer ruling, 2026-07-09 04:26: "I WANT
 * TO BE ABLE TO CHOSE THE PROVIDER AND MODEL, as you do in abstractgateway/
 * and abstractflow/ with dropdown list auto populated once i select the
 * provider" — and NO FALLBACK: the gateway refuses when no explicit choice
 * is made; this picker is how the choice is made).
 *
 * Providers come from GET /discovery/providers; selecting one populates
 * models from GET /discovery/providers/{name}/models — the same discovery
 * surface AbstractFlow's properties panel consumes. The selection persists
 * PER ENTITY (localStorage) and is sent explicitly on chat/open and
 * loop/start. Discovery failures degrade to a labeled free-text input
 * (#FALLBACK) — degraded LISTING, never a silent substrate election.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";

import { gatewayReadHeaders } from "./stream_source";

export interface SubstrateChoice {
  provider: string;
  model: string;
}

interface ProviderItem {
  name: string;
  display_name?: string;
  local_provider?: boolean;
}

function storageKey(entity: string): string {
  return `abstractobserver_entity_substrate:${entity}`;
}

/** The stored per-entity choice; null when the operator has not chosen. */
export function loadSubstrateChoice(entity: string): SubstrateChoice | null {
  try {
    const raw = localStorage.getItem(storageKey(entity));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SubstrateChoice;
    if (parsed && typeof parsed.provider === "string" && typeof parsed.model === "string" && parsed.provider && parsed.model) {
      return parsed;
    }
  } catch {
    // presentation state only
  }
  return null;
}

export function saveSubstrateChoice(entity: string, choice: SubstrateChoice | null): void {
  try {
    if (choice && choice.provider && choice.model) {
      localStorage.setItem(storageKey(entity), JSON.stringify(choice));
    } else {
      localStorage.removeItem(storageKey(entity));
    }
  } catch {
    // best-effort
  }
}

export interface SubstratePickerProps {
  baseUrl: string;
  /** Persistence is the caller's (per-entity key via save/loadSubstrateChoice). */
  entity?: string;
  value: SubstrateChoice | null;
  onChange(choice: SubstrateChoice | null): void;
  /** Compact single-line layout for the controls strip. */
  compact?: boolean;
}

export function SubstratePicker({ baseUrl, value, onChange, compact }: SubstratePickerProps): React.ReactElement {
  const [providers, setProviders] = useState<ProviderItem[] | null>(null);
  const [models, setModels] = useState<string[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${baseUrl}/api/gateway/discovery/providers`, { headers: gatewayReadHeaders({ Accept: "application/json" }) })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((body: { items?: unknown }) => {
        if (cancelled) return;
        // Array guard (the AbstractFlow lesson: .filter on a non-array
        // error payload crashed the panel).
        const items = Array.isArray(body?.items) ? (body.items as ProviderItem[]) : [];
        setProviders(items.filter((p) => p && typeof p.name === "string"));
        setDiscoveryError(items.length === 0 ? "provider discovery returned nothing" : null);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setProviders([]);
        setDiscoveryError(`#FALLBACK provider discovery unavailable (${e.message}) — type the names explicitly`);
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  const loadModels = useCallback(
    (provider: string) => {
      setModels(null);
      if (!provider) return;
      setLoadingModels(true);
      fetch(`${baseUrl}/api/gateway/discovery/providers/${encodeURIComponent(provider)}/models`, {
        headers: gatewayReadHeaders({ Accept: "application/json" }),
      })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((body: { models?: unknown }) => {
          const list = Array.isArray(body?.models) ? (body.models as unknown[]).map(String) : [];
          setModels(list);
        })
        .catch(() => setModels([])) // degraded listing: free-text below
        .finally(() => setLoadingModels(false));
    },
    [baseUrl],
  );

  useEffect(() => {
    if (value?.provider) loadModels(value.provider);
  }, [value?.provider, loadModels]);

  const providerOptions = useMemo(() => providers ?? [], [providers]);
  const discoveryUp = providerOptions.length > 0;

  const onProvider = (provider: string) => {
    onChange(provider ? { provider, model: "" } : null);
    if (provider) loadModels(provider);
  };

  return (
    <div className={`sp_root ${compact ? "sp_compact" : ""}`}>
      {discoveryUp ? (
        <>
          <select
            className="sp_select"
            value={value?.provider ?? ""}
            onChange={(e) => onProvider(e.target.value)}
            title="Which provider carries his mind — your choice, never a fallback"
          >
            <option value="">provider…</option>
            {providerOptions.map((p) => (
              <option key={p.name} value={p.name}>
                {p.display_name || p.name}
                {p.local_provider ? " (local)" : ""}
              </option>
            ))}
          </select>
          {value?.provider ? (
            models === null || loadingModels ? (
              <span className="sp_loading">models…</span>
            ) : models.length > 0 ? (
              <select
                className="sp_select sp_select_model"
                value={value?.model ?? ""}
                onChange={(e) => onChange({ provider: value.provider, model: e.target.value })}
                title="Which model — auto-populated from the provider"
              >
                <option value="">model…</option>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                className="sp_input"
                placeholder="model (listing unavailable — type it)"
                value={value?.model ?? ""}
                onChange={(e) => onChange({ provider: value.provider, model: e.target.value })}
                title="#FALLBACK model listing unavailable for this provider — the explicit name still rules"
              />
            )
          ) : null}
        </>
      ) : (
        <>
          <input
            type="text"
            className="sp_input"
            placeholder="provider (discovery unavailable)"
            value={value?.provider ?? ""}
            onChange={(e) => onChange(e.target.value ? { provider: e.target.value, model: value?.model ?? "" } : null)}
          />
          <input
            type="text"
            className="sp_input"
            placeholder="model"
            value={value?.model ?? ""}
            onChange={(e) => onChange(value?.provider ? { provider: value.provider, model: e.target.value } : null)}
          />
        </>
      )}
      {discoveryError && !discoveryUp ? <span className="sp_note">{discoveryError}</span> : null}
    </div>
  );
}
