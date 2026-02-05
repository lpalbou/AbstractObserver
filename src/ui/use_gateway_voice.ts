import { useEffect, useMemo, useRef, useState } from "react";

import type { AttachmentRef, GatewayClient } from "../lib/gateway_client";
import { random_id } from "../lib/ids";

export type TtsPlaybackStatus = "idle" | "loading" | "playing" | "paused";

function _supports_media_recorder(): boolean {
  if (typeof window === "undefined") return false;
  const nav: any = navigator as any;
  return Boolean(nav?.mediaDevices?.getUserMedia) && typeof (window as any).MediaRecorder === "function";
}

function _supports_tts_webaudio(): boolean {
  if (typeof window === "undefined") return false;
  const w: any = window as any;
  return Boolean(w?.AudioContext || w?.webkitAudioContext);
}

function _choose_voice_mime(): string {
  const MR: any = (window as any).MediaRecorder;
  const is_supported = (t: string) => {
    try {
      return Boolean(MR?.isTypeSupported?.(t));
    } catch {
      return false;
    }
  };
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];
  for (const c of candidates) if (is_supported(c)) return c;
  return "";
}

async function _decode_audio(ctx: AudioContext, buf: ArrayBuffer): Promise<AudioBuffer> {
  const copy = buf.slice(0);
  const fn: any = (ctx as any).decodeAudioData?.bind(ctx);
  if (typeof fn !== "function") throw new Error("decodeAudioData not available");
  try {
    const maybe = fn(copy);
    if (maybe && typeof maybe.then === "function") return await maybe;
  } catch {
    // fall back to callback-style below
  }
  return await new Promise<AudioBuffer>((resolve, reject) => {
    try {
      fn(copy, resolve, reject);
    } catch (e) {
      reject(e);
    }
  });
}

