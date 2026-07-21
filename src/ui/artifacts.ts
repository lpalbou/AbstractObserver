/**
 * Artifact normalization + labeling (ui-rethink P1 steps 2+3, 2026-07-21).
 *
 * Moved VERBATIM from app.tsx module scope: the pure fold from wire
 * artifact shapes (envelope v1 / legacy refs / tag bags) into the one
 * RuntimeArtifact shape, plus the label/grouping/filter helpers the
 * artifact panels render from. Slice 3 added the two runtime-context
 * helpers (artifact_with_runtime_context, artifact_display_type_label_for)
 * — they need run_workflow_label, hence the run_labels import. No app
 * state, no I/O.
 */
import { artifact_display_kind } from "./artifact_rendering";
import { run_workflow_label } from "./run_labels";
import { type RunSummary } from "./run_status";
import {
  display_datetime,
  first_string,
  format_time_ago,
  number_or_null,
  parse_iso_ms,
  short_id,
} from "./format";

export type RuntimeArtifact = {
  artifact_id: string;
  run_id: string;
  content_type: string;
  modality: string;
  semantic_kind: string;
  render_kind: string;
  task: string;
  classification_source: string;
  session_id: string;
  workflow_id: string;
  node_id: string;
  step_id: string;
  effect_id: string;
  turn_id: string;
  ledger_cursor: string;
  parent_run_id: string;
  actor_id: string;
  title: string;
  created_at: string;
  size_bytes: number | null;
  filename: string;
  source_path: string;
  sha256: string;
  tags: Record<string, string>;
  producer: Record<string, any>;
  provenance: Record<string, any>;
  generation: Record<string, any>;
  media: Record<string, any>;
  source_refs: any[];
  access: Record<string, any>;
  links: Record<string, any>;
  available_actions: string[];
  provider_trace_available: boolean;
  audit_available: boolean;
  legacy_inferred: boolean;
  descriptor: Record<string, any>;
  source: "search" | "run" | "session";
  raw: any;
};

export type RuntimeArtifactGroupMode = "type" | "run" | "time" | "turn" | "node" | "workflow" | "location" | "source";
export type RuntimeArtifactSortMode = "newest" | "oldest" | "size_desc" | "size_asc" | "last_access" | "turn" | "type";
export type RuntimeArtifactDateFilter = "all" | "hour" | "today" | "week" | "month";
export type RuntimeArtifactTypeFilter = "voice" | "music" | "sound" | "recording" | "audio" | "image" | "video" | "markdown" | "html" | "json" | "document" | "code" | "text" | "other";

export function artifact_nested_ref(item: any): any {
  return item?.ref && typeof item.ref === "object"
    ? item.ref
    : item?.artifact_ref && typeof item.artifact_ref === "object"
      ? item.artifact_ref
      : item?.artifact && typeof item.artifact === "object"
        ? item.artifact
        : {};
}

export function infer_artifact_modality(item: any): string {
  const ref = artifact_nested_ref(item);
  const meta = item?.metadata && typeof item.metadata === "object" ? item.metadata : item?.meta && typeof item.meta === "object" ? item.meta : {};
  const tags = item?.tags && typeof item.tags === "object" ? item.tags : {};
  const explicit = first_string(item?.modality, ref?.modality, meta?.modality, tags.modality).toLowerCase();
  if (explicit) return explicit;
  const ct = first_string(item?.content_type, item?.mime_type, item?.mime, ref?.content_type, ref?.mime_type, ref?.mime, meta?.content_type, tags.content_type).toLowerCase();
  if (ct.startsWith("image/")) return "image";
  if (ct.startsWith("audio/")) return "audio";
  if (ct.startsWith("video/")) return "video";
  if (ct.includes("pdf")) return "document";
  if (ct.startsWith("text/") || ct.includes("json") || ct.includes("markdown") || ct.includes("csv")) return "text";
  return "artifact";
}

export function artifact_envelope(item: any): any {
  if (!item || typeof item !== "object") return {};
  if (item.artifact_envelope_v1 && typeof item.artifact_envelope_v1 === "object") return item.artifact_envelope_v1;
  if (item.envelope && typeof item.envelope === "object") return item.envelope;
  return item;
}

