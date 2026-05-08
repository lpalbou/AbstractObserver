# Proposed: Gateway Capability Profile Alignment

## Metadata
- Created: 2026-05-08
- Status: Proposed
- Completed: N/A

## Context

AbstractObserver is a browser/static UI that talks to AbstractGateway. It should observe and control
Gateway deployments without depending on Core, Runtime, provider SDKs, local model engines, memory
stores, or media capability packages.

Gateway now distinguishes:

- lightweight Python/server deployments;
- full native Python Apple and GPU deployments;
- Docker lightweight server and explicit NVIDIA server image.

## Problem

Observer is the natural place for operators to inspect deployment readiness. If it hardcodes old
profile assumptions, it can misreport whether generated media, voice, music, memory, prompt-cache,
tools, CORS/auth, or GPU monitoring are available.

## Proposed Direction

Use Gateway capability/readiness contracts as the only source of truth:

- display the connected Gateway profile, server mode, Docker/native hints, and capability readiness
  when Gateway exposes them;
- surface missing or unconfigured Vision, Voice, Music, Memory, prompt-cache, and tool-policy states
  from Gateway responses;
- keep GPU monitoring optional and Gateway-sourced;
- keep the Observer package as a static UI/CLI package with no backend engine dependencies.

## Detailed Plan

1. Add a deployment readiness model.
   - Parse Gateway version, install profile, Docker/native hints, server mode, auth/origin status,
     data directory/store status, runner mode, and capability contract versions when exposed.
   - Represent unknown fields explicitly for older Gateway deployments.

2. Build a capability dashboard.
   - Show provider/model defaults and catalog availability.
   - Show Vision, Voice, Music, Memory, Semantics, prompt-cache, tools, workspace policy, and
     artifact support as ready, installed-but-unconfigured, missing, or disabled.
   - Distinguish lightweight server, native Apple, native GPU, and NVIDIA Docker deployment shapes.

3. Improve generated-media observability.
   - Render generated images, audio/voice outputs, music artifacts, and cloned/generated resources
     from ledger/history/artifact APIs.
   - Keep artifact provenance visible: run id, step id, artifact id, content type, and source
     capability when Gateway provides it.
   - Avoid inferring media capability from file extension alone.

4. Expand operations panels.
   - Keep GPU monitoring behind Gateway host metrics.
   - Add memory/KG readiness and query capability labels: volatile, structured-only, vector-capable.
   - Surface tool approval defaults and workspace write policy for operator review.

5. Test with Gateway fixtures.
   - Add fixture payloads for lightweight, Apple-native, GPU-native, NVIDIA Docker, missing memory,
     missing voice, and older Gateway contract responses.
   - Keep same-origin and cross-origin auth/CORS test coverage.

## Non-Goals

- Do not add Python backend package dependencies to Observer.
- Do not make Observer infer capability readiness from package names or local machine state.
- Do not store provider credentials in Observer beyond the Gateway token needed to call the API.

## Promotion Criteria

Promote when Gateway 0.2.4+ readiness fields are stable enough to expose in the UI, or when Observer
adds deployment/profile dashboards.

## Expected Outcomes

- Observer becomes the operator-facing truth for what the connected Gateway can actually do.
- Generated media, memory, voice, music, prompt-cache, tool policy, workspace policy, and host
  metrics are visible without local package inspection.
- Older or partially configured Gateway deployments degrade explicitly.

## Validation Ideas

- UI tests with Gateway fixtures for lightweight, native Apple, native GPU, and NVIDIA Docker
  readiness payloads.
- Regression tests for disabled/missing capability states.
- Manual smoke behind same-origin and cross-origin Gateway deployments.

## Guidance For Implementing Agents

Start from the current `GatewayClient` endpoint list. Add typed readiness parsing before adding UI
panels, so profile/status labels stay tied to Gateway contracts.
