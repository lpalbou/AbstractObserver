import React from "react";
import { readFileSync } from "fs";
import { resolve } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GatewayClient } from "../lib/gateway_client";
import { ObserverVoiceSettings, SpeakButton, VoiceDictate, observer_transcribe, observer_tts_stream, type ObserverVoice } from "./observer_voice";

const DEFAULTS = {
  tts: { route: "output.voice", configured: true, provider: "supertonic", model: "supertonic-3", voice: "M3" },
  stt: { route: "input.voice", configured: true, provider: "faster-whisper", model: "large-v3" },
  source: "capability_defaults",
};

function wav_b64(): string {
  // 44-byte header + 8 silent samples: a decodable mono 16-bit WAV.
  const data = new Uint8Array(16);
  const buf = new ArrayBuffer(44 + data.length);
  const v = new DataView(buf);
  const tag = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  tag(0, "RIFF");
  v.setUint32(4, 36 + data.length, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 24000, true);
  v.setUint32(28, 48000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  tag(36, "data");
  v.setUint32(40, data.length, true);
  return Buffer.from(buf).toString("base64");
}

function fake_voice(over: Partial<ObserverVoice> = {}): ObserverVoice {
  return {
    run_id: "session_memory_s1",
    tts_supported: true,
    tts_playback: { key: "", status: "idle" },
    toggle_tts: async () => undefined,
    stop_tts: () => undefined,
    voice_ptt_supported: true,
    voice_ptt_recording: false,
    voice_ptt_busy: false,
    start_voice_ptt_recording: async () => undefined,
    stop_voice_ptt_recording: () => undefined,
    cancel_voice_ptt_recording: () => undefined,
    voice_ptt_since: 0,
    ...over,
  };
}

describe("Observer voice = the kit stack over the gateway voice routes (round 7 R7.1)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("Settings → Voice is the kit section and names the gateway's routes from /voice/defaults, never openai", () => {
    const html = renderToStaticMarkup(
      <ObserverVoiceSettings gateway={new GatewayClient({ base_url: "" })} connected defaults={{ value: DEFAULTS, failed: false }} value={{}} onChange={() => undefined} />,
    );
    expect(html).toContain("Gateway default · supertonic / supertonic-3");
    expect(html).toContain("Gateway default · faster-whisper / large-v3");
    expect(html).not.toMatch(/openai/i);
  });

  it("the client reads GET /api/gateway/voice/defaults", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (urls.push(String(url)), new Response(JSON.stringify(DEFAULTS), { status: 200 }))));
    const got = await new GatewayClient({ base_url: "http://gw.test" }).voice_defaults();
    expect(urls).toEqual(["http://gw.test/api/gateway/voice/defaults"]);
    expect(got.tts?.provider).toBe("supertonic");
  });

  it("speaking streams /runs/{media run}/voice/tts/stream with only the speech fields and yields each sentence's WAV", async () => {
    const calls: Array<{ url: string; body: any; headers: any }> = [];
    const lines = [
      { type: "start", child_run_id: "c1" },
      { type: "chunk", index: 0, audio_b64: wav_b64() },
      { type: "chunk", index: 1, audio_b64: wav_b64() },
      { type: "done", metrics: { ttfb_s: 0.4, device: "cpu" } },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: any) => {
        calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
        return new Response(lines.map((l) => JSON.stringify(l)).join("\n") + "\n", { status: 200 });
      }),
    );
    const gw = new GatewayClient({ base_url: "http://gw.test", auth_token: "tok" });
    const prefs = { voice: "F1", read_aloud: true, stt_provider: "openai", output_device: "dev-1" } as any;
    const segs: ArrayBuffer[] = [];
    for await (const seg of observer_tts_stream(gw, "session_memory_s1", () => prefs)("Hello there. Second sentence.")) segs.push(seg);
    expect(segs).toHaveLength(2);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://gw.test/api/gateway/runs/session_memory_s1/voice/tts/stream");
    expect(calls[0].headers.Authorization).toBe("Bearer tok");
    expect(calls[0].body.text).toBe("Hello there. Second sentence.");
    expect(calls[0].body.voice).toBe("F1");
    // Browser-side choices never reach the synthesis request.
    expect(calls[0].body).not.toHaveProperty("read_aloud");
    expect(calls[0].body).not.toHaveProperty("stt_provider");
    expect(calls[0].body).not.toHaveProperty("output_device");
  });

  it("a failed stream reaches the player as the gateway's reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "No voice engine is installed" }), { status: 503 })));
    const it_ = observer_tts_stream(new GatewayClient({ base_url: "" }), "r", () => ({}))("hi");
    await expect((async () => { for await (const _ of it_) void _; })()).rejects.toThrow("No voice engine is installed");
  });

  it("dictation uploads to the session, then transcribes on its media run with the gateway default route (no provider) and returns the route that ran", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: any) => {
        const u = String(url);
        if (u.endsWith("/attachments/upload")) {
          calls.push({ url: u, body: Object.fromEntries((init.body as FormData).entries()) });
          return new Response(JSON.stringify({ attachment: { $artifact: "a1" } }), { status: 200 });
        }
        calls.push({ url: u, body: JSON.parse(init.body) });
        return new Response(JSON.stringify({ ok: true, text: "hello observer", provider: "faster-whisper", model: "large-v3", duration_ms: 812 }), { status: 200 });
      }),
    );
    const transcribe = observer_transcribe(new GatewayClient({ base_url: "http://gw.test" }), "s1", "session_memory_s1", () => ({ read_aloud: true }));
    const out = await transcribe(new Blob([new Uint8Array(400)], { type: "audio/webm" }), "audio/webm;codecs=opus");
    expect(out).toEqual({ text: "hello observer", provider: "faster-whisper", model: "large-v3" });
    expect(calls[0].url).toBe("http://gw.test/api/gateway/attachments/upload");
    expect(calls[0].body.session_id).toBe("s1");
    expect(calls[1].url).toBe("http://gw.test/api/gateway/runs/session_memory_s1/audio/transcribe");
    expect(calls[1].body.audio_artifact).toEqual({ $artifact: "a1" });
    expect(calls[1].body).not.toHaveProperty("provider");
    expect(calls[1].body).not.toHaveProperty("model");
  });

  it("an override and a spoken language ride the transcription request", async () => {
    const bodies: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: any) => {
        if (String(url).endsWith("/attachments/upload")) return new Response(JSON.stringify({ attachment: { $artifact: "a1" } }), { status: 200 });
        bodies.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ ok: true, text: "x", provider: "faster-whisper", model: "small" }), { status: 200 });
      }),
    );
    await observer_transcribe(new GatewayClient({ base_url: "" }), "s1", "r1", () => ({ stt_provider: "faster-whisper", stt_model: "small", stt_language: "fr" }))(new Blob(["x"]), "audio/webm");
    expect(bodies[0]).toMatchObject({ provider: "faster-whisper", model: "small", language: "fr" });
  });

  it("a transcription that never answers fails as a sentence", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).endsWith("/attachments/upload") ? new Response(JSON.stringify({ attachment: { $artifact: "a1" } }), { status: 200 }) : new Promise<Response>(() => undefined),
      ),
    );
    const p = observer_transcribe(new GatewayClient({ base_url: "" }), "s1", "r1", () => ({}), undefined, 180_000)(new Blob(["x"]), "audio/webm");
    const expectation = expect(p).rejects.toThrow("the gateway did not answer within 180 s");
    await vi.advanceTimersByTimeAsync(180_001);
    await expectation;
  });

  it("the composer shows 'Transcribing… <elapsed> · <route>' with the gateway default route while transcribing", () => {
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const html = renderToStaticMarkup(<VoiceDictate voice={fake_voice({ voice_ptt_busy: true, voice_ptt_since: now - 4200 })} defaults={DEFAULTS} prefs={{}} />);
    expect(html).toContain("Transcribing… 4 s · faster-whisper / large-v3");
  });

  it("the microphone says why it is unavailable, and Stop appears while a reply is spoken", () => {
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => undefined } });
    const ready = renderToStaticMarkup(<VoiceDictate voice={fake_voice()} defaults={DEFAULTS} prefs={{}} />);
    expect(ready).not.toContain("disabled");
    const blocked = renderToStaticMarkup(<VoiceDictate voice={fake_voice()} defaults={DEFAULTS} prefs={{}} blocked="Connect to the gateway first." />);
    expect(blocked).toContain('title="Connect to the gateway first."');
    expect(blocked).toContain("disabled");
    const speaking = renderToStaticMarkup(<VoiceDictate voice={fake_voice({ tts_playback: { key: "m1", status: "playing" } })} defaults={DEFAULTS} prefs={{}} />);
    expect(speaking).toContain('aria-label="Stop spoken reply"');
  });

  it("a run's outcome has Read aloud, which turns into Stop while it plays", () => {
    const idle = renderToStaticMarkup(<SpeakButton voice={fake_voice()} speak_key="outcome:r1" text="The answer." />);
    expect(idle).toContain("Read aloud");
    const playing = renderToStaticMarkup(<SpeakButton voice={fake_voice({ tts_playback: { key: "outcome:r1", status: "playing" } })} speak_key="outcome:r1" text="The answer." />);
    expect(playing).toContain("Stop");
    expect(renderToStaticMarkup(<SpeakButton voice={fake_voice()} speak_key="outcome:r1" text="  " />)).toBe("");
  });

  it("the app wires the kit stack everywhere (Ask, outcome, Settings, Discuss) and keeps no local voice hook", () => {
    const app = readFileSync(resolve(__dirname, "app.tsx"), "utf8");
    const discuss = readFileSync(resolve(__dirname, "automation_discussion.tsx"), "utf8");
    expect(app).toContain("<ObserverVoiceSettings");
    expect(app).toContain("<SpeakButton");
    expect(app).toContain("<VoiceDictate");
    expect(app).toContain("use_observer_voice(");
    expect(discuss).toContain("<VoiceDictate");
    expect(discuss).toContain("use_observer_voice(");
    expect(app).not.toContain("use_gateway_voice");
    expect(() => readFileSync(resolve(__dirname, "use_gateway_voice.ts"))).toThrow();
  });
});