export function normalize_artifact_item(item: any, source: RuntimeArtifact["source"]): RuntimeArtifact | null {
  if (!item || typeof item !== "object") return null;
  const env = artifact_envelope(item);
  const ref = artifact_nested_ref(item);
  const meta = item?.metadata && typeof item.metadata === "object" ? item.metadata : item?.meta && typeof item.meta === "object" ? item.meta : {};
  const descriptor = env?.descriptor && typeof env.descriptor === "object" ? env.descriptor : item?.descriptor && typeof item.descriptor === "object" ? item.descriptor : {};
  const artifact_id = first_string(env.artifact_id, item.artifact_id, item.$artifact, item.id, ref.artifact_id, ref.$artifact, ref.id, meta.artifact_id, meta.$artifact);
  if (!artifact_id) return null;
  const tags0 = {
    ...(ref.tags && typeof ref.tags === "object" ? (ref.tags as Record<string, any>) : {}),
    ...(meta.tags && typeof meta.tags === "object" ? (meta.tags as Record<string, any>) : {}),
    ...(env.tags && typeof env.tags === "object" ? (env.tags as Record<string, any>) : {}),
    ...(item.tags && typeof item.tags === "object" ? (item.tags as Record<string, any>) : {}),
  };
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(tags0)) {
    const key = String(k || "").trim();
    if (!key) continue;
    tags[key] = String(v ?? "");
  }
  const filename = first_string(env.filename, item.filename, ref.filename, meta.filename, tags.filename, tags.name, item.name, ref.name);
  const source_path = first_string(env.source_path, item.source_path, ref.source_path, meta.source_path, item.path, ref.path, tags.path, tags.source_path, tags.file_path);
  const content_type = first_string(env.content_type, item.content_type, item.mime_type, item.mime, ref.content_type, ref.mime_type, ref.mime, meta.content_type, tags.content_type);
  const render_kind = first_string(env.render_kind, descriptor.render_kind, item.render_kind, tags.render_kind);
  const semantic_kind = first_string(env.semantic_kind, descriptor.semantic_kind, item.semantic_kind, tags.semantic_kind, tags.artifact_type);
  const access = env.access && typeof env.access === "object" ? env.access : item.access && typeof item.access === "object" ? item.access : {};
  const producer =
    env.producer && typeof env.producer === "object"
      ? env.producer
      : item.producer && typeof item.producer === "object"
        ? item.producer
        : descriptor.producer && typeof descriptor.producer === "object"
          ? descriptor.producer
          : {};
  const provenance =
    env.provenance && typeof env.provenance === "object"
      ? env.provenance
      : item.provenance && typeof item.provenance === "object"
        ? item.provenance
        : descriptor.provenance && typeof descriptor.provenance === "object"
          ? descriptor.provenance
          : {};
  const generation =
    env.generation && typeof env.generation === "object"
      ? env.generation
      : item.generation && typeof item.generation === "object"
        ? item.generation
        : descriptor.generation && typeof descriptor.generation === "object"
          ? descriptor.generation
          : {};
  const media =
    env.media && typeof env.media === "object"
      ? env.media
      : item.media && typeof item.media === "object"
        ? item.media
        : descriptor.media && typeof descriptor.media === "object"
          ? descriptor.media
          : {};
  const links =
    env.links && typeof env.links === "object"
      ? env.links
      : item.links && typeof item.links === "object"
        ? item.links
        : descriptor.links && typeof descriptor.links === "object"
          ? descriptor.links
          : {};
  return {
    artifact_id,
    run_id: first_string(env.run_id, item.run_id, ref.run_id, meta.run_id, tags.run_id, provenance.run_id),
    content_type,
    modality: first_string(env.modality, item.modality, descriptor.modality, tags.modality) || infer_artifact_modality({ ...item, ref, metadata: meta, tags }),
    semantic_kind: semantic_kind || infer_artifact_modality({ ...item, ref, metadata: meta, tags }),
    render_kind: render_kind || artifact_display_kind({ content_type, filename, source_path, modality: first_string(env.modality, item.modality, tags.modality), tags }),
    task: first_string(env.task, descriptor.task, item.task, tags.task, tags.provider_task),
    classification_source: first_string(env.classification_source, descriptor.classification_source, item.classification_source),
    session_id: first_string(env.session_id, descriptor.session_id, item.session_id, tags.session_id),
    workflow_id: first_string(env.workflow_id, descriptor.workflow_id, item.workflow_id, tags.workflow_id, tags.workflow),
    node_id: first_string(env.node_id, descriptor.node_id, item.node_id, tags.node_id, tags.node),
    step_id: first_string(env.step_id, descriptor.step_id, item.step_id, tags.step_id),
    effect_id: first_string(env.effect_id, descriptor.effect_id, item.effect_id, tags.effect_id, tags.effect_idempotency_key),
    turn_id: first_string(env.turn_id, descriptor.turn_id, item.turn_id, tags.turn_id, tags.turn),
    ledger_cursor: first_string(env.ledger_cursor, descriptor.ledger_cursor, item.ledger_cursor, tags.ledger_cursor, tags.step_cursor),
    parent_run_id: first_string(env.parent_run_id, descriptor.parent_run_id, item.parent_run_id, tags.parent_run_id),
    actor_id: first_string(env.actor_id, descriptor.actor_id, item.actor_id, tags.actor_id),
    title: first_string(env.title, item.title, tags.title, tags.label, tags.name),
    created_at: first_string(env.created_at, item.created_at, ref.created_at, meta.created_at, tags.created_at),
    size_bytes: number_or_null(env.size_bytes, item.size_bytes, ref.size_bytes, meta.size_bytes, tags.size_bytes),
    filename,
    source_path,
    sha256: first_string(env.sha256, item.sha256, ref.sha256, meta.sha256, tags.sha256),
    tags,
    producer,
    provenance,
    generation,
    media,
    source_refs: Array.isArray(env.source_refs) ? env.source_refs : Array.isArray(item.source_refs) ? item.source_refs : [],
    access,
    links,
    available_actions: Array.isArray(env.available_actions) ? env.available_actions.map(String) : Array.isArray(item.available_actions) ? item.available_actions.map(String) : [],
    provider_trace_available: Boolean(env.provider_trace_available ?? item.provider_trace_available),
    audit_available: Boolean(env.audit_available ?? item.audit_available),
    legacy_inferred: Boolean(
      (env.legacy_inferred ?? item.legacy_inferred) ||
        /(?:legacy|inferred|runtime_tags|runtime_mime)/i.test(first_string(env.classification_source, descriptor.classification_source, item.classification_source))
    ),
    descriptor,
    source,
    raw: item,
  };
}

