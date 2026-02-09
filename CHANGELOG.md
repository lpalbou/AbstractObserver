# Changelog

## Unreleased
- Docs: align npm install/run commands with the scoped package name (`@abstractframework/observer`) and refresh core docs for ecosystem context and voice endpoints.

## 0.1.6 (2026-02-05)
- Package: publish as `@abstractframework/observer` (CLI binary remains `abstractobserver`).
- UI: Mindmap: layout toolbar (algorithm + spread + apply + force simulation play/pause), Search KG panel is inside the canvas, and blank/offscreen views auto-recover.
- UI: Chat: unify chat UX (cards + composer) across Backlog → Advisor and Observe → Chat (shared `@abstractuic/panel-chat` styling).
- UI: Voice: gateway-based TTS + push-to-talk transcription (matches AbstractCode) and available in Observe → Chat and Backlog → Advisor.

## 0.1.4 (2026-02-04)
- Docs: refresh documentation for public release (README, getting started, docs index, API contract, FAQ).
- Docs: add security policy (`SECURITY.md`), contributing guide, and acknowledgments.
- Docs: align `llms.txt` with the `llms.txt` spec and keep `llms-full.txt` in sync.
- UI: align theme with AbstractFlow (tokens, typography, inputs/buttons, scrollbars).
- UI: new header with status pills; run picker and ledger cards use clearer labels + relative time.
- UI: digest and chat timestamps use relative time (falls back to date after 3d).
- Fix: Mindmap UI: resilient render (auto-recovers blank/offscreen view), legend toggle in graph controls, minimap toggle near the preview, and timeline reaches the latest snapshot.
- Tests: `npm test`
- Build: `npm run build`

## 0.1.3 (2026-01-11)
- UI: Digest stays up to date and includes per-subflow stats (polls discovered subrun ledgers).
- UI: Digest adds a ledger-based SUMMARY section with Generate/Regenerate and an “outdated” indicator.

## 0.1.2 (2026-01-11)
- UI: run picker dropdown is wider and viewport-safe (opens up when needed; never clipped).
- UI: “Existing Runs” shows only parent runs (filters out subruns) and uses the improved run picker.

## 0.1.1 (2026-01-11)
- UI: replace bundle-info block with a single **Start Workflow** primary action (modal-based start).
- UI: simplify Run controls (run picker + refresh; pause/resume; cancel).
- UI: upgrade run picker to a badge-based, aligned list (readable + status color coding).
- UI: move Remote Tool Worker (MCP) settings into the Start Workflow modal (advanced).
- Docs: add `abstractobserver/docs/architecture.md` and link it from the framework architecture overview.

## 0.1.0
- Initial release.
