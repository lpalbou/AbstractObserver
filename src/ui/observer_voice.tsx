/**
 * Voice in the Observer (round 7 R7.1) — the kit's shared voice stack over this
 * Observer's gateway connection, never a local engine or a local copy of the
 * player:
 *
 * - speaking = the kit `useGatewayVoice` streaming player fed by
 *   `streamTtsJsonl` on `POST /runs/{id}/voice/tts/stream` (sentence-chunked
 *   synthesis; the first sentence plays while the next is synthesised);
 * - dictation = the kit recorder → attachment upload →
 *   `POST /runs/{id}/audio/transcribe` with `voiceSttRequest(prefs)` (no
 *   provider/model = the gateway default `input.voice` route);
 * - Settings → Voice = the kit `AfVoiceSection`, whose "Gateway default · …"
 *   comes from `GET /voice/defaults` only.
 *
 * Voice requests ride the session's media run (`session_memory_<sid>`), so the
 * runs the Observer watches never gain child runs from reading them aloud.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  AfVoiceSection,
  Icon,
  elapsedSeconds,
  gatewayApiPath,
  streamTtsJsonl,
  sttRouteText,
  transcribingLine,
  useGatewayVoice,
  voiceSttRequest,
  voiceTtsRequest,
  type GatewayVoice,
  type VoiceClientPreferences,
  type VoiceDefaults,
} from "@abstractframework/ui-kit";

import type { GatewayClient } from "../lib/gateway_client";
import { random_id } from "../lib/ids";
import { MEDIA_NEEDS_HTTPS, mediaAvailable } from "../lib/secure-context";
import { session_memory_run_id } from "../lib/session_memory";

/* ── Preferences (this browser's overrides; empty = the gateway default) ── */

export const VOICE_PREFS_KEY = "abstractobserver_voice";

export function load_voice_prefs(): VoiceClientPreferences {
  try {
    const raw = globalThis.localStorage?.getItem(VOICE_PREFS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as VoiceClientPreferences) : {};
  } catch {
    return {};
  }
}

const prefs_listeners = new Set<(p: VoiceClientPreferences) => void>();

export function save_voice_prefs(next: VoiceClientPreferences): void {
  try {
    globalThis.localStorage?.setItem(VOICE_PREFS_KEY, JSON.stringify(next || {}));
  } catch {
    // storage refused (private mode): the choice still applies to this page
  }
  for (const fn of prefs_listeners) fn(next || {});
}

/** The voice preferences, shared by Settings → Voice and every speaker/microphone on the page. */
export function use_voice_prefs(): [VoiceClientPreferences, (next: VoiceClientPreferences) => void] {
  const [prefs, set_prefs] = useState<VoiceClientPreferences>(() => load_voice_prefs());
  useEffect(() => {
    prefs_listeners.add(set_prefs);
    return () => {
      prefs_listeners.delete(set_prefs);
    };
  }, []);
  return [prefs, save_voice_prefs];
}

/* ── The gateway's default routes ── */

/** `GET /voice/defaults`, read once per connection (null until known; `failed` when the gateway could not answer). */
export function use_voice_defaults(gateway: GatewayClient | null, connected: boolean): { value: VoiceDefaults | null; failed: boolean } {
  const [state, set_state] = useState<{ value: VoiceDefaults | null; failed: boolean }>({ value: null, failed: false });
  useEffect(() => {
    if (!connected || !gateway) {
      set_state({ value: null, failed: false });
      return;
    }
    let alive = true;
    void gateway
      .voice_defaults()
      .then((value) => alive && set_state({ value: value || {}, failed: false }))
      .catch(() => alive && set_state({ value: null, failed: true }));
    return () => {
      alive = false;
    };
  }, [gateway, connected]);
  return state;
}

