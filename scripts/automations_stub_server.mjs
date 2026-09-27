#!/usr/bin/env node
// Automations v1 stub gateway — contract F of automations-CONTRACTS.md rev 2,
// seeded from the ui-kit's CANONICAL fixtures
// (../abstractuic/ui-kit/scripts/fixtures/automations/*.json, read at start,
// never copied). It exists so the Observer can be built and tested before the
// real gateway routes land; the integration pass against a hermetic gateway
// replaces it (mission G).
//
// It serves only the automation surface plus the two legacy paths the
// Observer uses for automation rows:
//   GET/POST  /api/gateway/automations
//   GET/PATCH /api/gateway/automations/{id}
//   POST      /api/gateway/automations/{id}/commands|discuss|seen
//   GET       /api/gateway/automations/{id}/occurrences|attention
//   GET       /api/gateway/trigger-sources
//   GET       /api/gateway/discovery/capabilities   (contracts.common.automations)
//   POST      /api/gateway/commands                 (legacy types + wait resume)
//   GET       /api/gateway/runs/{id}, /runs/{id}/input_data (legacy rows only)
// Every non-2xx body is the contract envelope {"detail": {reason_code, message, field?, command_id?}}.
//
// Usage: `node scripts/automations_stub_server.mjs [--port 18951]` (logs the
// URL), or `startAutomationsStub({port: 0})` from a test.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = resolve(HERE, "../../abstractuic/ui-kit/scripts/fixtures/automations");

export function loadFixture(name) {
  return JSON.parse(readFileSync(resolve(FIXTURES_DIR, `${name}.json`), "utf8"));
}

const DURATION_RE = /^[1-9][0-9]*[smhd]$/;
const UNIT_S = { s: 1, m: 60, h: 3600, d: 86400 };
const clone = (v) => JSON.parse(JSON.stringify(v));

class ApiFailure extends Error {
  constructor(status, reason_code, message, extra = {}) {
    super(message);
    this.status = status;
    this.detail = { reason_code, message, ...extra };
  }
}

function intervalLabel(every) {
  const m = /^([1-9][0-9]*)([smhd])$/.exec(every);
  const words = { s: ["second", "seconds"], m: ["minute", "minutes"], h: ["hour", "hours"], d: ["day", "days"] };
  if (!m) return `every ${every}`;
  const [one, many] = words[m[2]];
  return Number(m[1]) === 1 ? `every ${one}` : `every ${m[1]} ${many}`;
}

function seqOf(cursor) {
  const m = /^att1:(\d+)$/.exec(String(cursor || ""));
  return m ? Number(m[1]) : null;
}

/** The legacy schedule row comes from the canonical list fixture (captured
 * from abstractgateway 5161785). Its RUN projection (`GET /runs/{id}` and
 * `/runs/{id}/input_data`) is not a fixture: it is built here in the real
 * shape observed on that gateway — `schedule` names the target only by
 * target_bundle_ref / target_flow_id / target_workflow_id. */
export const LEGACY_ID = loadFixture("list").items.find((s) => s.legacy === true)?.automation_id;
if (!LEGACY_ID) throw new Error("list.json has no legacy row; the stub needs one");
export const LEGACY_TARGET = { bundle_id: "acceptance-automations", bundle_version: "1.0.0", flow_id: "echo" };
function legacyRunSeed(summary) {
  const ref = `${LEGACY_TARGET.bundle_id}@${LEGACY_TARGET.bundle_version}`;
  return {
    run: {
      run_id: LEGACY_ID,
      workflow_id: `scheduled:${LEGACY_ID}`,
      status: "waiting",
      is_scheduled: true,
      role: "legacy_schedule",
      session_kind: "automation",
      legacy: true,
      paused: false,
      waiting: { reason: "until", until: summary.next_fire_at ?? null, wait_key: `until:${LEGACY_ID}` },
      schedule: {
        kind: "scheduled_run",
        interval: summary.trigger.config.every,
        repeat_count: null,
        repeat_until: null,
        start_at: null,
        share_context: summary.context_mode === "growing",
        target_workflow_id: `${ref}:${LEGACY_TARGET.flow_id}`,
        target_bundle_ref: ref,
        target_flow_id: LEGACY_TARGET.flow_id,
        created_at: "2026-09-27T06:00:00+00:00",
        updated_at: null,
      },
    },
    input_data: {
      run_id: LEGACY_ID,
      workflow_id: `scheduled:${LEGACY_ID}`,
      bundle_id: LEGACY_TARGET.bundle_id,
      bundle_version: LEGACY_TARGET.bundle_version,
      flow_id: LEGACY_TARGET.flow_id,
      input_data: {
        prompt: "Legacy hourly digest",
        provider: "lmstudio",
        workflow_selection: { workflow_id: `${ref}:${LEGACY_TARGET.flow_id}`, source: "client" },
        _runtime: { thinking: "low" },
      },
    },
  };
}

