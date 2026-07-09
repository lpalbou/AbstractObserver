/**
 * Create an entity home (the manager's second half, 0010 121500Z).
 *
 * The server owns the defaults: spark_text is OPTIONAL (the gateway fills
 * DEFAULT_SPARK_TEMPLATE with the name), and `framework: true` runs the
 * spark lint that REQUIRES the shared_vulnerability core value. Refusals
 * (lint errors, spark drift 409s) are human-written on the server — they
 * render here VERBATIM, never paraphrased.
 */

import React, { useState } from "react";

import { createEntity } from "./stream_source";

export interface CreateEntityFormProps {
  baseUrl: string;
  token: string | null;
  onCreated(slug: string): void;
}

export function CreateEntityForm({ baseUrl, token, onCreated }: CreateEntityFormProps): React.ReactElement {
  const [name, setName] = useState("");
  const [sparkText, setSparkText] = useState("");
  const [showSpark, setShowSpark] = useState(false);
  const [framework, setFramework] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setNote(null);
    createEntity(baseUrl, trimmed, token, { spark_text: sparkText, framework })
      .then((r) => {
        const slug = String(r.slug || trimmed.toLowerCase());
        setNote(
          r.created === false
            ? `${r.name ?? trimmed} already exists (same spark) — opening the existing home.`
            : `${r.name ?? trimmed} is born — spark engrammed, home created.`,
        );
        onCreated(slug);
      })
      .catch((e: Error) => {
        // Server refusals are written for humans — verbatim, never rewrapped.
        setNote(e.message);
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="create_entity">
      <div className="ce_row">
        <input
          type="text"
          className="ce_name"
          placeholder="name (e.g. Pollux)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <label className="ce_lint" title="The framework lint requires the shared_vulnerability core value in the spark — disabling is a deliberate operator override">
          <input type="checkbox" checked={framework} onChange={(e) => setFramework(e.target.checked)} />
          framework lint
        </label>
        <button className="ce_submit" onClick={submit} disabled={busy || !name.trim()}>
          {busy ? "engramming…" : "create"}
        </button>
      </div>
      <button className="ce_spark_toggle" onClick={() => setShowSpark((v) => !v)}>
        {showSpark ? "▾" : "▸"} spark document {sparkText.trim() ? "(custom)" : "(server template)"}
      </button>
      {showSpark ? (
        <textarea
          className="ce_spark"
          placeholder="Optional spark YAML — leave empty to use the framework template with the name filled in. Stored byte-verbatim as the attested seed."
          value={sparkText}
          onChange={(e) => setSparkText(e.target.value)}
          rows={10}
          spellCheck={false}
        />
      ) : null}
      {note ? <p className="ce_note">{note}</p> : null}
      <p className="ce_hint">
        A home is one identity for life: spark stored byte-verbatim, engrammed once, never purged. Creation is idempotent for the
        same spark; a CHANGED document for an existing name is refused.
      </p>
    </div>
  );
}