export function useGatewayVoice(opts: {
  gateway: GatewayClient | null;
  session_id: string;
  run_id: string;
  on_error?: (message: string) => void;
  on_transcript?: (text: string) => void;
}): {
  tts_supported: boolean;
  tts_playback: { key: string; status: TtsPlaybackStatus };
  toggle_tts: (msg_key: string, text: string) => Promise<void>;
  stop_tts: () => void;
  voice_ptt_supported: boolean;
  voice_ptt_recording: boolean;
  voice_ptt_busy: boolean;
  start_voice_ptt_recording: () => Promise<void>;
  stop_voice_ptt_recording: () => void;
} {
  const set_error = (msg: string) => opts.on_error?.(msg);

  const tts_supported = useMemo(() => _supports_tts_webaudio(), []);
  const voice_ptt_supported = useMemo(() => _supports_media_recorder(), []);

  const [tts_playback, set_tts_playback] = useState<{ key: string; status: TtsPlaybackStatus }>({ key: "", status: "idle" });
  const tts_key_ref = useRef<string>("");
  const tts_loading_key_ref = useRef<string>("");
  const tts_ctx_ref = useRef<AudioContext | null>(null);
  const tts_gain_ref = useRef<GainNode | null>(null);
  const tts_source_ref = useRef<AudioBufferSourceNode | null>(null);
  const tts_buffer_ref = useRef<AudioBuffer | null>(null);
  const tts_offset_ref = useRef<number>(0);
  const tts_started_at_ref = useRef<number>(0);

  const ensure_tts_webaudio = (): { ctx: AudioContext; gain: GainNode } | null => {
    try {
      const w: any = globalThis as any;
      const Ctx = w?.AudioContext || w?.webkitAudioContext;
      if (!Ctx) return null;
      if (!tts_ctx_ref.current) {
        const ctx: AudioContext = new Ctx();
        const gain = ctx.createGain();
        gain.gain.value = 1;
        gain.connect(ctx.destination);
        tts_ctx_ref.current = ctx;
        tts_gain_ref.current = gain;
      }
      const ctx = tts_ctx_ref.current;
      const gain = tts_gain_ref.current;
      if (!ctx || !gain) return null;
      try {
        if (ctx.state === "suspended") void ctx.resume();
      } catch {
        // ignore
      }
      return { ctx, gain };
    } catch {
      return null;
    }
  };

  const stop_tts_source = (): void => {
    const src = tts_source_ref.current;
    tts_source_ref.current = null;
    if (!src) return;
    try {
      src.onended = null;
    } catch {
      // ignore
    }
    try {
      src.stop();
    } catch {
      // ignore
    }
    try {
      src.disconnect();
    } catch {
      // ignore
    }
  };

  const stop_tts = (): void => {
    stop_tts_source();
    tts_loading_key_ref.current = "";
    tts_key_ref.current = "";
    tts_buffer_ref.current = null;
    tts_offset_ref.current = 0;
    tts_started_at_ref.current = 0;
    set_tts_playback({ key: "", status: "idle" });
  };

  useEffect(() => {
    return () => {
      stop_tts();
      try {
        tts_gain_ref.current?.disconnect();
      } catch {
        // ignore
      }
      try {
        void tts_ctx_ref.current?.close();
      } catch {
        // ignore
      }
      tts_ctx_ref.current = null;
      tts_gain_ref.current = null;
      tts_buffer_ref.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start_tts_playback = async (key: string, buffer: AudioBuffer, offset: number): Promise<void> => {
    const engine = ensure_tts_webaudio();
    if (!engine) throw new Error("TTS playback is not supported in this browser");
    const { ctx, gain } = engine;
    try {
      if (ctx.state === "suspended") await ctx.resume();
    } catch {
      // ignore
    }

    stop_tts_source();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);

    const dur = Number.isFinite(Number(buffer.duration)) ? Number(buffer.duration) : 0;
    const off = Math.max(0, Math.min(Number(offset || 0), dur > 0 ? Math.max(0, dur - 0.01) : 0));
    tts_started_at_ref.current = ctx.currentTime - off;
    tts_offset_ref.current = off;
    tts_source_ref.current = source;
    tts_key_ref.current = key;

    source.onended = () => {
      if (tts_source_ref.current !== source) return;
      tts_source_ref.current = null;
      tts_offset_ref.current = 0;
      tts_started_at_ref.current = 0;
      tts_key_ref.current = "";
      set_tts_playback({ key: "", status: "idle" });
    };

    source.start(0, off);
    set_tts_playback({ key, status: "playing" });
  };

  const toggle_tts = async (msg_key: string, text: string): Promise<void> => {
    const key = String(msg_key || "").trim();
    const t = String(text || "").trim();
    if (!key || !t) return;

    const gateway = opts.gateway;
    const run_id = String(opts.run_id || "").trim();
    if (!gateway) {
      set_error?.("Connect to the gateway first.");
      return;
    }
    if (!run_id) {
      set_error?.("Voice store not available (missing run_id).");
      return;
    }

    const engine = ensure_tts_webaudio();
    if (!engine) {
      set_error?.("TTS playback is not supported in this browser.");
      return;
    }

    const is_same = tts_playback.key === key;
    if (is_same && tts_playback.status === "playing") {
      const off = Math.max(0, engine.ctx.currentTime - Number(tts_started_at_ref.current || 0));
      tts_offset_ref.current = off;
      stop_tts_source();
      set_tts_playback({ key, status: "paused" });
      return;
    }
    if (is_same && tts_playback.status === "paused") {
      const buffer = tts_buffer_ref.current;
      if (buffer) {
        set_error?.("");
        try {
          await start_tts_playback(key, buffer, tts_offset_ref.current);
        } catch (e: any) {
          set_error?.(String(e?.message || e || "TTS play failed"));
          set_tts_playback({ key: "", status: "idle" });
        }
        return;
      }
      // fall through to regenerate if buffer missing
    }
    if (is_same && tts_playback.status === "loading") return;

    stop_tts_source();
    tts_buffer_ref.current = null;
    tts_offset_ref.current = 0;
    tts_started_at_ref.current = 0;

    tts_key_ref.current = key;
    tts_loading_key_ref.current = key;
    set_tts_playback({ key, status: "loading" });
    set_error?.("");

    try {
      const res = await gateway.voice_tts(run_id, { text: t, request_id: random_id() });
      const a = res?.audio_artifact;
      const aid = a && typeof a === "object" && !Array.isArray(a) ? String((a as any).$artifact || "").trim() : "";
      if (!aid) throw new Error("TTS failed: missing audio artifact");

      const blob = await gateway.download_run_artifact_content(run_id, aid);
      const bytes = await blob.arrayBuffer();
      if (tts_loading_key_ref.current !== key) return; // stale response

      const buffer = await _decode_audio(engine.ctx, bytes);
      if (tts_loading_key_ref.current !== key) return; // stale response
      tts_buffer_ref.current = buffer;
      tts_offset_ref.current = 0;

      await start_tts_playback(key, buffer, 0);
    } catch (e: any) {
      if (tts_loading_key_ref.current === key) {
        tts_loading_key_ref.current = "";
        tts_key_ref.current = "";
        set_tts_playback({ key: "", status: "idle" });
      }
      set_error?.(String(e?.message || e || "TTS failed"));
    }
  };

  const [voice_ptt_recording, set_voice_ptt_recording] = useState<boolean>(false);
  const [voice_ptt_busy, set_voice_ptt_busy] = useState<boolean>(false);
  const voice_ptt_stream_ref = useRef<MediaStream | null>(null);
  const voice_ptt_recorder_ref = useRef<MediaRecorder | null>(null);
  const voice_ptt_chunks_ref = useRef<BlobPart[]>([]);
  const voice_ptt_mime_ref = useRef<string>("");

  function stop_voice_ptt_tracks(): void {
    try {
      voice_ptt_stream_ref.current?.getTracks?.().forEach((t) => {
        try {
          t.stop();
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore
    }
    voice_ptt_stream_ref.current = null;
  }

  useEffect(() => {
    return () => {
      try {
        voice_ptt_recorder_ref.current?.stop?.();
      } catch {
        // ignore
      }
      voice_ptt_recorder_ref.current = null;
      stop_voice_ptt_tracks();
    };
  }, []);

  async function transcribe_voice_blob(blob: Blob, mime: string): Promise<void> {
    set_error?.("");
    if (!blob || !blob.size) return;
    if (voice_ptt_busy) return;

    const gateway = opts.gateway;
    const session_id = String(opts.session_id || "").trim();
    const run_id = String(opts.run_id || "").trim();
    if (!gateway) {
      set_error?.("Connect to the gateway first.");
      return;
    }
    if (!session_id) {
      set_error?.("Voice input unavailable (missing session_id).");
      return;
    }
    if (!run_id) {
      set_error?.("Voice input unavailable (missing run_id).");
      return;
    }

    set_voice_ptt_busy(true);
    try {
      const mime_lc = String(mime || blob.type || "").toLowerCase();
      const ext = mime_lc.includes("mp4") ? "m4a" : mime_lc.includes("ogg") ? "ogg" : mime_lc.includes("wav") ? "wav" : "webm";
      const file = new File([blob], `recording.${ext}`, { type: mime_lc || "audio/webm" });

      const attachment: AttachmentRef = await gateway.attachments_upload(session_id, file, { filename: file.name, content_type: file.type });
      const res = await gateway.audio_transcribe(run_id, { audio_artifact: attachment, request_id: random_id() });
      const text = String(res?.text || "").trim();
      if (text) opts.on_transcript?.(text);
    } catch (e: any) {
      set_error?.(String(e?.message || e || "Transcription failed"));
    } finally {
      set_voice_ptt_busy(false);
    }
  }

  async function start_voice_ptt_recording(): Promise<void> {
    set_error?.("");
    if (!voice_ptt_supported) {
      set_error?.("Voice recording is not supported in this browser (MediaRecorder/getUserMedia unavailable).");
      return;
    }
    if (voice_ptt_busy) return;
    if (voice_ptt_recording || voice_ptt_recorder_ref.current) return;

    voice_ptt_chunks_ref.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voice_ptt_stream_ref.current = stream;
      const mime = _choose_voice_mime();
      voice_ptt_mime_ref.current = mime;

      const rec: MediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      voice_ptt_recorder_ref.current = rec;
      rec.ondataavailable = (ev: any) => {
        try {
          if (ev?.data) voice_ptt_chunks_ref.current.push(ev.data as BlobPart);
        } catch {
          // ignore
        }
      };
      rec.onerror = () => {
        set_error?.("Recording failed.");
      };
      rec.onstop = () => {
        set_voice_ptt_recording(false);
        stop_voice_ptt_tracks();
        voice_ptt_recorder_ref.current = null;
        try {
          const b = new Blob(voice_ptt_chunks_ref.current, { type: voice_ptt_mime_ref.current || "" });
          void transcribe_voice_blob(b, voice_ptt_mime_ref.current);
        } catch (e: any) {
          set_error?.(String(e?.message || e || "Failed to build recording"));
        }
      };

      rec.start();
      set_voice_ptt_recording(true);
    } catch (e: any) {
      stop_voice_ptt_tracks();
      voice_ptt_recorder_ref.current = null;
      set_voice_ptt_recording(false);
      const msg = String(e?.message || e || "Failed to access microphone");
      set_error?.(msg.toLowerCase().includes("permission") ? `Microphone permission denied: ${msg}` : msg);
    }
  }

  function stop_voice_ptt_recording(): void {
    const rec = voice_ptt_recorder_ref.current;
    if (!voice_ptt_recording || !rec) return;
    voice_ptt_recorder_ref.current = null; // idempotency: prevent double-stop on global handlers
    set_voice_ptt_recording(false);
    try {
      rec.stop();
    } catch (e: any) {
      set_error?.(String(e?.message || e || "Failed to stop recording"));
    }
  }

  useEffect(() => {
    if (!voice_ptt_recording) return;
    const on_up = () => stop_voice_ptt_recording();
    window.addEventListener("pointerup", on_up);
    window.addEventListener("pointercancel", on_up);
    return () => {
      window.removeEventListener("pointerup", on_up);
      window.removeEventListener("pointercancel", on_up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice_ptt_recording]);

  return {
    tts_supported,
    tts_playback,
    toggle_tts,
    stop_tts,
    voice_ptt_supported,
    voice_ptt_recording,
    voice_ptt_busy,
    start_voice_ptt_recording,
    stop_voice_ptt_recording,
  };
}
