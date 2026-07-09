/**
 * The entity memory view: one summoned entity's evolving memory graph.
 *
 * Offline replay and live tail are ONE pipeline (a2a 0005): the state at
 * any scrub position is the pure fold of the envelope prefix, so playback,
 * scrubbing, and live-follow share the same code path. Sources:
 *
 * - the bundled demo life (a real exported keystone-style life),
 * - a dropped .ndjson file (an exported life),
 * - a gateway (`/api/gateway/entities/{name}/replay` + SSE live tail).
 *
 * Everything here is a pure read. There is no write path in this module.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ChatDrawer } from "./chat_drawer";
import { WorkspacePanel } from "./workspace_panel";
import { SideTabs, type SideTab } from "./drawer";
import { EntitiesIndex } from "./entities_index";
import { GraphCanvas, relationDash } from "./graph_canvas";
import { IdentityCardContent } from "./identity_card";
import { Inspector } from "./inspector";
import { LedgerPanel } from "./ledger_panel";
import { Timeline } from "./timeline";
import { foldUpToIndex, type FoldCache } from "./stream_fold";
import { deriveLifeState } from "./entity_state";
import { SubstratePicker, loadSubstrateChoice, saveSubstrateChoice, type SubstrateChoice } from "./substrate_picker";
import { getEntitySubstrate, putEntitySubstrate } from "./stream_source";
import {
  fetchEntityState,
  getLoopStatus,
  getServerLifeState,
  listEntities,
  openLiveTail,
  parseNdjson,
  postEntityState,
  setGatewayToken,
  startLoop,
  stopLoop,
  streamReplay,
  type EntityStateInfo,
  type EntitySummary,
  type LiveTailHandle,
  type LoopStatus,
  type ServerLifeState,
} from "./stream_source";
import type { ReplayEnvelope } from "./stream_types";
import {
  ConnectGatewayModal,
  loadStoredAuth,
  sessionLogout,
  storeAuth,
  type GatewayAuthState,
} from "./connect_gateway_modal";

const DEMO_URL = "/demo/castor.ndjson";
/** Playback baseline: envelopes per second at 1x. */
const BASE_EPS = 2.5;

type SourceKind = "demo" | "file" | "gateway";