/** Settings → Voice: the kit's shared section, fed by this gateway. */
export function ObserverVoiceSettings(props: {
  gateway: GatewayClient | null;
  connected: boolean;
  defaults: { value: VoiceDefaults | null; failed: boolean };
  value: VoiceClientPreferences;
  onChange: (next: VoiceClientPreferences) => void;
}): React.ReactElement {
  const gw = props.gateway;
  return (
    <AfVoiceSection
      value={props.value}
      onChange={props.onChange}
      fetchCatalog={(provider, model) => (gw ? gw.voice_catalog(provider, model) : Promise.reject(new Error("Connect to a gateway to configure voice.")))}
      fetchDefaults={() => (gw ? gw.voice_defaults() : Promise.reject(new Error("Connect to a gateway to configure voice.")))}
      defaults={props.defaults.value ?? undefined}
      overrideOwner="this app"
      nested
      unavailableReason={props.connected && gw ? null : "Connect to a gateway to configure voice."}
    />
  );
}

/* ── Speaking + dictation ── */

/** How long a transcription may take before it is reported as failed. */
export const TRANSCRIBE_TIMEOUT_MS = 180_000;

type VoiceGateway = Pick<GatewayClient, "gateway_url" | "auth_headers" | "attachments_upload" | "audio_transcribe">;

/**
 * Streaming synthesis for the kit player: `POST /runs/{run}/voice/tts/stream`
 * (JSON Lines, one WAV per sentence) with only the speech fields of the
 * preferences — empty = the gateway default `output.voice` route.
 */
export function observer_tts_stream(
  gateway: VoiceGateway,
  run_id: string,
  prefs: () => VoiceClientPreferences,
  assert_current: () => void = () => undefined,
): (text: string, signal?: AbortSignal) => AsyncIterable<ArrayBuffer> {
  return async function* (text, signal) {
    assert_current();
    yield* streamTtsJsonl({
      path: gateway.gateway_url(gatewayApiPath(`runs/${encodeURIComponent(run_id)}/voice/tts/stream`)),
      headers: gateway.auth_headers(),
      signal,
      // Only the speech fields: read-aloud, devices and the transcription route are this browser's.
      body: { text, request_id: random_id(), ...voiceTtsRequest(prefs()) },
    });
  };
}

/**
 * Transcription for the kit recorder: upload the recording to the session,
 * then `POST /runs/{run}/audio/transcribe` with `voiceSttRequest(prefs)`
 * (no provider = the gateway default `input.voice` route). Answers the text
 * with the route that ran; a gateway that never answers fails after
 * TRANSCRIBE_TIMEOUT_MS as a sentence.
 */
export function observer_transcribe(
  gateway: VoiceGateway,
  session_id: string,
  run_id: string,
  prefs: () => VoiceClientPreferences,
  assert_current: () => void = () => undefined,
  timeout_ms: number = TRANSCRIBE_TIMEOUT_MS,
): (blob: Blob, mime: string) => Promise<{ text: string; provider: string | null; model: string | null }> {
  return async (blob, mime) => {
    assert_current();
    const lc = String(mime || blob.type || "").toLowerCase();
    const ext = lc.includes("mp4") ? "m4a" : lc.includes("ogg") ? "ogg" : lc.includes("wav") ? "wav" : "webm";
    const file = new File([blob], `recording.${ext}`, { type: lc || "audio/webm" });
    const attachment = await gateway.attachments_upload(session_id, file, { filename: file.name, content_type: file.type });
    assert_current();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const res = await Promise.race([
      gateway.audio_transcribe(run_id, { audio_artifact: attachment, request_id: random_id(), ...voiceSttRequest(prefs()) }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`the gateway did not answer within ${Math.round(timeout_ms / 1000)} s`)), timeout_ms);
      }),
    ]).finally(() => clearTimeout(timer));
    assert_current();
    return { text: String(res.text || ""), provider: res.provider, model: res.model };
  };
}

export type ObserverVoice = GatewayVoice & {
  /** The session's media run voice requests ride ("" until resolved / without a session). */
  run_id: string;
};

/**
 * The kit voice hook over this connection. `session_id` names the session whose
 * media run holds recordings and spoken replies; changing it stops playback and
 * discards a recording in progress.
 */
