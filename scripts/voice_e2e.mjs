#!/usr/bin/env node
// Observer voice end-to-end (round 7 R7.1) against a scratch gateway behind
// scripts/fake_voice_proxy.mjs (fake speech + transcription routes; no model
// loads). Exits non-zero on the first failed check.
//
//   node scripts/voice_e2e.mjs --app http://127.0.0.1:18735 --gw http://127.0.0.1:18733 \
//     [--token abstractcode-e2e-only] [--user web-tester] [--shots <dir>]
//
// Checks (each one names what it proves):
//   1. Settings → Voice is the kit section and reads GET /voice/defaults:
//      "Gateway default · supertonic / supertonic-3" and
//      "Gateway default · faster-whisper / large-v3"; "openai" appears nowhere.
//   2. A run's outcome → Read aloud streams POST /runs/<media run>/voice/tts/stream
//      (never the watched run), plays the sentence WAVs, and Stop ends it.
//   3. Ask → dictation: tap, speak (Chromium's fake microphone), tap; the status
//      reads "Recording… N s" then "Transcribing… N s · faster-whisper / large-v3";
//      the transcript lands in the composer; the request names no provider
//      (= the gateway default route).
//   4. Automations → Discuss → the same dictation fills the discussion draft.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const APP = args.app || "http://127.0.0.1:18735";
const GW = args.gw || "http://127.0.0.1:18733";
const TOKEN = args.token || "abstractcode-e2e-only";
const USER = args.user || "web-tester";
const SHOTS = args.shots ? path.resolve(args.shots) : "";
const WIDTH = Number(args.width || 1440);
const HEIGHT = Number(args.height || 900);
const SCHEME = args.scheme === "dark" ? "dark" : "light";
const TAG = `${WIDTH}-${SCHEME}`;
const TRANSCRIPT = "dictated by the fake engine";
const { chromium } = createRequire(path.join(HERE, "../package.json"))("playwright");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) throw new Error(`FAILED: ${name} ${detail}`);
}
async function api(p, init = {}) {
  const r = await fetch(`${GW}/api/gateway/${p}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status} ${await r.text()}`);
  return r.json();
}
const voice_log = async () => (await fetch(`${GW}/__voice_log`)).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000, step = 200) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) return v;
    await sleep(step);
  }
}

// ── Seed: a finished run with an outcome sentence, and an automation with a finished occurrence. ──
const OUTCOME = "Stopped for the voice test. The outcome is read aloud.";
const started = await api("runs/start", { method: "POST", body: JSON.stringify({ bundle_id: "abstractcode-web-e2e", flow_id: "prompt-structured", input_data: { prompt: "hello" } }) });
const RUN = started.run_id;
await until(async () => (await api(`runs/${RUN}`)).status === "waiting");
await api("commands", { method: "POST", body: JSON.stringify({ command_id: `c-${Date.now()}`, run_id: RUN, type: "cancel", payload: { reason: OUTCOME } }) });
await until(async () => (await api(`runs/${RUN}`)).status === "cancelled");
const auto_title = `Voice discuss ${Date.now()}`;
const created = await api("automations", {
  method: "POST",
  body: JSON.stringify({
    request_id: `voice-${Date.now()}`,
    title: auto_title,
    target: { bundle_ref: "abstractcode-web-e2e@0.0.1", flow_id: "prompt-structured", input_data: { prompt: "Say hi" } },
    trigger: { source_id: "manual", source_version: 1, config: {} },
  }),
});
const AUTO = created.automation_id;
await api(`automations/${AUTO}/commands`, { method: "POST", body: JSON.stringify({ type: "automation.run_now", command_id: `rn-${Date.now()}` }) });
const occ_run = await until(async () => {
  const s = await api(`automations/${AUTO}`);
  const last = (s.summary || s).last_occurrence;
  return last && last.run_id && ["waiting", "running", "completed", "failed", "cancelled"].includes(String(last.status)) ? last.run_id : "";
}, 30000);
if (occ_run) {
  await api(`automations/${AUTO}/commands`, { method: "POST", body: JSON.stringify({ type: "automation.stop_current", command_id: `st-${Date.now()}` }) }).catch(() => undefined);
  await until(async () => ["completed", "failed", "cancelled"].includes(String(((await api(`automations/${AUTO}`)).summary || {}).last_occurrence?.status)), 20000);
}