export function artifact_label(a: RuntimeArtifact): string {
  return a.filename || a.title || (a.source_path ? a.source_path.split("/").filter(Boolean).slice(-1)[0] : "") || short_id(a.artifact_id, 16);
}

export function artifact_group_key(a: RuntimeArtifact, mode: RuntimeArtifactGroupMode): string {
  if (mode === "type") return artifact_semantic_label(a);
  if (mode === "run") return a.run_id || "(no run)";
  if (mode === "turn") return artifact_turn_label(a);
  if (mode === "node") return artifact_node_label(a) || "(node unknown)";
  if (mode === "workflow") return artifact_workflow_ref(a) || "(workflow unknown)";
  if (mode === "location") {
    const p = a.source_path || a.filename || "";
    const parts = p.split("/").filter(Boolean);
    return parts.length > 1 ? parts.slice(0, -1).join("/") : "(root)";
  }
  if (mode === "source") return artifact_origin_label(a) || a.source || "artifact";
  const ms = parse_iso_ms(a.created_at);
  if (ms === null) return "(unknown time)";
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function artifact_workflow_ref(a: RuntimeArtifact | null | undefined): string {
  const tags = a?.tags || {};
  return String(a?.workflow_id || tags.workflow_id || tags.workflow || "").trim();
}

export function artifact_node_label(a: RuntimeArtifact | null | undefined): string {
  const tags = a?.tags || {};
  const explicit = String(a?.node_id || tags.node_id || tags.node || a?.step_id || tags.step_id || "").trim();
  if (explicit) return explicit;
  const p = String(a?.source_path || tags.path || "").trim();
  const m = p.match(/(?:^|[._:/-])(node-[A-Za-z0-9_-]+)/);
  return m?.[1] ? String(m[1]) : "";
}

export function artifact_turn_label(a: RuntimeArtifact | null | undefined): string {
  const tags = a?.tags || {};
  const explicit = String(a?.turn_id || tags.turn_id || tags.turn || tags.cycle || a?.ledger_cursor || tags.ledger_cursor || tags.step_cursor || "").trim();
  if (explicit) return `turn ${explicit}`;
  const node = artifact_node_label(a);
  const ms = parse_iso_ms(a?.created_at);
  const time = ms === null ? "unknown time" : new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const run = a?.run_id ? short_id(String(a.run_id), 10) : "unknown run";
  return node ? `${run} · ${node} · ${time}` : `${run} · ${time}`;
}

export function artifact_provenance_label(a: RuntimeArtifact | null | undefined): string {
  if (!a) return "provenance unavailable";
  const bits: string[] = [];
  const workflow = artifact_workflow_ref(a);
  const node = artifact_node_label(a);
  const source = artifact_origin_label(a);
  const producer = artifact_provider_model_label(a);
  if (workflow) bits.push(workflow);
  if (node) bits.push(node);
  if (source) bits.push(source);
  if (producer) bits.push(producer);
  if (!bits.length) return "provenance unavailable";
  return bits.join(" · ");
}

export function format_bytes(size: number | null | undefined): string {
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = size;
  let idx = 0;
  while (n >= 1024 && idx < units.length - 1) {
    n /= 1024;
    idx += 1;
  }
  const digits = idx === 0 ? 0 : n >= 10 ? 1 : 2;
  return `${n.toFixed(digits)} ${units[idx]}`;
}

export function artifact_semantic_label(a: RuntimeArtifact | null | undefined): string {
  const kind = String(a?.semantic_kind || a?.modality || "").trim().toLowerCase();
  const render = String(a?.render_kind || "").trim().toLowerCase();
  const value = kind || render || "artifact";
  const labels: Record<string, string> = {
    voice: "Voice",
    music: "Music",
    sound: "Sound",
    recording: "Recording",
    audio: "Unclassified audio",
    image: "Image",
    video: "Video",
    markdown: "Markdown",
    html: "HTML",
    json: "JSON",
    document: "Document",
    code: "Code",
    text: "Text",
    binary: "Other",
    artifact: "Other",
  };
  return labels[value] || value.replace(/[_-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

export function runtime_type_filter_label(kind: RuntimeArtifactTypeFilter): string {
  if (kind === "html") return "HTML";
  if (kind === "json") return "JSON";
  if (kind === "audio") return "Unclassified audio";
  if (kind === "code") return "Code";
  return kind.slice(0, 1).toUpperCase() + kind.slice(1);
}

export function runtime_created_after_for_filter(filter: RuntimeArtifactDateFilter): string {
  const now = Date.now();
  if (filter === "hour") return new Date(now - 60 * 60 * 1000).toISOString();
  if (filter === "week") return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  if (filter === "month") return new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  if (filter === "today") {
    const d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
  }
  return "";
}

export function runtime_sort_gateway_params(sort: RuntimeArtifactSortMode): { order_by: string; order: "asc" | "desc" } {
  if (sort === "oldest") return { order_by: "created_at", order: "asc" };
  if (sort === "size_desc") return { order_by: "size_bytes", order: "desc" };
  if (sort === "size_asc") return { order_by: "size_bytes", order: "asc" };
  if (sort === "last_access") return { order_by: "last_accessed_at", order: "desc" };
  if (sort === "turn") return { order_by: "turn", order: "asc" };
  if (sort === "type") return { order_by: "semantic_kind", order: "asc" };
  return { order_by: "created_at", order: "desc" };
}

export function artifact_facets_from_search_response(search_res: any): Record<string, Record<string, number>> {
  const stats = search_res?.stats && typeof search_res.stats === "object" ? search_res.stats : {};
  const facets = stats?.facets && typeof stats.facets === "object" ? stats.facets : search_res?.facets && typeof search_res.facets === "object" ? search_res.facets : {};
  return facets && typeof facets === "object" ? (facets as Record<string, Record<string, number>>) : {};
}

export function artifact_created_label(a: RuntimeArtifact): string {
  const dt = display_datetime(a.created_at);
  const ago = format_time_ago(a.created_at);
  if (dt === "—") return "Created —";
  return `${dt}${ago && ago !== "—" ? ` (${ago})` : ""}`;
}

export function artifact_last_seen_label(a: RuntimeArtifact): string {
  const tags = a.tags || {};
  const ts = String(a.access?.last_accessed_at || tags.last_accessed_at || tags.accessed_at || tags.updated_at || a.created_at || "").trim();
  const label = display_datetime(ts);
  return label === "—" ? "—" : label;
}

export function artifact_human_title(a: RuntimeArtifact): string {
  const tags = a.tags || {};
  const explicit = String(a.title || tags.title || tags.name || tags.label || a.filename || "").trim();
  if (explicit) return explicit;
  const path = String(a.source_path || tags.path || "").trim();
  if (path) return path.split("/").filter(Boolean).slice(-1)[0] || path;
  const source = artifact_origin_label(a);
  const type = artifact_semantic_label(a);
  if (source) return `${type} ${source}`;
  return `${type} artifact`;
}

export function artifact_origin_label(a: RuntimeArtifact): string {
  const tags = a.tags || {};
  return String(a.task || a.provenance?.source || tags.task || tags.kind || tags.source || a.source || "").trim();
}

export function artifact_provider_model_label(a: RuntimeArtifact | null | undefined): string {
  if (!a) return "";
  const provider = first_string(a.producer?.provider, a.producer?.provider_id, a.provenance?.provider, a.generation?.provider);
  const model = first_string(a.producer?.model, a.producer?.model_id, a.provenance?.model, a.generation?.model);
  if (provider && model) return `${provider} / ${model}`;
  return provider || model;
}

export function artifact_generation_prompt(a: RuntimeArtifact | null | undefined): string {
  if (!a) return "";
  return first_string(a.generation?.prompt, a.generation?.input, a.generation?.text, a.provenance?.prompt);
}

export function artifact_media_fact_label(a: RuntimeArtifact | null | undefined): string {
  if (!a) return "";
  const media = a.media || {};
  const duration = Number(media.duration_s ?? media.duration_seconds ?? media.duration);
  const width = Number(media.width ?? media.image_width ?? media.video_width);
  const height = Number(media.height ?? media.image_height ?? media.video_height);
  const sample_rate = Number(media.sample_rate ?? media.sample_rate_hz);
  const channels = Number(media.channels);
  if (Number.isFinite(duration) && duration > 0) {
    const bits = [`${duration >= 60 ? `${Math.floor(duration / 60)}m ${Math.round(duration % 60)}s` : `${duration.toFixed(duration >= 10 ? 1 : 2)}s`}`];
    if (Number.isFinite(sample_rate) && sample_rate > 0) bits.push(`${Math.round(sample_rate / 1000)} kHz`);
    if (Number.isFinite(channels) && channels > 0) bits.push(`${channels} ch`);
    return bits.join(" · ");
  }
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) return `${Math.round(width)} x ${Math.round(height)}`;
  const pages = Number(media.page_count ?? media.pages);
  if (Number.isFinite(pages) && pages > 0) return `${Math.round(pages)} pages`;
  return "";
}

export function artifact_path_label(a: RuntimeArtifact): string {
  return a.source_path || a.filename || "";
}


export function artifact_with_runtime_context(a: RuntimeArtifact, run_by_id: Record<string, RunSummary>, workflow_label_by_id: Record<string, string>): RuntimeArtifact {
  const run = a.run_id ? run_by_id[a.run_id] || null : null;
  if (!run) return a;
  const workflow = run_workflow_label(run, workflow_label_by_id);
  const tags = { ...(a.tags || {}) };
  if (workflow && !tags.workflow) tags.workflow = workflow;
  if (workflow && !tags.workflow_id) tags.workflow_id = workflow;
  return { ...a, workflow_id: a.workflow_id || workflow, tags };
}

export function artifact_display_type_label_for(a: RuntimeArtifact, run_by_id: Record<string, RunSummary>, workflow_label_by_id: Record<string, string>, text = ""): string {
  const enriched = artifact_with_runtime_context(a, run_by_id, workflow_label_by_id);
  const kind = artifact_display_kind(enriched, text);
  const labels: Record<string, string> = {
    json: "JSON",
    html: "HTML",
    markdown: "Markdown",
    code: "Code",
    voice: "Voice",
    music: "Music",
    sound: "Sound",
    audio: "Unclassified audio",
    image: "Image",
    video: "Video",
    document: "Document",
    text: "Text",
    other: "Other",
  };
  return labels[kind] || artifact_semantic_label(enriched);
}