export function use_observer_voice(opts: {
  gateway: GatewayClient | null;
  session_id: string;
  prefs: VoiceClientPreferences;
  on_transcript: (text: string) => void;
  on_error: (message: string) => void;
}): ObserverVoice {
  const { gateway, prefs } = opts;
  const session_id = String(opts.session_id || "").trim();
  const [run_id, set_run_id] = useState("");
  useEffect(() => {
    let alive = true;
    if (!session_id) {
      set_run_id("");
      return;
    }
    void session_memory_run_id(session_id)
      .then((rid) => alive && set_run_id(rid))
      .catch(() => alive && set_run_id(""));
    return () => {
      alive = false;
    };
  }, [session_id]);

  const scope = `${session_id}|${run_id}`;
  const scope_ref = useRef(scope);
  scope_ref.current = scope;
  const prefs_ref = useRef(prefs);
  prefs_ref.current = prefs;
  const cb_ref = useRef(opts);
  cb_ref.current = opts;
  const assert_current = () => {
    if (scope_ref.current !== scope) throw new Error("Voice session changed.");
  };

  const ready = Boolean(gateway && run_id && session_id);
  const voice = useGatewayVoice({
    output_device_id: prefs.output_device || "",
    input_device_id: prefs.input_device || "",
    input_gain: prefs.input_gain,
    volume: prefs.reply_volume,
    // Tap to start / tap to stop, or hold: VoiceDictate stops the recording itself.
    stop_on_pointerup: false,
    tts_stream: ready ? observer_tts_stream(gateway!, run_id, () => prefs_ref.current, assert_current) : undefined,
    transcribe: ready ? observer_transcribe(gateway!, session_id, run_id, () => prefs_ref.current, assert_current) : undefined,
    on_transcript: (text) => {
      if (scope_ref.current === scope) cb_ref.current.on_transcript(text);
    },
    on_error: (message) => {
      if (scope_ref.current === scope) cb_ref.current.on_error(message);
    },
  });

  useEffect(() => {
    voice.stop_tts();
    voice.cancel_voice_ptt_recording?.();
    return () => {
      voice.stop_tts();
      voice.cancel_voice_ptt_recording?.();
    };
  }, [scope, voice.stop_tts, voice.cancel_voice_ptt_recording]);

  return { ...voice, run_id };
}

/**
 * Speak each new reply when Settings → Voice → Read aloud is on. Replies
 * present when the hook mounts are never spoken (only ones that arrive later).
 */
export function use_read_aloud(
  voice: ObserverVoice,
  enabled: boolean,
  latest: { key: string; text: string } | null,
): void {
  const seen = useRef<string | null>(null);
  useEffect(() => {
    const key = latest?.key || "";
    if (seen.current === null) {
      seen.current = key;
      return;
    }
    if (!key || key === seen.current) return;
    seen.current = key;
    if (enabled && voice.tts_supported && latest?.text.trim()) void voice.toggle_tts(key, latest.text);
  }, [latest?.key, latest?.text, enabled, voice.tts_supported, voice.toggle_tts]);
}

