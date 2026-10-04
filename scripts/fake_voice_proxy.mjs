#!/usr/bin/env node
// Fake voice in front of a scratch gateway (round 7 R7.1 e2e; no model loads).
//
// Every request is forwarded to the upstream gateway EXCEPT the voice routes,
// which answer like the real ones would on a gateway routed to
// supertonic / supertonic-3 (speech) and faster-whisper / large-v3 (text):
//   GET  /api/gateway/voice/defaults            -> the effective routes
//   GET  /api/gateway/voice/voices              -> a minimal catalog
//   POST /api/gateway/runs/{id}/voice/tts/stream -> JSON Lines, one sine WAV per sentence
//   POST /api/gateway/runs/{id}/audio/transcribe -> a fixed transcript + the route that ran
// Each intercepted request is recorded; GET /__voice_log returns the log.
//
//   node scripts/fake_voice_proxy.mjs --port 18733 --upstream http://127.0.0.1:18734 [--stt-delay-ms 2500]
import { createServer, request as httpRequest } from "node:http";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const PORT = Number(args.port || 18733);
const UPSTREAM = new URL(args.upstream || "http://127.0.0.1:18734");
const STT_DELAY_MS = Number(args["stt-delay-ms"] || 2500);
export const FAKE_TRANSCRIPT = "dictated by the fake engine";

const DEFAULTS = {
  tts: { route: "output.voice", configured: true, provider: "supertonic", model: "supertonic-3", voice: "M3" },
  stt: { route: "input.voice", configured: true, provider: "faster-whisper", model: "large-v3" },
  source: "capability_defaults",
};

function sine_wav(seconds, freq) {
  const sr = 24000;
  const n = Math.round(sr * seconds);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / sr) * 8000), 44 + i * 2);
  return buf.toString("base64");
}

const log = [];
const cors = (req) => ({
  "Access-Control-Allow-Origin": req.headers.origin || "*",
  "Access-Control-Allow-Credentials": "true",
  Vary: "Origin",
});
const json = (req, res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json", ...cors(req) });
  res.end(JSON.stringify(body));
};
const read_body = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Only signed-in requests are answered: a bearer token, or an app server's gateway session (x-abstractgateway-session).
const signed_in = (req) => Boolean(req.headers.authorization || req.headers["x-abstractgateway-session"]);

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://x");
  const p = url.pathname;
  if (p === "/__voice_log") return json(req, res, 200, log);
  if (req.method === "OPTIONS" && /\/api\/gateway\/(voice|runs\/[^/]+\/(voice|audio))\//.test(p)) {
    res.writeHead(204, { ...cors(req), "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": req.headers["access-control-request-headers"] || "*" });
    return res.end();
  }
  let m;
  if (req.method === "GET" && p === "/api/gateway/voice/defaults") {
    log.push({ t: Date.now(), route: "voice/defaults" });
    return signed_in(req) ? json(req, res, 200, DEFAULTS) : json(req, res, 401, { detail: "Not signed in" });
  }
  if (req.method === "GET" && p === "/api/gateway/voice/voices") {
    log.push({ t: Date.now(), route: "voice/voices", query: url.search });
    return json(req, res, 200, {
      items: [{ id: "M3", label: "M3", provider: "supertonic", model: "supertonic-3", voice_kind: "preset" }],
      tts_providers: ["supertonic"],
      stt_providers: ["faster-whisper"],
      gateway_defaults: DEFAULTS,
      active_tts_provider: "supertonic",
      active_stt_provider: "faster-whisper",
    });
  }
  if (req.method === "POST" && (m = /^\/api\/gateway\/runs\/([^/]+)\/voice\/tts\/stream$/.exec(p))) {
    const body = JSON.parse((await read_body(req)).toString() || "{}");
    const t0 = Date.now();
    const entry = { t: t0, route: "voice/tts/stream", run_id: decodeURIComponent(m[1]), body, first_chunk_ms: null, done: false };
    log.push(entry);
    if (!signed_in(req)) return json(req, res, 401, { detail: "Not signed in" });
    res.writeHead(200, { "Content-Type": "application/x-ndjson", ...cors(req) });
    res.write(JSON.stringify({ type: "start", child_run_id: "fake-tts-child" }) + "\n");
    const sentences = String(body.text || "").split(/(?<=[.!?])\s+/).filter(Boolean);
    let closed = false;
    req.on("close", () => (closed = true));
    for (let i = 0; i < Math.max(1, sentences.length); i++) {
      await sleep(i === 0 ? 150 : 400);
      if (closed) return;
      if (entry.first_chunk_ms === null) entry.first_chunk_ms = Date.now() - t0;
      res.write(JSON.stringify({ type: "chunk", index: i, text: sentences[i] || "", audio_b64: sine_wav(1.2, 330 + 110 * i) }) + "\n");
    }
    entry.done = true;
    res.end(JSON.stringify({ type: "done", metrics: { ttfb_s: entry.first_chunk_ms / 1000, device: "fake" } }) + "\n");
    return;
  }
  if (req.method === "POST" && (m = /^\/api\/gateway\/runs\/([^/]+)\/audio\/transcribe$/.exec(p))) {
    const body = JSON.parse((await read_body(req)).toString() || "{}");
    log.push({ t: Date.now(), route: "audio/transcribe", run_id: decodeURIComponent(m[1]), body });
    if (!signed_in(req)) return json(req, res, 401, { detail: "Not signed in" });
    await sleep(STT_DELAY_MS);
    return json(req, res, 200, { ok: true, run_id: decodeURIComponent(m[1]), text: FAKE_TRANSCRIPT, provider: body.provider || "faster-whisper", model: body.model || "large-v3", duration_ms: STT_DELAY_MS });
  }
  // Everything else: the real scratch gateway.
  const up = httpRequest(
    { host: UPSTREAM.hostname, port: UPSTREAM.port, method: req.method, path: req.url, headers: { ...req.headers, host: `${UPSTREAM.hostname}:${UPSTREAM.port}` } },
    (ur) => {
      res.writeHead(ur.statusCode || 502, ur.headers);
      ur.pipe(res);
    },
  );
  up.on("error", (e) => json(req, res, 502, { detail: `upstream: ${e.message}` }));
  req.pipe(up);
});
server.listen(PORT, "127.0.0.1", () => console.log(JSON.stringify({ fake_voice_proxy: `http://127.0.0.1:${PORT}`, upstream: UPSTREAM.href })));