export function createAutomationsStub(options = {}) {
  const pageSize = options.pageSize ?? 50;
  const list = loadFixture("list");
  const occurrences = loadFixture("occurrences");
  const attention = loadFixture("attention");
  const triggerSources = loadFixture("trigger-sources");
  const errors = loadFixture("errors");

  let counter = 0;
  const mint = (prefix) => {
    counter += 1;
    const hex = createHash("sha256").update(`${prefix}:${counter}`).digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };

  /** id → {summary, definition, occurrences[] (any order), attention[], seen_seq, discussions[], request_digest} */
  const autos = new Map();
  const legacyRuns = new Map();
  const requests = [];
  const creates = new Map(); // request_id → {digest, response}

  const inboxId = attention.items[0].automation_id;
  for (const s of list.items) {
    if (s.legacy) {
      // Legacy rows have no occurrences on the automation routes.
      autos.set(s.automation_id, { summary: clone(s), definition: null, occurrences: [], attention: [], seen_seq: 0, discussions: [], prompt: "" });
      legacyRuns.set(s.automation_id, legacyRunSeed(s));
      continue;
    }
    const occ =
      s.automation_id === inboxId
        ? clone(occurrences.items)
        : s.last_occurrence
          ? [
              {
                run_id: s.last_occurrence.run_id,
                index: s.last_occurrence.index,
                attempts: s.last_occurrence.attempts,
                fired_at: s.last_occurrence.fired_at,
                ...(s.last_occurrence.finished_at ? { finished_at: s.last_occurrence.finished_at } : {}),
                status: s.last_occurrence.status,
                trigger: { source_id: "schedule", summary: `schedule: ${intervalLabel(s.trigger.config.every)} (UTC), tick ${s.last_occurrence.index}` },
                user_turn: `[Trigger schedule@1 · occurrence ${s.last_occurrence.index} · fired ${s.last_occurrence.fired_at}]\n${s.title}`,
                answer: s.last_occurrence.excerpt,
                notify: s.last_occurrence.notify,
                artifacts: [],
                waits: [],
                ledger_url: `/api/gateway/runs/${s.last_occurrence.run_id}/ledger`,
              },
            ]
          : [];
    autos.set(s.automation_id, {
      summary: clone(s),
      definition: null,
      occurrences: occ,
      attention: s.automation_id === inboxId ? clone(attention.items) : [],
      seen_seq: seqOf(s.attention.cursor) - s.attention.unseen_count,
      discussions: [],
      prompt: s.title,
      // Fixture counts include occurrences the fixtures do not spell out.
      unlisted: s.occurrence_count - occ.length,
    });
  }

  function definitionOf(a) {
    const s = a.summary;
    return {
      schema_version: 1,
      revision: s.revision ?? 1,
      title: s.title,
      controller: { bundle_ref: "abstractframework.automation-controller@1.0.0", flow_id: "controller" },
      target: a.target ?? { workflow_id: "basic-agent@1.0.0:main", bundle_ref: "basic-agent@1.0.0", flow_id: "main", input_data: { prompt: a.prompt } },
      trigger: s.trigger,
      context: { mode: s.context_mode, growing: {} },
      policy: { serial: true, misfire: "coalesce", failure: "continue", retry: { max_attempts: 3, backoff: { initial: "30s", factor: 2, max: "10m" } } },
      session_id: `automation-session:${s.automation_id}`,
      workspace_root: `/tmp/automations/${s.automation_id}`,
      created_at: s.trigger.config.start_at ?? "2026-09-27T00:00:00Z",
      archived_at: s.status === "archived" ? s.updated_at : null,
    };
  }

  function recomputeAttention(a) {
    const unseen = a.attention.filter((it) => seqOf(it.cursor) > a.seen_seq);
    const waits = [];
    for (const o of a.occurrences) for (const w of o.waits) waits.push({ run_id: w.run_id, wait_key: w.wait_key, index: o.index, kind: w.kind, ...(w.prompt ? { prompt: w.prompt } : {}), ...(w.details ? { details: w.details } : {}) });
    const latest = a.attention.reduce((m, it) => Math.max(m, seqOf(it.cursor)), seqOf(a.summary.attention.cursor) ?? 0);
    a.summary.attention = {
      pending_waits: waits.length,
      unread: unseen.length > 0,
      unseen_count: unseen.length,
      cursor: `att1:${latest}`,
      items: unseen.slice(0, 20),
      waits: waits.slice(0, 20),
    };
  }

  function newestOccurrence(a) {
    return [...a.occurrences].sort((x, y) => y.index - x.index)[0];
  }

  function refreshLast(a) {
    const o = newestOccurrence(a);
    a.summary.occurrence_count = a.occurrences.length + (a.unlisted ?? 0);
    if (o) {
      a.summary.last_occurrence = {
        run_id: o.run_id,
        index: o.index,
        status: o.status,
        attempts: o.attempts,
        fired_at: o.fired_at,
        ...(o.finished_at ? { finished_at: o.finished_at } : {}),
        excerpt: (o.answer || (o.waits[0]?.prompt ? `Waiting for you: ${o.waits[0].prompt}` : "")).slice(0, 200),
        notify: o.notify,
      };
    }
    recomputeAttention(a);
  }
  for (const a of autos.values()) if (!a.summary.legacy) recomputeAttention(a);

  function get(id) {
    const a = autos.get(id);
    if (!a) throw new ApiFailure(404, "automation_not_found", "Automation not found.");
    return a;
  }

  function busy(a) {
    return a.occurrences.some((o) => ["running", "waiting", "backoff"].includes(o.status)) || a.manualPending;
  }

  function validateTarget(t) {
    if (!t || typeof t !== "object") throw new ApiFailure(422, "invalid_request", "target is required.", { field: "target" });
    const keys = Object.keys(t).sort().join(",");
    if (t.flow_id === "@default") {
      if (keys !== "flow_id,input_data,interface" && keys !== "flow_id,interface")
        throw new ApiFailure(422, "invalid_request", "A @default target is {flow_id, interface, input_data?}.", { field: "target" });
      if (typeof t.interface !== "string" || !t.interface) throw new ApiFailure(422, "invalid_definition", "interface is required with flow_id '@default'.", { field: "target.interface" });
      return;
    }
    if (keys !== "bundle_ref,flow_id,input_data" && keys !== "bundle_ref,flow_id")
      throw new ApiFailure(422, "invalid_request", "A bundle target is {bundle_ref, flow_id, input_data?}.", { field: "target" });
    if (!/^[^@\s]+@[^@\s]+$/.test(String(t.bundle_ref))) throw new ApiFailure(422, "invalid_definition", "bundle_ref must be <bundle_id>@<version>.", { field: "target.bundle_ref" });
  }

  function validateTrigger(tr, field = "trigger") {
    if (!tr || typeof tr !== "object") throw new ApiFailure(422, "invalid_request", "trigger is required.", { field });
    const known = triggerSources.items.find((x) => x.id === tr.source_id && x.version === tr.source_version);
    if (!known) throw new ApiFailure(422, "unknown_trigger_source", `No trigger source ${tr.source_id}@${tr.source_version}.`, { field: `${field}.source_id` });
    const c = tr.config || {};
    const allowed = new Set(["start_at", "every", "until", "count", "anchor"]);
    for (const k of Object.keys(c)) if (!allowed.has(k)) throw new ApiFailure(422, "invalid_definition", `Unknown schedule field ${k}.`, { field: `${field}.config.${k}` });
    if (c.every !== undefined && !DURATION_RE.test(c.every)) throw new ApiFailure(422, "invalid_definition", "every must match ^[1-9][0-9]*[smhd]$.", { field: `${field}.config.every` });
    if (c.count !== undefined && (!Number.isInteger(c.count) || c.count < 1)) throw new ApiFailure(422, "invalid_definition", "count must be an integer >= 1.", { field: `${field}.config.count` });
    if (c.count > 1 && c.every === undefined) throw new ApiFailure(422, "invalid_definition", "count > 1 requires every.", { field: `${field}.config.count` });
    for (const k of ["start_at", "until", "anchor"]) if (c[k] !== undefined && Number.isNaN(Date.parse(c[k]))) throw new ApiFailure(422, "invalid_definition", `${k} must be an RFC3339 timestamp.`, { field: `${field}.config.${k}` });
  }

  function nextFire(config, now) {
    if (!config.every) return config.start_at && Date.parse(config.start_at) > now ? config.start_at : undefined;
    const m = /^([1-9][0-9]*)([smhd])$/.exec(config.every);
    const step = Number(m[1]) * UNIT_S[m[2]] * 1000;
    const anchor = Date.parse(config.anchor ?? config.start_at);
    const k = Math.max(0, Math.floor((now - anchor) / step) + 1);
    return new Date(anchor + k * step).toISOString().replace(".000Z", "Z");
  }

  const now = () => (options.now ? options.now() : Date.now());
  const nowIso = () => new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z");
  let seq = 100;
  // A repeated command_id is not accepted again: {accepted:false, duplicate:true}
  // with the first seq (observed on abstractgateway 5161785).
  const firstSeq = new Map();
  const receipt = (command_id, duplicate = false) => {
    if (!duplicate) firstSeq.set(command_id, ++seq);
    return { command_id, accepted: !duplicate, duplicate, seq: firstSeq.get(command_id) };
  };
  const seenCommands = new Map();

  function create(body) {
    const allowedTop = new Set(["request_id", "title", "target", "trigger", "context", "policy"]);
    for (const k of Object.keys(body || {})) if (!allowedTop.has(k)) throw new ApiFailure(422, "invalid_request", `Unknown field ${k}.`, { field: k });
    if (typeof body.request_id !== "string" || !body.request_id) throw new ApiFailure(422, "invalid_request", "request_id is required.", { field: "request_id" });
    if (typeof body.title !== "string" || !body.title.trim() || body.title.length > 120) throw new ApiFailure(422, "invalid_definition", "title must be 1-120 characters.", { field: "title" });
    validateTarget(body.target);
    validateTrigger(body.trigger);
    const policy = body.policy ?? {};
    for (const k of Object.keys(policy)) if (k !== "retry" && k !== "tool_approval") throw new ApiFailure(422, "invalid_request", `Unknown policy field ${k}.`, { field: `policy.${k}` });
    if (policy.tool_approval !== undefined && !["auto", "ask"].includes(policy.tool_approval))
      throw new ApiFailure(422, "invalid_definition", "policy.tool_approval is auto or ask.", { field: "policy.tool_approval" });
    const mode = body.context?.mode ?? "independent";
    if (mode !== "independent" && mode !== "growing") throw new ApiFailure(422, "invalid_definition", "context.mode is independent or growing.", { field: "context.mode" });
    const digest = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const prior = creates.get(body.request_id);
    if (prior) {
      if (prior.digest !== digest) throw new ApiFailure(409, "identity_conflict", "request_id was already used with a different request.", { field: "request_id" });
      return prior.response;
    }
    const id = mint("automation");
    const config = { ...body.trigger.config };
    if (!config.start_at) config.start_at = nowIso();
    if (!config.anchor) config.anchor = config.start_at;
    const summary = {
      automation_id: id,
      title: body.title,
      status: "active",
      trigger: { binding_id: mint("binding"), source_id: body.trigger.source_id, source_version: body.trigger.source_version, config },
      context_mode: mode,
      ...(nextFire(config, now()) ? { next_fire_at: nextFire(config, now()) } : {}),
      occurrence_count: 0,
      attention: { pending_waits: 0, unread: false, unseen_count: 0, cursor: "att1:0", items: [], waits: [] },
      legacy: false,
      revision: 1,
      updated_at: nowIso(),
      capabilities: ["revise", "pause", "resume", "run_now", "stop_current", "archive", "discuss"],
      session_kind: "automation",
    };
    const t = body.target;
    const resolved =
      t.flow_id === "@default"
        ? { workflow_id: "basic-agent@1.0.0:main", bundle_ref: "basic-agent@1.0.0", flow_id: "main", input_data: t.input_data ?? {} }
        : { workflow_id: `${t.bundle_ref}:${t.flow_id}`, bundle_ref: t.bundle_ref, flow_id: t.flow_id, input_data: t.input_data ?? {} };
    const a = { summary, target: resolved, occurrences: [], attention: [], seen_seq: 0, discussions: [], prompt: String(resolved.input_data.prompt ?? "") };
    autos.set(id, a);
    const response = { automation_id: id, revision: 1, summary: clone(summary) };
    creates.set(body.request_id, { digest, response });
    return response;
  }

  function applyCommand(a, body) {
    const allowed = new Set(["command_id", "type", "payload"]);
    for (const k of Object.keys(body || {})) if (!allowed.has(k)) throw new ApiFailure(422, "invalid_request", `Unknown field ${k}.`, { field: k });
    if (typeof body.command_id !== "string" || !body.command_id) throw new ApiFailure(422, "invalid_request", "command_id is required.", { field: "command_id" });
    const key = `${a.summary.automation_id}:${body.command_id}`;
    if (seenCommands.has(key)) return receipt(body.command_id, true);
    const s = a.summary;
    if (a.summary.legacy) throw new ApiFailure(409, "invalid_state", "Legacy schedules take the legacy commands on /api/gateway/commands.", { command_id: body.command_id });
    if (s.status === "archived") throw new ApiFailure(409, "invalid_state", "Automation is archived.", { command_id: body.command_id });
    switch (body.type) {
      case "automation.pause":
        s.status = "paused";
        delete s.next_fire_at;
        break;
      case "automation.resume":
        if (s.status === "paused") {
          s.status = "active";
          const nf = nextFire(s.trigger.config, now());
          if (nf) s.next_fire_at = nf;
        }
        break;
      case "automation.run_now": {
        if (busy(a)) throw new ApiFailure(409, "automation_busy", "An occurrence is already running or queued.", { command_id: body.command_id });
        fire(a, { manual: body.command_id });
        break;
      }
      case "automation.stop_current": {
        const cur = a.occurrences.find((o) => ["running", "waiting", "backoff"].includes(o.status));
        if (!cur) throw new ApiFailure(409, "invalid_state", "Nothing is running.", { command_id: body.command_id });
        cur.status = "cancelled";
        cur.waits = [];
        cur.finished_at = nowIso();
        break;
      }
      case "automation.archive":
        s.status = "archived";
        delete s.next_fire_at;
        break;
      default:
        throw new ApiFailure(422, "invalid_request", `Unknown command type ${body.type}.`, { field: "type", command_id: body.command_id });
    }
    seenCommands.set(key, true);
    s.updated_at = nowIso();
    refreshLast(a);
    return receipt(body.command_id);
  }

  function revise(a, body) {
    const allowed = new Set(["command_id", "expected_revision", "changes"]);
    for (const k of Object.keys(body || {})) if (!allowed.has(k)) throw new ApiFailure(422, "invalid_request", `Unknown field ${k}.`, { field: k });
    const s = a.summary;
    if (s.legacy) throw new ApiFailure(409, "invalid_state", "Legacy schedules cannot be revised here.", { command_id: body.command_id });
    if (s.status === "archived") throw new ApiFailure(409, "invalid_state", "Automation is archived.", { command_id: body.command_id });
    if (body.expected_revision !== undefined && body.expected_revision !== s.revision)
      throw new ApiFailure(409, "revision_conflict", `Automation is at revision ${s.revision}, not ${body.expected_revision}.`, { field: "expected_revision", command_id: body.command_id });
    const c = body.changes || {};
    if (c.trigger) {
      validateTrigger(c.trigger, "changes.trigger");
      s.trigger = { binding_id: mint("binding"), source_id: c.trigger.source_id, source_version: c.trigger.source_version, config: { ...c.trigger.config } };
      if (s.status === "active") {
        const nf = nextFire(s.trigger.config, now());
        if (nf) s.next_fire_at = nf;
      }
    }
    if (typeof c.title === "string") s.title = c.title;
    if (c.context?.mode) s.context_mode = c.context.mode;
    s.revision += 1;
    s.updated_at = nowIso();
    return receipt(body.command_id);
  }

  /** Simulate the controller admitting and finishing an occurrence. */
  function fire(a, spec = {}) {
    const index = a.occurrences.reduce((m, o) => Math.max(m, o.index), 0) + 1;
    const run_id = mint(`occ:${a.summary.automation_id}:${index}`);
    const firedAt = spec.fired_at ?? nowIso();
    const manual = spec.manual;
    const every = a.summary.trigger.config.every;
    const summary = manual ? `manual: run now (${manual})` : `schedule: ${every ? intervalLabel(every) : "once"} (UTC), tick ${index - 1}`;
    const status = spec.status ?? (spec.wait ? "waiting" : "completed");
    const row = {
      run_id,
      index,
      attempts: spec.attempts ?? 1,
      fired_at: firedAt,
      ...(status === "waiting" || status === "running" ? {} : { finished_at: firedAt }),
      status,
      trigger: { source_id: manual ? "manual" : "schedule", summary },
      user_turn: `[Trigger ${manual ? "manual" : "schedule"}@1 · occurrence ${index} · fired ${firedAt}]\n${a.prompt}`,
      answer: spec.answer ?? "",
      notify: spec.notify ?? null,
      artifacts: [],
      waits: spec.wait ? [{ run_id, wait_key: spec.wait.wait_key, kind: spec.wait.kind ?? "ask_user", reason: "user", prompt: spec.wait.prompt, ...(spec.wait.choices ? { choices: spec.wait.choices } : {}), ...(spec.wait.details ? { details: spec.wait.details } : {}) }] : [],
      ledger_url: `/api/gateway/runs/${run_id}/ledger`,
      workspace_url: `/api/gateway/runs/${run_id}/workspace`,
      ...(spec.failure ? { failure: spec.failure } : {}),
    };
    a.occurrences.push(row);
    const notable = status === "failed" ? { kind: "failure", title: `${a.summary.title} failed after ${row.attempts} attempts`, body: spec.failure?.message } : row.notify ? { kind: "notify", title: row.notify.title, body: row.notify.body } : null;
    if (notable) {
      const latest = a.attention.reduce((m, it) => Math.max(m, seqOf(it.cursor)), seqOf(a.summary.attention.cursor) ?? 0);
      a.attention.push({ ...notable, automation_id: a.summary.automation_id, run_id, index, at: firedAt, cursor: `att1:${latest + 1}` });
    }
    a.summary.updated_at = nowIso();
    refreshLast(a);
    return clone(row);
  }

  function resumeWait(body) {
    const p = body.payload || {};
    for (const a of autos.values()) {
      for (const o of a.occurrences) {
        // A wait lives on the run that waits (the occurrence or one of its descendants).
        if (!o.waits.some((x) => x.run_id === body.run_id)) continue;
        const w = o.waits.find((x) => x.run_id === body.run_id && x.wait_key === p.wait_key);
        if (!w) throw new ApiFailure(409, "invalid_state", `Run ${body.run_id} is not waiting on ${p.wait_key}.`);
        const ans = p.payload || {};
        const okShape =
          w.kind === "ask_user" ? typeof ans.response === "string" : w.kind === "tool_approval" ? typeof ans.approved === "boolean" : w.kind === "event" ? "payload" in ans : false;
        if (!okShape) throw new ApiFailure(422, "invalid_request", `A ${w.kind} wait is not answered with ${JSON.stringify(Object.keys(ans))}.`, { field: "payload" });
        o.waits = o.waits.filter((x) => x !== w);
        o.status = o.waits.length ? "waiting" : "completed";
        if (!o.waits.length) o.finished_at = nowIso();
        o.answer = w.kind === "tool_approval" ? `Tools ${ans.approved ? "approved" : "denied"}.` : `Answered: ${String(ans.response ?? JSON.stringify(ans.payload))}`;
        refreshLast(a);
        return { accepted: true, command_id: body.command_id };
      }
    }
    return null;
  }

  function legacyCommand(body) {
    const l = legacyRuns.get(body.run_id);
    if (!l) return null;
    const a = autos.get(body.run_id);
    if (body.type === "pause") {
      l.run.paused = true;
      a.summary.status = "paused";
      delete a.summary.next_fire_at;
    } else if (body.type === "resume" && body.payload?.payload?.mode === "run_now") {
      a.summary.occurrence_count += 1;
    } else if (body.type === "resume") {
      l.run.paused = false;
      a.summary.status = "active";
      a.summary.next_fire_at = l.run.waiting.until;
    } else if (body.type === "update_schedule") {
      l.run.schedule.interval = body.payload.interval;
      a.summary.trigger.config.every = body.payload.interval;
    } else {
      throw new ApiFailure(422, "invalid_request", `Unsupported legacy command ${body.type}.`);
    }
    return { accepted: true, command_id: body.command_id };
  }

  function page(items, url) {
    const cursor = url.searchParams.get("cursor");
    const limit = Math.min(Number(url.searchParams.get("limit") || pageSize), pageSize);
    const start = cursor ? Number(cursor.replace(/^p/, "")) : 0;
    if (!Number.isInteger(start) || start < 0 || start > items.length) throw new ApiFailure(422, "invalid_request", "Unknown cursor.", { field: "cursor" });
    const slice = items.slice(start, start + limit);
    const next = start + limit < items.length ? `p${start + limit}` : null;
    return { items: clone(slice), next_cursor: next };
  }

  async function route(method, url, body) {
    const path = url.pathname;
    if (path === "/api/gateway/discovery/capabilities" && method === "GET") {
      return {
        capabilities: {
          contracts: {
            common: {
              automations: { available: true, version: 1, endpoint: "/api/gateway/automations", trigger_sources_endpoint: "/api/gateway/trigger-sources" },
            },
          },
        },
      };
    }
    if (path === "/api/gateway/trigger-sources" && method === "GET") return clone(triggerSources);
    if (path === "/api/gateway/commands" && method === "POST") {
      if (body?.type === "resume" && body?.payload?.wait_key) {
        const r = resumeWait(body);
        if (r) return r;
      }
      const l = legacyCommand(body || {});
      if (l) return l;
      throw new ApiFailure(404, "run_not_found", `Unknown run ${body?.run_id}.`);
    }
    let m = /^\/api\/gateway\/runs\/([^/]+)(\/input_data)?$/.exec(path);
    if (m && method === "GET") {
      const l = legacyRuns.get(decodeURIComponent(m[1]));
      if (!l) throw new ApiFailure(404, "run_not_found", "Run not found.");
      return clone(m[2] ? l.input_data : l.run);
    }
    if (path === "/api/gateway/automations") {
      if (method === "GET") {
        if (url.searchParams.has("changed_since")) throw new ApiFailure(422, "unsupported_feature", "changed_since is not supported in v1.", { field: "changed_since" });
        const status = url.searchParams.get("status");
        const rows = [...autos.values()].map((a) => a.summary).filter((s) => !status || s.status === status);
        return page(rows, url);
      }
      if (method === "POST") return create(body);
    }
    m = /^\/api\/gateway\/automations\/([^/]+)(?:\/([a-z_]+))?$/.exec(path);
    if (m) {
      const a = get(decodeURIComponent(m[1]));
      const sub = m[2] || "";
      if (!sub && method === "GET") {
        if (a.summary.legacy) throw new ApiFailure(404, "automation_not_found", "Legacy schedules have no automation definition.");
        return { definition: definitionOf(a), active_revision: a.summary.revision, summary: clone(a.summary) };
      }
      if (!sub && method === "PATCH") return revise(a, body);
      if (sub === "commands" && method === "POST") return applyCommand(a, body);
      if (sub === "occurrences" && method === "GET") return page([...a.occurrences].sort((x, y) => y.index - x.index), url);
      if (sub === "attention" && method === "GET") return page(a.attention.filter((it) => seqOf(it.cursor) > a.seen_seq), url);
      if (sub === "discuss" && method === "POST") {
        const o = a.occurrences.find((x) => x.index === body?.occurrence_index);
        if (!o) throw new ApiFailure(404, "occurrence_not_found", `Automation has no occurrence ${body?.occurrence_index}.`, { field: "occurrence_index" });
        if (typeof body.prompt !== "string" || !body.prompt.trim()) throw new ApiFailure(422, "invalid_request", "prompt is required.", { field: "prompt" });
        const d = { session_id: `discussion-session:${body.request_id}`, run_id: mint(`discuss:${body.request_id}`), session_kind: "discussion" };
        a.discussions.push({ ...d, occurrence_index: o.index, prompt: body.prompt });
        return d;
      }
      if (sub === "seen" && method === "POST") {
        const s = seqOf(body?.attention_cursor);
        const latest = a.attention.reduce((mx, it) => Math.max(mx, seqOf(it.cursor)), seqOf(a.summary.attention.cursor) ?? 0);
        if (s === null || s > latest) throw new ApiFailure(422, "invalid_request", "attention_cursor is beyond the latest attention item.", { field: "attention_cursor" });
        a.seen_seq = Math.max(a.seen_seq, s);
        recomputeAttention(a);
        return { attention_cursor: `att1:${a.seen_seq}` };
      }
    }
    throw new ApiFailure(404, "not_found", `No stub route for ${method} ${path}.`);
  }

  async function handle(req, res) {
    const url = new URL(req.url, "http://stub");
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body;
    let status = 200;
    let out;
    try {
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          throw new ApiFailure(422, "invalid_request", "Request body is not valid JSON.");
        }
      }
      requests.push({ method: req.method, path: url.pathname + url.search, body: body === undefined ? undefined : clone(body) });
      if (options.failNext) {
        const f = options.failNext(req.method, url.pathname, body);
        if (f) throw new ApiFailure(f.status, f.body.detail.reason_code, f.body.detail.message, { ...f.body.detail });
      }
      out = await route(req.method, url, body);
    } catch (e) {
      if (!(e instanceof ApiFailure)) throw e;
      status = e.status;
      out = { detail: e.detail };
    }
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(out));
  }

  return {
    handle,
    requests,
    autos,
    errors,
    fire: (id, spec) => fire(get(id), spec),
    summary: (id) => clone(get(id).summary),
    discussions: (id) => clone(get(id).discussions),
    occurrences: (id) => clone(get(id).occurrences),
  };
}

export async function startAutomationsStub(options = {}) {
  const stub = createAutomationsStub(options);
  const server = createServer((req, res) => {
    stub.handle(req, res).catch((e) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ detail: { reason_code: "stub_error", message: String(e?.stack || e) } }));
    });
  });
  await new Promise((ok) => server.listen(options.port ?? 0, "127.0.0.1", ok));
  const { port } = server.address();
  return {
    ...stub,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((ok) => server.close(() => ok())),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const i = process.argv.indexOf("--port");
  const port = i > 0 ? Number(process.argv[i + 1]) : 18951;
  const stub = await startAutomationsStub({ port });
  console.log(`automations stub on ${stub.url} (fixtures: ${FIXTURES_DIR})`);
}