/** Ticks once a second while `active` (the elapsed seconds of "Recording…" / "Transcribing…"). */
function use_now(active: boolean): number {
  const [now, set_now] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    set_now(Date.now());
    const t = setInterval(() => set_now(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** A press shorter than this is a tap: recording keeps going until the next tap. */
export const TAP_MS = 350;

/**
 * The composer microphone (hold to dictate, or tap to start and tap again to
 * stop), a Stop control while a reply is spoken, and the status line
 * "Recording… 3 s" / "Transcribing… 4 s · faster-whisper / large-v3".
 */
export function VoiceDictate(props: {
  voice: ObserverVoice;
  defaults: VoiceDefaults | null;
  prefs: VoiceClientPreferences;
  /** Why dictation cannot start now (null = it can). */
  blocked?: string | null;
  error?: string;
}): React.ReactElement {
  const { voice } = props;
  const held = useRef(false);
  const latched = useRef(false);
  const pressed_at = useRef(0);
  const begin = () => {
    if (latched.current) {
      latched.current = false;
      voice.stop_voice_ptt_recording();
      return;
    }
    held.current = true;
    pressed_at.current = Date.now();
    void voice.start_voice_ptt_recording().then(() => {
      // A permission prompt may outlive the press; never leave the microphone open.
      if (!held.current && !latched.current) voice.stop_voice_ptt_recording();
    });
  };
  const release = () => {
    if (!held.current) return;
    held.current = false;
    if (Date.now() - pressed_at.current < TAP_MS) {
      latched.current = true;
      return;
    }
    voice.stop_voice_ptt_recording();
  };
  useEffect(() => {
    const stop_all = () => {
      held.current = false;
      latched.current = false;
      voice.stop_voice_ptt_recording();
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", stop_all);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", stop_all);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.stop_voice_ptt_recording]);
  useEffect(() => {
    if (!voice.voice_ptt_recording) latched.current = false;
  }, [voice.voice_ptt_recording]);

  const since = voice.voice_ptt_since || 0;
  const now = use_now(Boolean(since));
  const route = sttRouteText(props.prefs, props.defaults);
  const status = voice.voice_ptt_recording
    ? `Recording… ${since ? elapsedSeconds(since, now) : ""}`.trim()
    : voice.voice_ptt_busy
      ? transcribingLine(since || now, now, route)
      : "";
  const media_blocked = !mediaAvailable();
  const reason = media_blocked ? MEDIA_NEEDS_HTTPS : props.blocked || (!voice.voice_ptt_supported ? "Dictation is not available on this gateway connection." : null);
  return (
    <span className="voice_tools" data-voice-tools>
      <button
        type="button"
        className={`btn btn_icon voice_btn${voice.voice_ptt_recording ? " danger" : ""}`}
        data-action="dictate"
        aria-label={voice.voice_ptt_recording ? "Recording — tap or release to transcribe" : "Hold to dictate"}
        aria-pressed={voice.voice_ptt_recording}
        title={reason || "Hold to dictate, or tap to start and tap again to stop (Space or Enter on keyboard)"}
        disabled={Boolean(reason) || voice.voice_ptt_busy}
        onPointerDown={(e) => {
          if (e.button === 0) begin();
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onKeyDown={(e) => {
          if ([" ", "Enter"].includes(e.key) && !e.repeat) {
            e.preventDefault();
            begin();
          }
        }}
        onKeyUp={(e) => {
          if ([" ", "Enter"].includes(e.key)) {
            e.preventDefault();
            release();
          }
        }}
      >
        <Icon name={voice.voice_ptt_busy ? "loader" : "mic"} size={15} />
      </button>
      {voice.tts_playback.status !== "idle" ? (
        <button type="button" className="btn btn_icon" data-action="stop-speaking" aria-label="Stop spoken reply" title="Stop spoken reply" onClick={voice.stop_tts}>
          <Icon name="x" size={14} />
        </button>
      ) : null}
      {status ? (
        <span role="status" className="voice_status mono" data-voice-status>
          {status}
        </span>
      ) : null}
      {props.error ? (
        <span role="alert" className="voice_error" data-voice-error>
          {props.error}
        </span>
      ) : null}
    </span>
  );
}

/** "Read aloud" / "Stop" for one text (a run's outcome): the same streaming player as every reply. */
export function SpeakButton(props: { voice: ObserverVoice; speak_key: string; text: string; error?: string }): React.ReactElement | null {
  const { voice } = props;
  if (!voice.tts_supported || !props.text.trim()) return null;
  const mine = voice.tts_playback.key === props.speak_key ? voice.tts_playback.status : "idle";
  const label = mine === "loading" ? "Preparing…" : mine === "playing" ? "Stop" : mine === "paused" ? "Resume" : "Read aloud";
  return (
    <>
      <button
        type="button"
        className="btn"
        data-action="read-aloud"
        data-speak-state={mine}
        aria-pressed={mine === "playing" || mine === "loading"}
        title={mine === "playing" ? "Stop reading aloud" : "Read this aloud with the gateway's voice"}
        onClick={() => (mine === "playing" || mine === "loading" ? voice.stop_tts() : void voice.toggle_tts(props.speak_key, props.text))}
      >
        <Icon name={mine === "playing" || mine === "loading" ? "x" : "speaker"} size={14} /> {label}
      </button>
      {props.error ? (
        <span role="alert" className="voice_error" data-voice-error>
          {props.error}
        </span>
      ) : null}
    </>
  );
}