const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, colorScheme: SCHEME, isMobile: WIDTH < 600, hasTouch: WIDTH < 600, permissions: ["microphone"] });
// The Observer's own appearance setting decides its theme (default dark): set it for the light captures.
await ctx.addInitScript((theme) => localStorage.setItem("af_appearance_abstractobserver_v1", JSON.stringify({ theme })), SCHEME);
const page = await ctx.newPage();
const metrics = [];
const shot = async (name) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.${TAG}.png`) });
  metrics.push({ shot: name, viewport: WIDTH, scheme: SCHEME, overflowX: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1) });
};
const nav = async (label) => {
  const item = page.locator(".shell_nav_item", { hasText: label }).first();
  if (!(await item.isVisible())) {
    await page.locator("[data-nav-toggle]").first().click();
    await item.waitFor({ state: "visible", timeout: 5000 });
  }
  await item.click();
  await page.waitForTimeout(1200);
};
// Narrow screens show the run list or the run: open the list when it is collapsed.
const open_list = async (sel) => {
  const btn = page.locator(`${sel} .list_disclosure`).first();
  if ((await btn.count()) && (await btn.getAttribute("aria-expanded")) === "false") await btn.click();
};
let exit = 0;
try {
  await page.goto(APP);
  await page.locator("#gateway-session-url").waitFor({ timeout: 20000 });
  await page.locator("#gateway-session-url").fill(GW);
  await page.locator("#gateway-session-user").fill(USER);
  await page.locator("#gateway-session-token").fill(TOKEN);
  await page.locator("#gateway-session-token").press("Enter");
  await page.locator("#gateway-session-url").waitFor({ state: "hidden", timeout: 20000 });
  await page.waitForTimeout(2500);

  // 1. Settings → Voice
  await nav("Settings");
  const section = page.locator('[data-settings-section="voice"]');
  await section.scrollIntoViewIfNeeded();
  const tts_default = await until(async () => (await section.innerText()).includes("Gateway default · supertonic / supertonic-3"));
  const text = await section.innerText();
  check("Settings → Voice names the TTS route from /voice/defaults", tts_default);
  check("Settings → Voice names the STT route from /voice/defaults", text.includes("Gateway default · faster-whisper / large-v3"));
  check("'openai' appears nowhere in Settings → Voice", !/openai/i.test(text));
  check("the defaults came from GET /voice/defaults", (await voice_log()).some((e) => e.route === "voice/defaults"));
  await shot("settings-voice");

  // 2. Outcome → Read aloud
  await nav("Observe");
  const back = page.locator(".observe_back_btn");
  if (await back.isVisible().catch(() => false)) await back.click();
  await open_list(".observatory_sidebar");
  await page.locator(".run_tree_item", { hasText: RUN.slice(0, 8) }).first().click();
  const speak = page.locator('[data-action="read-aloud"]').first();
  await speak.waitFor({ timeout: 15000 });
  const t_click = Date.now();
  await speak.click();
  const playing = await until(async () => (await speak.getAttribute("data-speak-state")) === "playing", 10000, 50);
  const t_play = Date.now() - t_click;
  const tts = (await voice_log()).filter((e) => e.route === "voice/tts/stream").at(-1);
  check("Read aloud plays the outcome (state 'playing')", playing, `click→playing ${t_play} ms`);
  check("the outcome streams over /runs/<media run>/voice/tts/stream", tts && /^session_memory_/.test(tts.run_id) && tts.run_id !== RUN, tts ? tts.run_id : "no request");
  check("the streamed text is the outcome sentence", tts && tts.body.text.includes(OUTCOME), tts ? JSON.stringify(tts.body.text) : "");
  check("the synthesis request names no engine (= the gateway default route)", tts && !("provider" in tts.body) && !("model" in tts.body));
  await shot("outcome-playing");
  await speak.click(); // Stop
  check("Stop ends the reading", await until(async () => (await speak.getAttribute("data-speak-state")) === "idle", 3000, 50));

  // 3. Ask → dictation
  await page.getByRole("tab", { name: /^Ask$/ }).first().click().catch(async () => page.getByRole("button", { name: /^Ask$/ }).first().click());
  const mic = page.locator('.chat_composer [data-action="dictate"]').first();
  await mic.waitFor({ timeout: 10000 });
  const dictate = async (scope, button) => {
    await button.click(); // tap = start (latched)
    const rec = await until(async () => /Recording… \d+ s/.test((await scope.locator("[data-voice-status]").first().textContent().catch(() => "")) || ""), 8000, 100);
    await sleep(1600);
    await button.click(); // tap again = stop + transcribe
    const tr = await until(async () => /^Transcribing… \d+ s · faster-whisper \/ large-v3$/.test(((await scope.locator("[data-voice-status]").first().textContent().catch(() => "")) || "").trim()), 8000, 100);
    return { rec, tr };
  };
  const ask = await dictate(page.locator(".chat_composer"), mic);
  check("Ask: 'Recording… N s' while the microphone records", ask.rec);
  check("Ask: 'Transcribing… N s · faster-whisper / large-v3' while the gateway transcribes", ask.tr);
  await shot("ask-transcribing");
  const filled = await until(async () => (await page.locator(".chat_composer textarea").first().inputValue()).includes(TRANSCRIPT), 10000);
  check("Ask: the transcript lands in the composer", filled);
  const stt = (await voice_log()).filter((e) => e.route === "audio/transcribe").at(-1);
  check("Ask: transcription rides the media run with no provider (= gateway default input.voice)", stt && /^session_memory_/.test(stt.run_id) && !("provider" in stt.body) && stt.body.audio_artifact?.$artifact, stt ? JSON.stringify(stt.body) : "none");
  await shot("ask-transcribed");

  // 4. Automations → Discuss → dictation
  await nav("Automations");
  await open_list(".auto_list");
  await page.getByText(auto_title).first().click();
  await page.waitForTimeout(1500);
  const discuss_btn = page.getByRole("button", { name: "Discuss", exact: true }).first();
  await discuss_btn.click();
  const disc = page.locator(".auto_discussion");
  await disc.waitFor({ timeout: 10000 });
  const dmic = disc.locator('[data-action="dictate"]').first();
  await dmic.waitFor({ timeout: 10000 });
  const d = await dictate(disc, dmic);
  check("Discuss: 'Recording… N s' then 'Transcribing… N s · faster-whisper / large-v3'", d.rec && d.tr);
  const dfilled = await until(async () => (await disc.locator("textarea").first().inputValue()).includes(TRANSCRIPT), 10000);
  check("Discuss: the transcript lands in the discussion draft", dfilled);
  await shot("discuss-transcribed");
} catch (e) {
  exit = 1;
  console.error(String(e?.message || e));
  await shot("failure").catch(() => undefined);
} finally {
  await browser.close();
  if (SHOTS) fs.writeFileSync(path.join(SHOTS, `results.${TAG}.json`), JSON.stringify({ run: RUN, automation: AUTO, results, metrics }, null, 2));
}
process.exit(exit);
