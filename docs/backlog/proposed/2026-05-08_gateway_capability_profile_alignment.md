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

## Non-Goals

- Do not add Python backend package dependencies to Observer.
- Do not make Observer infer capability readiness from package names or local machine state.
- Do not store provider credentials in Observer beyond the Gateway token needed to call the API.

## Promotion Criteria

Promote when Gateway 0.2.4+ readiness fields are stable enough to expose in the UI, or when Observer
adds deployment/profile dashboards.

## Validation Ideas

- UI tests with Gateway fixtures for lightweight, native Apple, native GPU, and NVIDIA Docker
  readiness payloads.
- Regression tests for disabled/missing capability states.
- Manual smoke behind same-origin and cross-origin Gateway deployments.

## Guidance For Implementing Agents

Start from the current `GatewayClient` endpoint list. Add typed readiness parsing before adding UI
panels, so profile/status labels stay tied to Gateway contracts.
