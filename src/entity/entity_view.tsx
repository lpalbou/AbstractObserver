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
import { FleetView } from "./fleet_view";
import { MeetReader } from "./meet_reader";
import { GraphCanvas, relationDash } from "./graph_canvas";
import { IdentityCardContent } from "./identity_card";
import { Inspector } from "./inspector";
import { LedgerPanel } from "./ledger_panel";
import { Timeline } from "./timeline";
import { foldUpToIndex, type FoldCache } from "./stream_fold";
import { computeTemporalActivation } from "./temporal_activation";
import { deriveLifeState } from "./entity_state";
import { SubstratePicker, loadSubstrateChoice, saveSubstrateChoice, type SubstrateChoice } from "./substrate_picker";
import { getEntitySubstrate, putEntitySubstrate } from "./stream_source";
import {
  classifyOperatorAuth,
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
  type LiveTailHandle,
  type LoopStatus,
  type ServerLifeState,
} from "./stream_source";
import type { ReplayEnvelope } from "./stream_types";
import {
  ConnectGatewayModal,
  loadStoredAuth,
  storeAuth,
  type GatewayAuthState,
} from "./connect_gateway_modal";
import { proxyConnectionLogout, proxyConnectionStatus, sameGatewayTarget } from "./gateway_session";

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
  /** Live view of the resolved base for deferred work (the auth check may
   * CONVERGE a ?gateway= deep link onto the page-origin proxy after the
   * boot effect captured the param — a stale closure would dial the old
   * base and 401). */
  const gatewayUrlRef = useRef("");
  gatewayUrlRef.current = gatewayUrl;
  const [entityName, setEntityName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const tailRef = useRef<LiveTailHandle | null>(null);
  const playRef = useRef<{ acc: number; last: number } | null>(null);
  // Staleness truth for the live badge (adversarial UX review 1.2-1.4):
  // EventSource ignores keep-alive comments by design, so "connected" says
  // nothing — the honest signal is wall time since the last envelope.
  const lastEnvelopeAtRef = useRef<number | null>(null);
  const [liveAgeS, setLiveAgeS] = useState<number | null>(null);
  const [entityState, setEntityState] = useState<EntityStateInfo | null>(null);
  /** GW-F handle (`castor@<address>`) — display-only reachability. */
  const [handle, setHandle] = useState<string | null>(null);
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
  // VERIFIED auth (maintainer ruling 2026-07-10 20:56, CRITICAL): a stored
  // credential is a CLAIM, not proof — the gateway must confirm it accepts
  // this browser before ANY entity content renders or streams. Without
  // this, the gateway's dev-read posture (or a stale session cookie the
  // door rejects for writes) leaked the graph/ledger behind the sign-in
  // modal. `authVerified` gates all gateway reads/renders; it flips true
  // ONLY on a confirming probe (boot re-verify) or a fresh successful
  // sign-in (the modal probed/logged-in), and false on disconnect/refusal.
  const [authVerified, setAuthVerified] = useState(false);
  const authVerifiedRef = useRef(false);
  authVerifiedRef.current = authVerified;
  /** PROXY posture (the abstractflow shape, maintainer 2026-07-10 22:5x):
   * the page origin serves /api/connection/gateway — sign in ONCE through
   * it, first-party cookies carry the session, refresh re-verifies
   * silently. null = still detecting. When false, the DIRECT posture
   * applies (cross-origin bearer, base-bound credential). */
  const [proxyMode, setProxyMode] = useState<boolean | null>(null);
  const proxyModeRef = useRef<boolean | null>(null);
  proxyModeRef.current = proxyMode;
  /** A silent verification is in flight — the sign-in card must NOT open
   * during it (audit V4: the modal flashed on every refresh even when the
   * stored credential was about to verify). */
  const [authChecking, setAuthChecking] = useState(true);
  /** A life-stream kickoff deferred until auth verifies (so an unverified
   * browser never fetches a life). Drained by the auth effect. */
  const pendingStreamRef = useRef<null | (() => void)>(null);
  const [showAuth, setShowAuth] = useState(false);
  // THE ONE SILENT CHECK on boot/base-change (the abstractflow contract;
  // LOGIN-FIRST ruling 2026-07-09 honored by the check's own conclusions):
  // 1. proxy posture — GET /api/connection/gateway answers "still signed
  //    in?" from the HttpOnly cookie; sign-in appears only on a definitive
  //    no. 2. direct posture — re-probe the stored bearer against the
  //    resolved base, distinguishing REFUSED (sign in again) from
  //    UNREACHABLE (a gateway that is down is not a revoked credential —
  //    audit V5/W1: never answer a network error with a sign-in demand).
  // The modal opens HERE, on definitive conclusions — never while the
  // check is in flight (audit V4: the card flashed on every refresh even
  // when the stored credential was about to verify).
  useEffect(() => {
    if (sourceKind !== "gateway" || authVerified) return;
    const base = gatewayUrl.trim().replace(/\/+$/, "");
    let cancelled = false;
    setAuthChecking(true);
    (async () => {
      // ONE status read answers two questions: does this origin have the
      // proxy, and which gateway does it front. The proxy posture covers
      // same-origin bases AND direct deep links whose ?gateway= names the
      // proxy's own gateway (the launcher opens ?gateway=http://…:8080 —
      // converge it onto the proxy instead of dialing cross-origin, or the
      // sign-in-once cookie can never apply to the main entry path).
      const sameOriginBase = !base || new URL(base, window.location.href).origin === window.location.origin;
      const status = await proxyConnectionStatus();
      if (cancelled) return;
      const proxyGateway = (status.gatewayUrl || "").trim().replace(/\/+$/, "");
      const proxyCovers =
        status.available && (sameOriginBase || (proxyGateway !== "" && sameGatewayTarget(proxyGateway, base)));
      if (proxyCovers) {
        setProxyMode(true);
        setGatewayToken(null); // cookies carry the session; no bearer
        if (base) {
          // Converge every data call onto the page origin (the proxy).
          setGatewayUrl("");
          setIndexBase((prev) => (prev !== null ? "" : prev));
        }
        if (status.ok) {
          setAuthState({ mode: "session", userId: status.userId || "operator", token: null, remembered: true });
          setAuthVerified(true);
          setShowAuth(false);
          setControlNote(null);
        } else if (status.hasSession) {
          // A session cookie exists but the gateway did not confirm it —
          // EXPIRED session or gateway DOWN, and the proxy's one answer
          // cannot distinguish them (refresh-audit gap G2). Unreachable
          // must never read as revoked: say what is known, keep the
          // cookie, and leave the connect button one click away on the
          // locked card instead of forcing the modal.
          setControlNote("The gateway did not confirm your browser session (it may be restarting, or the session expired) — retry in a moment, or connect again.");
        } else {
          setShowAuth(true); // first connect through this browser
        }
        setAuthChecking(false);
        return;
      }
      setProxyMode(false);
      // DIRECT posture: verify the stored bearer against this base — but
      // never REPLAY a token against a different gateway than it was
      // verified for (refresh-audit gap G1: sending a bearer to the wrong
      // host leaks it). Legacy base-less credentials probe once and are
      // rebound to the base that accepts them.
      if (authState?.token) {
        const storedBase = (authState.base || "").trim().replace(/\/+$/, "");
        if (storedBase && base && !sameGatewayTarget(storedBase, base)) {
          setControlNote(`Your saved sign-in belongs to ${storedBase} — connect to this gateway to continue.`);
          setShowAuth(true);
          setAuthChecking(false);
          return;
        }
        const probe = await classifyOperatorAuth(base, authState.token);
        if (cancelled) return;
        if (probe.kind === "operator") {
          if (!storedBase && authState.remembered) {
            // Rebind the legacy credential to the base that accepted it.
            storeAuth({ ...authState, base });
            setAuthState({ ...authState, base });
          }
          setAuthVerified(true);
          setShowAuth(false);
          setControlNote(null);
        } else if (probe.kind === "refused") {
          setControlNote("Your saved sign-in is no longer accepted by this gateway — please connect again.");
          setShowAuth(true);
        } else {
          // Unreachable is NOT a credential problem: keep the credential,
          // say what happened, let the operator retry (no sign-in demand).
          setControlNote(`The gateway is not answering (${probe.error}) — your sign-in is kept; retry when it is back.`);
        }
      } else {
        setShowAuth(true); // no credential at all: first connect
      }
      setAuthChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceKind, authState, authVerified, gatewayUrl]);
  // Drain a deferred life stream once auth verifies (the fetch that was
  // withheld from an unverified browser).
  useEffect(() => {
    if (authVerified && pendingStreamRef.current) {
      const run = pendingStreamRef.current;
      pendingStreamRef.current = null;
      run();
    }
  }, [authVerified]);
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
  // Identity flows from the ONE authentication (maintainer 2026-07-10
  // 20:17): the old free-text participant field (and its localStorage
  // seed) is GONE — the chat drawer derives person:<userId> from the
  // signed-in principal, and the door verifies regardless.
  /** The multi-entity manager (0010 121500Z): when a gateway answers and
   * no ?entity= is selected, the app is an INDEX of lives, not one life. */
  const [indexBase, setIndexBase] = useState<string | null>(null);
  /** Fleet wall (item 13, O-C): watch every life at once from the index. */
  const [fleetMode, setFleetMode] = useState(false);
  /** Meet reader (item 14 human-access half): the shared moment open for
   * reading — every participating life's perspective, side by side. */
  const [meetVisitId, setMeetVisitId] = useState<string | null>(null);
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
    // The entity's HANDLE (`castor@<declared address>`, GW-F item 5):
    // display-only reachability — shown in the header, NEVER a storage or
    // lookup key (O-B: UI keys stay on the slug; the address may change).
    if (sourceKind !== "gateway" || !entityName) {
      setHandle(null);
      return;
    }
    const base = gatewayUrl.trim().replace(/\/+$/, "");
    let cancelled = false;
    listEntities(base)
      .then((list) => {
        if (cancelled) return;
        const row = list.find((e) => e.slug === entityName);
        setHandle(row?.handle ?? null);
      })
      .catch(() => !cancelled && setHandle(null));
    return () => {
      cancelled = true;
    };
  }, [sourceKind, entityName, gatewayUrl]);

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
      // "this is not castor"). GATED ON VERIFIED AUTH (2026-07-10 20:56):
      // an unverified browser must not even FETCH a life; the stream waits
      // for the confirming probe, drained by the auth effect below.
      loadEnvelopes([], "gateway", `${entityParam} @ ${gatewayParam || "this gateway"}`);
      const runBootStream = () => {
        // The base is read LIVE, not from the boot closure: the silent auth
        // check may have converged a ?gateway= deep link onto the page
        // origin's proxy by the time this deferred stream drains.
        const streamBase = gatewayUrlRef.current.trim().replace(/\/+$/, "");
        setBootProgress("loading his life…");
        streamReplay(streamBase, entityParam, 0, (all, bytes) => {
          setEnvelopes([...all]);
          setScrubIndex(all.length - 1);
          setBootProgress(`loading his life… ${all.length.toLocaleString()} events${bytes > 0 ? ` · ${(bytes / 1048576).toFixed(0)} MB` : ""}`);
        })
          .then((history) => {
            setBootProgress(null);
            if (!wantReplay) {
              startTail(streamBase, entityParam, history.length > 0 ? history[history.length - 1].seq : 0);
            } else {
              setScrubIndex(-1);
              setPlaying(history.length > 0);
            }
          })
          .catch((e) => {
            setBootProgress(null);
            setError(`Could not open ${entityParam}: ${String((e as Error).message || e)}`);
          });
      };
      if (authVerifiedRef.current) runBootStream();
      else pendingStreamRef.current = runBootStream;
      return () => tailRef.current?.close();
    }
    const srcParam = params.get("src");
    if (!srcParam) {
      // No entity, no file: find the gateway (0010 121500Z + maintainer
      // 2026-07-10: "default is 8080"). Candidates in order: ?gateway= /
      // same-origin (the proxy posture) → the cli-injected config → the
      // STANDARD local gateway port. A 401/403 answer still counts as a
      // gateway FOUND (the index prompts sign-in); only unreachable moves
      // on. The demo stays the fallback for standalone use.
      const injected = (
        (window as unknown as { __ABSTRACT_UI_CONFIG__?: { gateway_url?: string } }).__ABSTRACT_UI_CONFIG__?.gateway_url || ""
      )
        .trim()
        .replace(/\/+$/, "");
      // Candidate order: explicit param > same-origin ("" — the PROXY
      // posture; when the page is served by the observer CLI, its
      // /api/gateway/* proxy is the contract path and cookies carry the
      // session) > the base a stored bearer was verified against (audit
      // V3: a credential without its base re-asked on every refresh) >
      // injected config > the standard local gateway port.
      const storedBase = (loadStoredAuth()?.base || "").trim().replace(/\/+$/, "");
      const candidates = [...new Set([gatewayParam, "", storedBase, injected, "http://127.0.0.1:8080"])];
      const adopt = (base: string) => {
        setGatewayUrl(base);
        setSourceKind("gateway");
        setSourceLabel(`entities @ ${base || "this gateway"}`);
        setIndexBase(base);
      };
      const tryNext = (i: number): void => {
        if (i >= candidates.length) {
          loadDemoOrSrc(null);
          return;
        }
        listEntities(candidates[i])
          .then(() => adopt(candidates[i]))
          .catch((e: Error & { status?: number }) => {
            if (e.status === 401 || e.status === 403) adopt(candidates[i]);
            else tryNext(i + 1);
          });
      };
      tryNext(0);
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

  // ------------------------------------------------------- gateway auth
  const disconnectGateway = useCallback(async () => {
    if (proxyModeRef.current) {
      // End the server-side gateway session + clear the first-party cookies
      // (the ONE disconnect the contract allows to re-ask for sign-in).
      await proxyConnectionLogout();
    }
    setGatewayToken(null);
    storeAuth(null);
    try {
      localStorage.removeItem("abstractobserver_entity_token"); // legacy key
    } catch {
      // best-effort
    }
    setAuthState(null);
    setAuthVerified(false); // lock the content gate again
    setControlNote("Disconnected — this browser holds no gateway credential.");
  }, []);

  /** 401/403 on a door write while the UI believed it was authed. The
   * contract fix (audit V6/W2): ONE silent re-check first — a transient
   * refusal, a CSRF hiccup, or a non-auth 403 must not nuke a valid
   * session into a sign-in demand loop. Only a re-check that itself says
   * "refused" reopens the sign-in. */
  const handleAuthRefused = useCallback(async () => {
    const base = gatewayUrl.trim().replace(/\/+$/, "");
    if (proxyModeRef.current) {
      const status = await proxyConnectionStatus();
      if (status.ok) {
        setControlNote("The door refused that action, but your sign-in is valid — the refusal was about the action, not you.");
        return;
      }
    } else if (authState?.token) {
      const probe = await classifyOperatorAuth(base, authState.token);
      if (probe.kind === "operator") {
        setControlNote("The door refused that action, but your sign-in is valid — the refusal was about the action, not you.");
        return;
      }
      if (probe.kind === "unreachable") {
        setControlNote(`The gateway is not answering (${probe.error}) — your sign-in is kept; retry when it is back.`);
        return;
      }
    }
    setAuthVerified(false);
    setControlNote("The gateway no longer accepts this browser's sign-in — please connect again.");
    setShowAuth(true);
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
  // A gateway source whose browser is not yet VERIFIED shows no content
  // (the critical content gate). File/demo sources are never locked.
  const gatewayLocked = sourceKind === "gateway" && !authVerified;
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
      const base = gatewayUrl.trim().replace(/\/+$/, "");
      setEntityName(name);
      loadEnvelopes([], "gateway", `${name} @ ${base || "this gateway"}`);
      // "When I click on the entity, I should join its room" (maintainer,
      // 2026-07-09): land in the chat drawer, ready to talk.
      if (opts.joinRoom !== false) setRequestedTab({ tab: "chat", nonce: Date.now() });
      // Deep links stay shareable (0010 121500Z item 3); the token never
      // rides a pushed URL. The BASE does (direct posture only): a pushed
      // ?entity= without its ?gateway= made refresh re-resolve the base
      // from scratch and lose the credential's target (audit V3 — the
      // refresh re-ask). Proxy posture pushes no gateway param: the page
      // origin IS the base, and the cookie survives refresh by itself.
      if (opts.pushUrl !== false) {
        const url = new URLSearchParams(window.location.search);
        url.set("entity", name);
        url.delete("token");
        if (base) url.set("gateway", base);
        else url.delete("gateway");
        window.history.pushState({ entity: name }, "", `${window.location.pathname}?${url.toString()}`);
      }
      // The life STREAM is gated on verified auth (2026-07-10 20:56): if the
      // browser is not yet verified, defer the fetch — the render gate shows
      // the sign-in, and the auth effect drains this the moment a confirming
      // probe/sign-in lands. No life is fetched for an unverified browser.
      const runStream = async () => {
        setBootProgress("loading his life…");
        try {
          const history = await streamReplay(base, name, 0, (all, bytes) => {
            setEnvelopes([...all]);
            setScrubIndex(all.length - 1);
            setBootProgress(`loading his life… ${all.length.toLocaleString()} events${bytes > 0 ? ` · ${(bytes / 1048576).toFixed(0)} MB` : ""}`);
          });
          setBootProgress(null);
          if (history.length > 0) setScrubIndex(history.length - 1);
          startTail(base, name, history.length > 0 ? history[history.length - 1].seq : 0);
        } catch (e) {
          setBootProgress(null);
          setError(`Replay read failed: ${String((e as Error).message || e)}`);
        }
      };
      if (authVerifiedRef.current) void runStream();
      else pendingStreamRef.current = () => void runStream();
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

  // The TEMPORAL count at the scrub position (two-count model): green
  // warmth in the canvas keys on this decaying activation, never on the
  // global counts. Pure over the fold's bounded attention windows —
  // recomputes once per fold change, not per frame.
  const temporal = useMemo(() => computeTemporalActivation(fold.attention), [fold]);

  // Wall-clock honesty for the warmth (data-adversary finding, measured on
  // Castor: journal frozen since Jul 9 while the head still rendered warm):
  // activation decays by ACTIVITY, so a stopped life keeps its last recall
  // green forever. Say how old the warmth actually is once it stops being
  // "now" — in the scrubbed past this is the age AT the scrub position.
  const warmthAge = useMemo(() => {
    if (!fold.last_attention_at) return null;
    const head = new Date(fold.last_attention_at).getTime();
    if (Number.isNaN(head)) return null;
    // Live/latest: age against wall clock. Scrubbed: age against the scrub
    // position's own moment (the envelope at the head of the prefix).
    const refIso = effectiveIndex >= 0 && envelopes[effectiveIndex] ? envelopes[effectiveIndex].observed_at : "";
    const ref = refIso ? new Date(refIso).getTime() : Date.now();
    const anchor = live || !refIso ? Date.now() : ref;
    const ageMs = anchor - head;
    if (!Number.isFinite(ageMs) || ageMs < 10 * 60 * 1000) return null; // fresh enough to say nothing
    const h = Math.floor(ageMs / 3600000);
    if (h < 1) return `${Math.floor(ageMs / 60000)}m`;
    if (h < 48) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  }, [fold, live, effectiveIndex, envelopes]);

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
          {handle ? (
            <span className="eh_handle" title="How this door is reached (declared address) — reachability, not identity; changing it touches no record.">
              {handle}
            </span>
          ) : null}
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
          {/* Stats + search reveal the life's shape — withheld until the
            * browser is verified (content gate, 2026-07-10 20:56). */}
          {!gatewayLocked ? (
            <>
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
            </>
          ) : null}
          {indexBase !== null && entityName ? (
            <button className="eh_connect" onClick={() => goToIndex()} title="All entities — back to the manager index">
              ⌂
            </button>
          ) : null}
          {/* ONE auth control (maintainer 2026-07-10 20:17): connected →
            * identity + disconnect; disconnected → connect (the shared
            * ui-kit sign-in card). The credential MECHANISM is never
            * displayed — the identity is the abstraction. */}
          {authState ? (
            <>
              <span className="eh_identity" title="Signed in — this identity is what the door stamps into his memories.">
                ⚡ {authState.userId}
              </span>
              <button
                className="eh_connect"
                onClick={() => void disconnectGateway()}
                title="Disconnect this browser (and end the session where one exists) — you can reconnect from the same button"
              >
                ⏏ disconnect
              </button>
            </>
          ) : (
            <button className="eh_connect" onClick={() => setShowAuth(true)} title="Connect to the gateway (shared sign-in)">
              🔑 connect
            </button>
          )}
        </div>
      </header>

      {sourceKind === "gateway" && entityName && !gatewayLocked ? (
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
          {/* Auth lives in the header (one control, maintainer 2026-07-10);
            * the strip only nudges when signed out. */}
          {!authState ? (
            <button className="ec_btn" onClick={() => setShowAuth(true)} title="Sign in with the shared connect card (top right)">
              🔑 connect
            </button>
          ) : null}
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

      {error ? <div className="entity_error">{error}</div> : null}

      {/* CONTENT GATE (maintainer ruling 2026-07-10 20:56, CRITICAL): a
        * gateway source shows NOTHING — no roster, no fleet, no life — to a
        * browser the gateway has not confirmed. This is defense-in-depth
        * over the gateway's own auth (its dev-read posture leaked reads);
        * the observer never renders a life it has not been verified to see. */}
      {gatewayLocked ? (
        <div className="entity_locked">
          <div className="entity_locked_card">
            {authChecking ? (
              <>
                <h2>Checking your sign-in…</h2>
                <p>Verifying this browser's session with the gateway — one silent check, no typing needed if you signed in before.</p>
              </>
            ) : (
              <>
                <h2>🔒 Sign in to view {entityName ? `${entityName}'s life` : "this gateway"}</h2>
                <p>The observer shows a summoned entity's memories only to a browser the gateway has authenticated — an entity's inner life is not public.</p>
                <button className="eix_create_btn" onClick={() => setShowAuth(true)}>
                  🔑 connect
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {!gatewayLocked && indexBase !== null && !entityName && fleetMode ? (
        <FleetView
          key={authState ? `fleet:${authState.userId}` : "fleet:anon"}
          baseUrl={indexBase}
          onOpen={(slug) => {
            setFleetMode(false);
            void openEntity(slug);
          }}
          onBack={() => setFleetMode(false)}
        />
      ) : null}

      {!gatewayLocked && indexBase !== null && !entityName && !fleetMode ? (
        <>
          <div className="eix_fleet_bar">
            <button
              className="eix_create_btn"
              onClick={() => setFleetMode(true)}
              title="Watch every life at once — one live tile per entity (streams never merge; each tile is its own fold)"
            >
              👁 watch all
            </button>
          </div>
          <EntitiesIndex
            key={authState ? `authed:${authState.userId}` : "anon"}
            baseUrl={indexBase}
            token={controlToken.trim() || null}
            onOpen={(slug) => void openEntity(slug)}
            onConnect={() => setShowAuth(true)}
          />
        </>
      ) : null}

      {showAuth ? (
        <ConnectGatewayModal
          proxyMode={proxyMode === true}
          baseUrl={gatewayUrl}
          onBaseUrlChange={setGatewayUrl}
          onConnected={(state) => {
            if (state.token) setGatewayToken(state.token);
            setAuthState(state);
            // Direct posture: converge EVERY base on the one the credential
            // was verified against (refresh-audit F7: a URL edited in the
            // modal updated gatewayUrl but left the roster's indexBase on
            // the old target — a quieter split brain).
            if (state.mode === "bearer" && state.base) {
              setGatewayUrl(state.base);
              setIndexBase((prev) => (prev !== null ? state.base ?? prev : prev));
            }
            // The modal already PROVED the credential (session login or a
            // confirming operator probe) — unlock content immediately; no
            // second round-trip, and the deferred life stream drains.
            setAuthVerified(true);
            setShowAuth(false);
            setControlNote(`Connected as ${state.userId}.`);
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

      {meetVisitId && sourceKind === "gateway" ? (
        <MeetReader
          baseUrl={gatewayUrl.trim().replace(/\/+$/, "")}
          visitId={meetVisitId}
          onClose={() => setMeetVisitId(null)}
          onOpenEntity={(slug) => {
            setMeetVisitId(null);
            void openEntity(slug);
          }}
        />
      ) : null}

      <div className="entity_main" style={gatewayLocked || (indexBase !== null && !entityName) ? { display: "none" } : undefined}>
        <div className="entity_canvas_wrap">
          <GraphCanvas
            fold={fold}
            temporal={temporal}
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
            <span
              className="lg_edge"
              title="usage trail — turns green when the two memories served a RECENT moment together (temporal count: decays with activity, so old habits fade back to grey); line width grows with lifetime co-use; flashes amber when just traveled"
            >
              <svg width="26" height="6" aria-hidden="true">
                <line x1="0" y1="3" x2="26" y2="3" stroke="#7edca0" strokeWidth="1.8" />
              </svg>
              warm together
            </span>
            <span className="lg_edge" title="green glow — this memory was RECENTLY selected (temporal count: decays with activity); node SIZE carries the lifetime count, which never decays">
              <svg width="14" height="14" aria-hidden="true">
                <circle cx="7" cy="7" r="6" fill="rgba(110,220,160,0.35)" />
                <circle cx="7" cy="7" r="3" fill="#6ea8d8" />
              </svg>
              warm now
            </span>
            {warmthAge ? (
              <span
                className="lg_edge lg_stale"
                title="Warmth decays with ACTIVITY, not wall time — while nothing runs, the last recall stays green. This is how long ago that last selection actually happened."
              >
                🥶 last selection {warmthAge} ago
              </span>
            ) : null}
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
                        authUserId={authState?.userId ?? null}
                        envelopes={envelopes}
                        onAuthRefused={() => void handleAuthRefused()}
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
                  temporal={temporal}
                  scrubSeq={scrubSeq}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  verbatimSource={
                    sourceKind === "gateway" && entityName
                      ? { baseUrl: gatewayUrl.trim().replace(/\/+$/, ""), entity: entityName }
                      : null
                  }
                  onOpenMeet={sourceKind === "gateway" ? (visitId) => setMeetVisitId(visitId) : undefined}
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