export function EntityView(): React.ReactElement {
  const [envelopes, setEnvelopes] = useState<ReplayEnvelope[]>([]);
  const [sourceKind, setSourceKind] = useState<SourceKind>("demo");
  const [sourceLabel, setSourceLabel] = useState("demo life — Castor");
  const [scrubIndex, setScrubIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(5);
  const [live, setLive] = useState(false);
  const [liveStatus, setLiveStatus] = useState<"open" | "reconnecting" | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showQuiet, setShowQuiet] = useState(false);
  const [gatewayUrl, setGatewayUrl] = useState("");
  const [entities, setEntities] = useState<EntitySummary[] | null>(null);
  const [entityName, setEntityName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [showConnect, setShowConnect] = useState(false);

  const tailRef = useRef<LiveTailHandle | null>(null);
  const playRef = useRef<{ acc: number; last: number } | null>(null);
  // Staleness truth for the live badge (adversarial UX review 1.2-1.4):
  // EventSource ignores keep-alive comments by design, so "connected" says
  // nothing — the honest signal is wall time since the last envelope.
  const lastEnvelopeAtRef = useRef<number | null>(null);
  const [liveAgeS, setLiveAgeS] = useState<number | null>(null);
  const [entityState, setEntityState] = useState<EntityStateInfo | null>(null);
  const [searchText, setSearchText] = useState("");
  // The browser's gateway credential (shared sign-in card, 2026-07-08):
  // seeded from storage or ?token=; every read helper sends it (strict-auth
  // gateways refuse anonymous reads). controlToken stays as the derived
  // bearer value for the call sites that pass tokens explicitly.
  const [authState, setAuthState] = useState<GatewayAuthState | null>(() => {
    const stored = loadStoredAuth();
    if (stored?.token) setGatewayToken(stored.token);
    return stored;
  });
  const controlToken = authState?.token ?? "";
  const [showAuth, setShowAuth] = useState(false);
  // LOGIN-FIRST (maintainer ruling 2026-07-09 06:47: "like for flow, it
  // should be the first thing you see if you are not logged in"): a gateway
  // source with no credential opens the sign-in card immediately — the app
  // never renders as a silent read-only shell behind an invisible wall.
  useEffect(() => {
    if (sourceKind === "gateway" && !authState) setShowAuth(true);
  }, [sourceKind, authState]);
  const [controlNote, setControlNote] = useState<string | null>(null);
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [loopStatus, setLoopStatus] = useState<LoopStatus | null>(null);
  const [serverLife, setServerLife] = useState<ServerLifeState | null>(null);
  /** The operator's explicit mind-substrate choice for this entity
   * (2026-07-09 ruling) — sent on chat/open AND loop/start; never a
   * silent default. Persisted per entity. */
  const [substrate, setSubstrate] = useState<SubstrateChoice | null>(null);
  /** Progressive life-load status ("loading his life… 42,000 events") —
   * a 98 MB replay must never look like an empty broken page. */
  const [bootProgress, setBootProgress] = useState<string | null>(null);
  const [loopBusy, setLoopBusy] = useState(false);
  const [participant, setParticipant] = useState(() => localStorage.getItem("abstractobserver_entity_participant") || "");
  /** The multi-entity manager (0010 121500Z): when a gateway answers and
   * no ?entity= is selected, the app is an INDEX of lives, not one life. */
  const [indexBase, setIndexBase] = useState<string | null>(null);
  /** A requested side tab (roster click = "join his room" -> chat, the
   * maintainer's ask 2026-07-09). The nonce bumps every open so SideTabs
   * re-applies even when re-entering the same entity. */
  const [requestedTab, setRequestedTab] = useState<{ tab: string; nonce: number } | null>(null);

  // ------------------------------------------------------------- sources

  const loadEnvelopes = useCallback((next: ReplayEnvelope[], kind: SourceKind, label: string) => {
    next.sort((a, b) => a.seq - b.seq);
    tailRef.current?.close();
    tailRef.current = null;
    setLive(false);
    setLiveStatus(null);
    foldCacheRef.current = null; // a new source is a new life: never extend across it
    setEnvelopes(next);
    setSourceKind(kind);
    setSourceLabel(label);
    setScrubIndex(-1);
    setSelectedId(null);
    setPlaying(next.length > 0);
    setError(null);
  }, []);

  const startTail = useCallback((base: string, name: string, cursor: number) => {
    tailRef.current?.close();
    setPlaying(false);
    setLive(true);
    lastEnvelopeAtRef.current = Date.now();
    tailRef.current = openLiveTail(
      base,
      name,
      cursor,
      (env) => {
        lastEnvelopeAtRef.current = Date.now();
        setEnvelopes((prev) => {
          // Seq-keyed merge (adversarial realtime review, 2026-07-08): the
          // old "drop anything ≤ last" dedup silently ate LEGITIMATE
          // retrograde arrivals — host markers anchor to a journal base
          // the tail may already have passed. Append fast-path; true
          // duplicates drop; retrogrades insert in seq order.
          const last = prev.length > 0 ? prev[prev.length - 1].seq : -Infinity;
          if (env.seq > last) {
            const next = [...prev, env];
            setScrubIndex(next.length - 1);
            return next;
          }
          // Binary search for the insert position among the (sorted) prefix.
          let lo = 0;
          let hi = prev.length;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (prev[mid].seq < env.seq) lo = mid + 1;
            else hi = mid;
          }
          if (prev[lo]?.seq === env.seq) return prev; // reconnect duplicate
          const next = [...prev.slice(0, lo), env, ...prev.slice(lo)];
          setScrubIndex(next.length - 1);
          return next;
        });
      },
      (status) => setLiveStatus(status),
    );
  }, []);

  useEffect(() => {
    if (!live) {
      setLiveAgeS(null);
      return;
    }
    const tick = () => {
      const at = lastEnvelopeAtRef.current;
      setLiveAgeS(at !== null ? Math.round((Date.now() - at) / 1000) : null);
    };
    tick();
    const interval = window.setInterval(tick, 5000);
    return () => window.clearInterval(interval);
  }, [live]);

  useEffect(() => {
    // ONE substrate per entity, GATEWAY-OWNED (maintainer ruling 2026-07-09
    // 06:32: visits and own time share the same mind — and the UI must SHOW
    // the stored choice, not present an empty picker). The gateway's
    // substrate endpoint is the source of truth; per-entity localStorage is
    // only a seed for older gateways without the endpoint (#FALLBACK).
    if (!entityName) {
      setSubstrate(null);
      return;
    }
    let cancelled = false;
    const base = gatewayUrl.trim().replace(/\/+$/, "");
    getEntitySubstrate(base, entityName)
      .then((stored) => {
        if (cancelled) return;
        if (stored && stored.provider && stored.model) {
          setSubstrate({ provider: stored.provider, model: stored.model });
        } else {
          setSubstrate(loadSubstrateChoice(entityName)); // legacy seed; saving writes back to the gateway
        }
      })
      .catch(() => {
        if (!cancelled) setSubstrate(loadSubstrateChoice(entityName));
      });
    return () => {
      cancelled = true;
    };
  }, [entityName, gatewayUrl]);

  useEffect(() => {
    // The lifecycle badge (asleep/awake/paused — gateway 0008 surface).
    // Pure read on a slow poll; older gateways without the endpoint just
    // leave the badge off.
    if (sourceKind !== "gateway" || !entityName) {
      setEntityState(null);
      return;
    }
    const base = gatewayUrl.trim().replace(/\/+$/, "");
    let cancelled = false;
    const poll = () => {
      fetchEntityState(base, entityName)
        .then((s) => !cancelled && setEntityState(s))
        .catch(() => !cancelled && setEntityState(null));
    };
    poll();
    const interval = window.setInterval(poll, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [sourceKind, entityName, gatewayUrl]);

  useEffect(() => {
    // Boot sources, by precedence:
    //   ?gateway=<base>&entity=<slug>[&live=0]  open a served home directly
    //   ?src=<url>                              load any exported stream
    //   (default)                               the bundled demo life
    const params = new URLSearchParams(window.location.search);
    const entityParam = (params.get("entity") || "").trim();
    const gatewayParam = (params.get("gateway") || "").trim().replace(/\/+$/, "");
    // LIVE IS THE DEFAULT for a served home (maintainer, 2026-07-09: first
    // launch must land on his present, not replay the archive from seq 0).
    // ?live=0 opts into replay-from-the-start for archive study; the
    // timeline scrub leaves live mode at any moment either way.
    const wantReplay = ["0", "false", "no", "replay"].includes((params.get("live") || "").trim().toLowerCase());
    // NO ?token= seeding (maintainer ruling 2026-07-09, screenshot in hand:
    // auth must be EXACTLY AbstractFlow's — gateway sign-in -> session
    // cookies -> the app's own /api proxy). The connect modal is the ONLY
    // auth door; a credential in a URL leaks into history/screenshots and
    // was explicitly rejected. Stale ?token= params are ignored (and
    // scrubbed from pushed URLs below).
    if (entityParam) {
      setGatewayUrl(gatewayParam);
      setEntityName(entityParam);
      setIndexBase(gatewayParam); // back-navigation home exists
      // A long life is a BIG stream (castor: ~98 MB / 67k events) — load it
      // progressively so the graph fills as it arrives instead of looking
      // empty/broken for the whole fetch (maintainer, 2026-07-09 04:32:
      // "this is not castor").
      loadEnvelopes([], "gateway", `${entityParam} @ ${gatewayParam || "this gateway"}`);
      setBootProgress("loading his life…");
      streamReplay(gatewayParam, entityParam, 0, (all, bytes) => {
        setEnvelopes([...all]);
        setScrubIndex(all.length - 1);
        setBootProgress(`loading his life… ${all.length.toLocaleString()} events${bytes > 0 ? ` · ${(bytes / 1048576).toFixed(0)} MB` : ""}`);
      })
        .then((history) => {
          setBootProgress(null);
          if (!wantReplay) {
            // An empty history (a just-created life) still tails from 0 so
            // its first moments stream in without a reload.
            startTail(gatewayParam, entityParam, history.length > 0 ? history[history.length - 1].seq : 0);
          } else {
            setScrubIndex(-1);
            setPlaying(history.length > 0);
          }
        })
        .catch((e) => {
          setBootProgress(null);
          setError(`Could not open ${entityParam}: ${String((e as Error).message || e)}`);
        });
      return () => tailRef.current?.close();
    }
    const srcParam = params.get("src");
    if (!srcParam) {
      // No entity, no file: if a gateway answers (same-origin behind the
      // Observer proxy, or ?gateway=), the app IS the entities index
      // (0010 121500Z). The demo stays the fallback for standalone use.
      listEntities(gatewayParam)
        .then(() => {
          setGatewayUrl(gatewayParam);
          setSourceKind("gateway");
          setSourceLabel(`entities @ ${gatewayParam || "this gateway"}`);
          setIndexBase(gatewayParam);
        })
        .catch(() => {
          loadDemoOrSrc(null);
        });
      return () => tailRef.current?.close();
    }
    loadDemoOrSrc(srcParam);
    function loadDemoOrSrc(src: string | null) {
      const url = src && src.trim() ? src.trim() : DEMO_URL;
      const label = src ? url.split("/").pop() || url : "demo life — Castor";
      fetch(url)
        .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((text) => {
          const { envelopes: parsed, errors } = parseNdjson(text);
          if (errors.length) console.warn("#FALLBACK: NDJSON parse errors", errors.slice(0, 3));
          if (parsed.length === 0) {
            setError(`No stream envelopes at ${url}.`);
            return;
          }
          loadEnvelopes(parsed, src ? "file" : "demo", label);
        })
        .catch(() =>
          setError(
            src
              ? `Could not load ${url}. Drop an exported .ndjson life, or connect a gateway.`
              : "Demo data not found. Drop an exported .ndjson life, or connect a gateway.",
          ),
        );
    }
    return () => tailRef.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDrop = useCallback(
    (ev: React.DragEvent) => {
      ev.preventDefault();
      const file = ev.dataTransfer.files?.[0];
      if (!file) return;
      file.text().then((text) => {
        const { envelopes: parsed, errors } = parseNdjson(text);
        if (parsed.length === 0) {
          setError(`No stream envelopes in ${file.name}${errors.length ? ` (${errors.length} bad lines)` : ""}.`);
          return;
        }
        loadEnvelopes(parsed, "file", file.name);
      });
    },
    [loadEnvelopes],
  );

  const connectGateway = useCallback(async () => {
    setError(null);
    try {
      const base = gatewayUrl.trim().replace(/\/+$/, "");
      const list = await listEntities(base);
      setEntities(list);
      if (list.length === 0) setError("The gateway has no entity homes yet.");
    } catch (e) {
      setError(`Gateway list failed: ${String((e as Error).message || e)}`);
    }
  }, [gatewayUrl]);

  // ------------------------------------------------------- gateway auth
  const disconnectGateway = useCallback(async () => {
    if (authState?.mode === "session") {
      await sessionLogout(gatewayUrl.trim().replace(/\/+$/, "") || window.location.origin);
    }
    setGatewayToken(null);
    storeAuth(null);
    try {
      localStorage.removeItem("abstractobserver_entity_token"); // legacy key
    } catch {
      // best-effort
    }
    setAuthState(null);
    setControlNote("Disconnected — this browser holds no gateway credential.");
  }, [authState, gatewayUrl]);

  // ------------------------------------------------------------ own time
  useEffect(() => {
    if (sourceKind !== "gateway" || !entityName) {
      setLoopStatus(null);
      setServerLife(null);
      return;
    }
    let cancelled = false;
    const base = gatewayUrl.trim().replace(/\/+$/, "");
    const poll = () => {
      getLoopStatus(base, entityName)
        .then((s) => !cancelled && setLoopStatus(s))
        .catch(() => !cancelled && setLoopStatus(null));
      // The composite phase, computed gateway-side (commons seq 96): ONE
      // mutually-exclusive answer. Null (endpoint absent on an older
      // gateway) drops us to the client-derived trio — the #FALLBACK path.
      getServerLifeState(base, entityName)
        .then((s) => !cancelled && setServerLife(s))
        .catch(() => !cancelled && setServerLife(null));
    };
    poll();
    const interval = window.setInterval(poll, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [sourceKind, entityName, gatewayUrl, authState]);

  /** ONE derived life-state (maintainer, 2026-07-09 02:02): the entity is
   * in exactly one of visiting/working/sleeping/own-time/…, and visiting
   * suppresses own-time and sleeping. The gateway's `/life_state` is the
   * authority when present; `entityState.mode` + loop status carry the
   * client-side fallback for older gateways. */
  const life = useMemo(() => deriveLifeState(entityState, loopStatus, null, serverLife), [entityState, loopStatus, serverLife]);
  const ownTimeActive = life.ownTimeActive;

  const toggleLoop = useCallback(async () => {
    if (sourceKind !== "gateway" || !entityName || loopBusy) return;
    const base = gatewayUrl.trim().replace(/\/+$/, "");
    const token = controlToken.trim() || null;
    setLoopBusy(true);
    setControlNote(null);
    // The pressed state is the message (maintainer: "it's useless to show
    // the text") — success paths stay silent; only refusals speak.
    const reconcile = () => {
      // The child writes its status file moments after spawn: converge the
      // button to TRUTH shortly after the optimistic flip.
      [1500, 5000].forEach((ms) =>
        window.setTimeout(() => {
          getLoopStatus(base, entityName)
            .then(setLoopStatus)
            .catch(() => undefined);
        }, ms),
      );
    };
    try {
      if (loopStatus?.running && entityState?.state === "paused") {
        // The loop lives but his time is gated: resuming is an unpause,
        // not a second loop.
        const s = await postEntityState(base, entityName, "awake", "operator resumed his own time (web toggle)", token);
        setEntityState(s);
      } else if (loopStatus?.running) {
        const r = await stopLoop(base, entityName, token);
        setLoopStatus(r.status ? { ...r.status, stop_requested: true } : { phase: "day", running: true, stop_requested: true });
        reconcile();
      } else {
        // ONE substrate per entity (2026-07-09 06:32): the gateway resolves
        // the entity's persisted choice — the loop never asks separately.
        // No choice anywhere -> the gateway's refusal names the fix.
        if (entityState?.state === "paused" || entityState?.state === "asleep") {
          // Starting his own time IS the wake intent (adversarial finding:
          // an asleep entity's loop runs but the mind idles — zero ticks,
          // a pressed button over silence). One click = alive.
          const s = await postEntityState(base, entityName, "awake", "operator started his own time (web toggle)", token);
          setEntityState(s);
        }
        const r = await startLoop(base, entityName, token, {});
        // started:true is now HONEST (the spawn survived its first
        // moment) — press the button immediately, verify shortly.
        if (r.started) {
          setLoopStatus(r.status?.running ? r.status : { phase: r.status?.phase || "day", running: true });
        } else {
          setLoopStatus(r.status ?? null);
        }
        reconcile();
      }
    } catch (e) {
      const err = e as Error & { status?: number };
      setControlNote(
        err.status === 401 || err.status === 403
          ? "The door refused: sign in first (🔑 connect)."
          : `Own-time request refused: ${err.message}`,
      );
      reconcile();
    } finally {
      setLoopBusy(false);
    }
  }, [sourceKind, entityName, gatewayUrl, loopBusy, loopStatus, entityState, controlToken, substrate]);

  const openEntity = useCallback(
    async (name: string, opts: { pushUrl?: boolean; joinRoom?: boolean } = {}) => {
      setError(null);
      try {
        const base = gatewayUrl.trim().replace(/\/+$/, "");
        setEntityName(name);
        loadEnvelopes([], "gateway", `${name} @ ${base || "this gateway"}`);
        setShowConnect(false);
        setBootProgress("loading his life…");
        const history = await streamReplay(base, name, 0, (all, bytes) => {
          setEnvelopes([...all]);
          setScrubIndex(all.length - 1);
          setBootProgress(`loading his life… ${all.length.toLocaleString()} events${bytes > 0 ? ` · ${(bytes / 1048576).toFixed(0)} MB` : ""}`);
        });
        setBootProgress(null);
        // "When I click on the entity, I should join its room" (maintainer,
        // 2026-07-09): land in the chat drawer, ready to talk. Distinct
        // object identity each time so SideTabs re-applies even for the
        // same slug reopened.
        if (opts.joinRoom !== false) setRequestedTab({ tab: "chat", nonce: Date.now() });
        // Deep links stay shareable (0010 121500Z item 3): the URL tracks
        // the selection. The token never rides a pushed URL.
        if (opts.pushUrl !== false) {
          const url = new URLSearchParams(window.location.search);
          url.set("entity", name);
          url.delete("token");
          window.history.pushState({ entity: name }, "", `${window.location.pathname}?${url.toString()}`);
        }
        // Opening a live home follows its present by default — the index
        // click means "watch him now", not "study the archive". An empty
        // history (a just-created life) still tails from 0 so its first
        // moments stream in without a reload.
        if (history.length > 0) setScrubIndex(history.length - 1);
        startTail(base, name, history.length > 0 ? history[history.length - 1].seq : 0);
      } catch (e) {
        setBootProgress(null);
        setError(`Replay read failed: ${String((e as Error).message || e)}`);
      }
    },
    [gatewayUrl, loadEnvelopes, startTail],
  );

  /** Back to the entities index (the manager home). */
  const goToIndex = useCallback(
    (opts: { pushUrl?: boolean } = {}) => {
      tailRef.current?.close();
      tailRef.current = null;
      setLive(false);
      setLiveStatus(null);
      setPlaying(false);
      setEntityName("");
      setEnvelopes([]);
      setScrubIndex(-1);
      setSelectedId(null);
      setEntityState(null);
      setLoopStatus(null);
      setSourceKind("gateway");
      setSourceLabel(`entities @ ${gatewayUrl.trim() || "this gateway"}`);
      setIndexBase(gatewayUrl.trim().replace(/\/+$/, ""));
      if (opts.pushUrl !== false) {
        const url = new URLSearchParams(window.location.search);
        url.delete("entity");
        url.delete("live");
        url.delete("token");
        const qs = url.toString();
        window.history.pushState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
      }
    },
    [gatewayUrl],
  );

  useEffect(() => {
    // Back/forward honor the URL: ?entity= selects, absence is the index.
    const onPop = () => {
      const params = new URLSearchParams(window.location.search);
      const entityParam = (params.get("entity") || "").trim();
      if (entityParam) {
        void openEntity(entityParam, { pushUrl: false });
      } else if (indexBase !== null) {
        goToIndex({ pushUrl: false });
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [openEntity, goToIndex, indexBase]);

  // ------------------------------------------------------------- live tail

  const toggleLive = useCallback(() => {
    if (live) {
      tailRef.current?.close();
      tailRef.current = null;
      setLive(false);
      setLiveStatus(null);
      return;
    }
    if (sourceKind !== "gateway" || !entityName) return;
    const base = gatewayUrl.trim().replace(/\/+$/, "");
    setScrubIndex(envelopes.length - 1);
    const cursor = envelopes.length > 0 ? envelopes[envelopes.length - 1].seq : 0;
    startTail(base, entityName, cursor);
  }, [live, sourceKind, entityName, gatewayUrl, envelopes, startTail]);

  // ------------------------------------------------------------- playback

  useEffect(() => {
    if (!playing || live) return;
    let raf = 0;
    playRef.current = { acc: 0, last: performance.now() };
    const step = (now: number) => {
      const play = playRef.current;
      if (!play) return;
      play.acc += ((now - play.last) / 1000) * BASE_EPS * speed;
      play.last = now;
      const advance = Math.floor(play.acc);
      if (advance > 0) {
        play.acc -= advance;
        setScrubIndex((i) => {
          const next = Math.min(envelopes.length - 1, i + advance);
          if (next >= envelopes.length - 1) setPlaying(false);
          return next;
        });
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, live, speed, envelopes.length]);

  // ------------------------------------------------------------- the fold

  const effectiveIndex = live ? envelopes.length - 1 : scrubIndex;
  const scrubSeq = effectiveIndex >= 0 && envelopes[effectiveIndex] ? envelopes[effectiveIndex].seq : 0;

  const foldCacheRef = useRef<FoldCache | null>(null);
  const fold = useMemo(() => {
    // State at T = fold of the prefix at T (truthful by construction).
    // Incremental: forward head moves apply only the delta; the shallow
    // wrapper changes identity so downstream memos recompute.
    foldCacheRef.current = foldUpToIndex(envelopes, effectiveIndex, foldCacheRef.current);
    return { ...foldCacheRef.current.state };
  }, [envelopes, effectiveIndex]);

  const stats = useMemo(() => {
    let edgeUses = 0;
    for (const e of fold.edges.values()) edgeUses += e.count;
    const summons = fold.sessions.filter((s) => s.kind === "summon").length;
    return {
      nodes: fold.nodes.size,
      edges: fold.edges.size,
      edgeUses,
      // Home-direct lives write no host markers; run_id changes are the
      // honest session boundaries there ("0 summons" was misleading).
      sessions: Math.max(summons, fold.inferred_sessions.length),
    };
  }, [fold]);

  // Relation types present in the fold, most common first, for the legend
  // (dash pattern = type; color stays reserved for activation/usage).
  const relationTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const se of fold.structural_edges.values()) {
      counts.set(se.relation, (counts.get(se.relation) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([relation]) => relation);
  }, [fold]);

  // Search ("a poor and quick version of active reconstruction"): match
  // title, kind, and ids over nodes AND standing targets; matches
  // emphasize on the canvas, everything else dims.
  const searchIds = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return null;
    const terms = q.split(/\s+/).filter(Boolean);
    const matches = new Set<string>();
    const hit = (hay: string) => terms.every((t) => hay.includes(t));
    for (const node of fold.nodes.values()) {
      const hay = `${node.title} ${node.kind} ${node.id} ${node.graph_id ?? ""}`.toLowerCase();
      if (hit(hay)) matches.add(node.id);
    }
    for (const s of fold.standings.values()) {
      if (hit(s.target_id.toLowerCase())) matches.add(`standing:${s.target_id}`);
    }
    return matches;
  }, [fold, searchText]);

  const sendState = useCallback(
    (target: "awake" | "asleep" | "paused") => {
      if (sourceKind !== "gateway" || !entityName) return;
      // No ceremony (maintainer ruling 2026-07-08): the act stays visible
      // — the transition lands as a host marker with this reason attached.
      const reason = "by the operator (web controls)";
      const base = gatewayUrl.trim().replace(/\/+$/, "");
      const verb = target === "awake" ? "wake" : target === "asleep" ? "sleep" : "pause";
      postEntityState(base, entityName, target, reason, controlToken.trim() || null)
        .then((s) => {
          setEntityState(s);
          setControlNote(`${verb} accepted by the door`);
          window.setTimeout(() => setControlNote(null), 6000);
        })
        .catch((e: Error & { status?: number }) => {
          setControlNote(
            e.status === 401 || e.status === 403
              ? "The door refused: operator auth required (set a token in the control panel)."
              : `The door refused: ${e.message}`,
          );
          window.setTimeout(() => setControlNote(null), 10000);
        });
    },
    [sourceKind, entityName, gatewayUrl, controlToken],
  );

  return (
    <div className="entity_app" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="entity_header">
        <div className="eh_brand">
          <span className="eh_dot" />
          <h1>Entity Memory</h1>
          <span className="eh_source" title={sourceLabel}>
            {sourceLabel}
          </span>
          {/* ONE state chip (maintainer 2026-07-09): never two contradictory
            * badges. deriveLifeState collapses chat/state/loop into a single
            * mutually-exclusive phase (visiting suppresses own-time+sleep). */}
          {entityState || loopStatus ? (
            <span className={`eh_state eh_life_${life.accent}`} title={entityState?.reason ? `${life.detail} — ${entityState.reason}` : life.detail}>
              {life.label}
            </span>
          ) : null}
          {liveStatus === "reconnecting" ? <span className="eh_reconnect">reconnecting…</span> : null}
          {bootProgress ? <span className="eh_bootprogress">{bootProgress}</span> : null}
          {live && liveAgeS !== null ? (
            <span
              className={`eh_liveage ${liveAgeS > 300 ? "eh_liveage_quiet" : ""}`}
              title="Wall time since the last envelope arrived. A resting entity is quiet — quiet is not dead, but past 5 minutes it is worth a look."
            >
              {liveAgeS < 60 ? `${liveAgeS}s` : `${Math.floor(liveAgeS / 60)}m`} since last event
            </span>
          ) : null}
        </div>
        <div className="eh_stats">
          <input
            type="search"
            className="eh_search"
            placeholder="search memories…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSearchText("");
            }}
            title="Match on title, kind, and ids — matches light up on the graph, the rest dims. Escape clears."
          />
          {searchIds !== null ? <span className="eh_search_count">{searchIds.size} match{searchIds.size === 1 ? "" : "es"}</span> : null}
          <span>{stats.nodes} memories</span>
          <span title="formation-time links / co-use trails">
            {fold.structural_edges.size} linked · {stats.edges} co-used
          </span>
          <span>{stats.sessions} sessions</span>
          {indexBase !== null && entityName ? (
            <button className="eh_connect" onClick={() => goToIndex()} title="All entities — back to the manager index">
              ⌂
            </button>
          ) : null}
          <button className="eh_connect" onClick={() => setShowConnect((v) => !v)} title="Connect to a gateway (source selection)">
            {showConnect ? "✕" : "⚙"}
          </button>
        </div>
      </header>

      {sourceKind === "gateway" && entityName ? (
        <div className="entity_controls">
          {/* Maintainer ruling (2026-07-08 00:59): no pre-gating. The
            * buttons are always live; if the gateway refuses, its actual
            * answer renders here. The token field stays for deployments
            * that need it, but never blocks the operator. */}
          <span className="ec_label" title="State transitions go through the gateway and land as visible host markers in the stream.">
            🎛 controls
          </span>
          {/* Sleep + own-time are one MUTUALLY-EXCLUSIVE state machine
            * (maintainer 2026-07-09): during a visit BOTH are disabled and
            * unpressed (a visit suppresses them); pressed state comes from
            * the single derived life-state, never from raw fields. */}
          <button
            className={`ec_btn ec_toggle ${life.sleeping ? "ec_sleep_on" : ""}`}
            aria-pressed={life.sleeping}
            disabled={life.visiting}
            onClick={() => sendState(life.sleeping ? "awake" : "asleep")}
            title={
              life.visiting
                ? "He is in a visit — he cannot sleep while a visitor is in the room"
                : life.sleeping
                  ? life.phase === "dreaming"
                    ? "Dreaming (consolidation in this window) — click to wake him"
                    : entityState?.written_by === "self"
                      ? "Sleeping by his own choice — click to wake him"
                      : "Asleep (operator) — click to wake him"
                  : "Awake — click to put him to sleep (rest / consolidation)"
            }
          >
            🌙 sleep
          </button>
          <button
            className="ec_btn"
            onClick={() => setShowWorkspace(true)}
            title="His workspace: browse files, grant/remove extra workspaces (read-only or read+write), set per-phase tools"
          >
            📁 workspace
          </button>
          <button
            className={`ec_btn ec_toggle ${ownTimeActive ? "ec_toggle_on" : ""} ${loopStatus?.running && loopStatus.stop_requested ? "ec_toggle_stopping" : ""}`}
            aria-pressed={ownTimeActive}
            disabled={loopBusy || life.visiting}
            onClick={() => void toggleLoop()}
            title={
              life.visiting
                ? "He is in a visit — his own time is yielded; it cannot tick while a visitor is in the room"
                : life.phase === "paused"
                  ? "His time is GATED (paused) — click to resume"
                  : loopStatus?.running && loopStatus.stop_requested
                    ? "Stopping — his running thought completes, then his own time ends"
                    : life.sleeping
                      ? "He is resting — waking him and starting his own time"
                      : ownTimeActive
                        ? "Living a day by himself — click to stop at the next tick boundary"
                        : "Not living by himself right now — click to start his own time (the self-prompted tick loop)"
            }
          >
            ⏻ own time
          </button>
          {/* THE substrate control — one per entity, gateway-persisted
            * (maintainer ruling 2026-07-09 06:32: visits and own time share
            * the same mind; no per-mode pickers). Changing it PUTs to the
            * gateway; every door resolves the stored choice. */}
          <span className="ec_substrate" title="The one provider + model carrying his mind — visits and own time both resolve this stored choice">
            🧠
            <SubstratePicker
              baseUrl={gatewayUrl.trim().replace(/\/+$/, "")}
              entity={entityName}
              value={substrate}
              onChange={(choice) => {
                setSubstrate(choice);
                saveSubstrateChoice(entityName, choice); // legacy seed for older gateways
                if (choice?.provider && choice?.model) {
                  const base = gatewayUrl.trim().replace(/\/+$/, "");
                  putEntitySubstrate(base, entityName, controlToken.trim() || null, choice).catch((e: Error) =>
                    setControlNote(`Could not persist his substrate on the gateway: ${e.message}`),
                  );
                }
              }}
              compact
            />
          </span>
          {authState ? (
            <>
              <span className="ec_authchip" title={authState.mode === "session" ? "HTTP-only browser session" : "Bearer token held by this browser"}>
                ⚡ {authState.userId} ({authState.mode})
              </span>
              <button className="ec_btn" onClick={() => void disconnectGateway()} title="Forget the credential in this browser (and end the session where one exists)">
                ⏏ disconnect
              </button>
            </>
          ) : (
            <button className="ec_btn" onClick={() => setShowAuth(true)} title="Sign in with a Gateway user token (shared connect card)">
              🔑 connect
            </button>
          )}
          {loopStatus?.inbox_warning ? (
            <span className="ec_note ec_warn" title="The loop's command inbox could not be read — stop requests may not land until this clears.">
              {loopStatus.inbox_warning}
            </span>
          ) : null}
          {!loopStatus?.running && loopStatus?.stopped_by === "failures" ? (
            <span className="ec_note ec_warn" title="Three consecutive ticks failed (usually LLM timeouts under load) and the loop stopped itself. His memory is intact — restart his own time when the substrate is healthy.">
              his own time stopped after repeated tick failures — restart when ready
            </span>
          ) : null}
          {controlNote ? <span className="ec_note">{controlNote}</span> : null}
        </div>
      ) : null}

      {showConnect ? (
        <div className="entity_connect">
          <input
            type="text"
            placeholder="Gateway URL (empty = this origin, e.g. behind the Observer proxy)"
            value={gatewayUrl}
            onChange={(e) => setGatewayUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void connectGateway()}
          />
          <button onClick={() => void connectGateway()}>List entities</button>
          {entities?.map((e) => (
            <button key={e.slug} className="ec_entity" onClick={() => void openEntity(e.slug)}>
              {e.name || e.slug}
            </button>
          ))}
          <span className="ec_hint">…or drop an exported .ndjson life anywhere.</span>
        </div>
      ) : null}

      {error ? <div className="entity_error">{error}</div> : null}

      {indexBase !== null && !entityName ? (
        <EntitiesIndex
          key={authState ? `authed:${authState.userId}` : "anon"}
          baseUrl={indexBase}
          token={controlToken.trim() || null}
          onOpen={(slug) => void openEntity(slug)}
          onConnect={() => setShowAuth(true)}
        />
      ) : null}

      {showAuth ? (
        <ConnectGatewayModal
          baseUrl={gatewayUrl}
          onBaseUrlChange={setGatewayUrl}
          onConnected={(state) => {
            if (state.token) setGatewayToken(state.token);
            setAuthState(state);
            setShowAuth(false);
            setControlNote(`Connected as ${state.userId} (${state.mode}).`);
          }}
          onClose={() => setShowAuth(false)}
        />
      ) : null}

      {showWorkspace && sourceKind === "gateway" && entityName ? (
        <WorkspacePanel
          baseUrl={gatewayUrl.trim().replace(/\/+$/, "")}
          entity={entityName}
          entityName={entityName}
          token={controlToken.trim() || null}
          onClose={() => setShowWorkspace(false)}
        />
      ) : null}

      <div className="entity_main" style={indexBase !== null && !entityName ? { display: "none" } : undefined}>
        <div className="entity_canvas_wrap">
          <GraphCanvas
            fold={fold}
            scrubSeq={scrubSeq}
            selectedId={selectedId}
            searchIds={searchIds}
            layoutKey={sourceKind === "gateway" && entityName ? entityName : sourceLabel || null}
            onSelect={setSelectedId}
          />
          <div className="entity_legend">
            <span className="lg lg_identity">identity</span>
            <span className="lg lg_memory">memory</span>
            <span className="lg lg_diary">diary</span>
            <span className="lg lg_standing">feeling</span>
            <span className="lg lg_scar">scar</span>
            <span className="lg lg_bond">bond</span>
            <span className="lg_sep" />
            <span className="lg_edge" title="usage trail — how often two memories served one moment together; brightens when recently traveled">
              <svg width="26" height="6" aria-hidden="true">
                <line x1="0" y1="3" x2="26" y2="3" stroke="#e8a54a" strokeWidth="1.8" />
              </svg>
              used together
            </span>
            {relationTypes.map((relation) => (
              <span key={relation} className="lg_edge" title={`“${relation}” link — recorded at formation (born linked)`}>
                <svg width="26" height="6" aria-hidden="true">
                  <line x1="0" y1="3" x2="26" y2="3" stroke="#94a8c2" strokeWidth="1.4" strokeDasharray={relationDash(relation).join(" ")} />
                </svg>
                {relation}
              </span>
            ))}
          </div>
        </div>
        <SideTabs
          defaultTab="ledger"
          activeTab={requestedTab ? `${requestedTab.tab}#${requestedTab.nonce}` : undefined}
          tabs={[
            ...(sourceKind === "gateway" && entityName
              ? ([
                  {
                    id: "chat",
                    icon: "💬",
                    title: "Chat",
                    hint: entityState?.mode === "visiting",
                    content: (
                      <ChatDrawer
                        baseUrl={gatewayUrl.trim().replace(/\/+$/, "")}
                        entity={entityName}
                        entityName={entityName.charAt(0).toUpperCase() + entityName.slice(1)}
                        token={controlToken.trim() || null}
                        envelopes={envelopes}
                        participant={participant}
                        onParticipantChange={(v) => {
                          setParticipant(v);
                          try {
                            localStorage.setItem("abstractobserver_entity_participant", v);
                          } catch {
                            // best-effort
                          }
                        }}
                      />
                    ),
                  },
                  {
                    id: "card",
                    icon: "🪪",
                    title: "Card",
                    content: <IdentityCardContent baseUrl={gatewayUrl.trim().replace(/\/+$/, "")} entity={entityName} fold={fold} />,
                  },
                ] as SideTab[])
              : []),
            {
              id: "detail",
              icon: "🔍",
              title: "Detail",
              content: (
                <Inspector
                  fold={fold}
                  scrubSeq={scrubSeq}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  verbatimSource={
                    sourceKind === "gateway" && entityName
                      ? { baseUrl: gatewayUrl.trim().replace(/\/+$/, ""), entity: entityName }
                      : null
                  }
                />
              ),
            },
            {
              id: "ledger",
              icon: "📜",
              title: "Ledger",
              content: (
                <div className="st_ledger_wrap">
                  <label className="el_quiet_toggle st_ledger_toggle">
                    <input type="checkbox" checked={showQuiet} onChange={() => setShowQuiet((v) => !v)} />
                    audit lines
                  </label>
                  <LedgerPanel
                    envelopes={envelopes}
                    scrubIndex={effectiveIndex}
                    onJump={(i) => {
                      setPlaying(false);
                      if (!live) setScrubIndex(i);
                    }}
                    onSelectSubject={setSelectedId}
                    showQuiet={showQuiet}
                    onToggleQuiet={() => setShowQuiet((v) => !v)}
                    loadingNote={bootProgress}
                  />
                </div>
              ),
            },
          ]}
        />
      </div>

      {indexBase !== null && !entityName ? null : (
        <Timeline
          envelopes={envelopes}
          scrubIndex={effectiveIndex}
          playing={playing}
          speed={speed}
          live={live}
          liveAvailable={sourceKind === "gateway" && Boolean(entityName)}
          inferredSessionSeqs={fold.inferred_sessions.map((s) => s.first_seq)}
          onScrub={(i) => {
            setPlaying(false);
            setScrubIndex(i);
          }}
          onTogglePlay={() => setPlaying((v) => !v)}
          onSpeed={setSpeed}
          onToggleLive={toggleLive}
        />
      )}
    </div>
  );
}
