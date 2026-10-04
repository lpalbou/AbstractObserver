# Troubleshooting

## “Gateway URL must start with http:// or https://”
In Settings → Gateway URL, use an absolute URL (including scheme), or leave it blank for same-origin `/api` calls.

Evidence: `on_discover_gateway()` in `src/ui/app.tsx`.

## “Mixed content is blocked” (https page → http gateway)
Browsers block `https://` pages from calling `http://` APIs.
- Use an `https://` gateway URL, or
- deploy UI + gateway behind the same `https://` origin (reverse proxy) and leave Gateway URL blank.

Evidence: mixed-content guard in `on_discover_gateway()` in `src/ui/app.tsx`.

## “Gateway URL points to localhost … from this device is not your machine”
If you opened the UI from another device (phone, tablet), `localhost` refers to that device, not your gateway host.
- Use the gateway’s LAN/public URL, or
- use a tunnel (HTTPS) to your local gateway, or
- keep same-origin via a reverse proxy.

Evidence: loopback guard in `on_discover_gateway()` in `src/ui/app.tsx`.

## The voice control says "This page is loaded over http, so voice and camera is unavailable"
You opened the Observer from another computer at a plain http address. Browsers offer the microphone only on
https or on the computer itself; everything else works. Open it through an https address (for example with
`tailscale serve`; the gateway console's Network page explains how) or on the gateway's own computer. See
`getting-started.md` → "Open the Observer from another computer over http".

## CORS errors in the browser console
Use same-origin deployment (recommended) or configure CORS on the gateway for your UI origin.
See `configuration.md`.

## Blank Gateway URL + CLI server answers 401 under /api
The packaged CLI (`bin/cli.js`) proxies same-origin `/api/...` calls to its
configured gateway only for a signed-in browser session; without one it
answers `401 Gateway sign-in required`.
- Sign in from the connection dialog (header badge), and
- check that the server points at your gateway (`--gateway-url`; see `configuration.md`).

## About shows AbstractGateway "unavailable (…)"
The About dialog could not read `GET /api/gateway/about`; the reason in
brackets says why. An HTTP 404 means the gateway does not serve the About
route: upgrade it to a version with `GET /about`. A sign-in or network error
means the session or the gateway is gone: sign in again and check the gateway
is running. The rest of the UI is unaffected. See `faq.md` → "Which version am I running?".

## Runtime → Memory shows counts but the graph canvas is blank
If Runtime → Memory shows a snapshot count (assertions/nodes/edges) but the canvas looks empty:
- click **fit view** in the graph controls (bottom-left)
- if you previously saved a layout in the memory graph, open **layout → Clear saved** (a bad saved viewport can pan you far away)

## Stale UI after updating
Production builds register a service worker (`src/main.tsx`, `public/sw.js`).
If you see stale UI assets:
- hard refresh, or
- clear site data / unregister service worker for the site.

In dev, AbstractObserver automatically unregisters service workers on load (see `src/main.tsx`).

## Automations

### Launch → Automate and the Automations page say the API is unavailable
"This gateway does not advertise the Automations API" means
`GET /api/gateway/discovery/capabilities` has no
`capabilities.contracts.common.automations` entry: upgrade AbstractGateway to a
version with automations. "This gateway has the Automations API turned off"
means the gateway reports it but disabled it; ask the gateway admin. Legacy
schedules stay manageable from their run view in both cases. See
`automations.md` → "Before you start".

### Creating an automation says the workspace "is a folder the gateway made for another conversation, run or automation"
The **Workspace Root** field (Advanced) holds a folder the gateway made for
something else. Empty the field: the gateway creates a folder of its own for
the new automation.

### Ask or Summary shows an error instead of an answer
The message is the gateway's own reason, for example an unknown provider or an
endpoint profile that no longer exists. Choose another model in the Ask
picker, or fix the gateway's default text model in its console.

### "An occurrence is already running or queued. Wait for it to finish."
HTTP 409 `automation_busy`: **Run now** (or another command) was sent while an
occurrence is in progress. Wait for it to finish, or use **Stop current** in
the automation's panel.

### "The automation changed since this view loaded. Reload it, then try again."
HTTP 409 `revision_conflict`: someone (another tab, AbstractAssistant, a
command sent moments before) revised the automation after you opened it. Select it again
and repeat the revision.

### "The automation's current state does not allow this."
HTTP 409 `invalid_state`: for example resuming an archived automation or
stopping when nothing runs. The row and panel controls explain on hover why a
control is disabled.

### A command was accepted but the row did not change
The gateway queues commands and applies them moments later. The page re-reads
the list immediately and again over the next few seconds; press **Refresh** if
it still looks unchanged, then check the automation's latest occurrence.

### A waiting run cannot be answered from the panel
The panel answers typed waits only (`ask_user`, `tool_approval`, `event`). A
wait of another kind says "This kind of wait (…) cannot be answered here; open the run." Open
the run (**Run details → Open run ledger**) and answer it from the run view.
For a tool approval that does not list its tool calls, open the run to see
them before approving. An event payload must be valid JSON.

### "The gateway listed no bundle_ref for bundle …"
Launch → Automate needs the workflow's published bundle reference from
`GET /api/gateway/bundles`. Reload bundles (Launch → Advanced), then create
again.

### Recreate as automation leaves the interval empty
The legacy interval is not a whole number of minutes, hours or days (for
example milliseconds or fractions). Choose an interval in **When**; the note
above the form names the original value.

## See also
- Getting started: `getting-started.md`
- FAQ: `faq.md`
- Automations: `automations.md`
- Configuration & deployment: `configuration.md`
- Security & trust boundaries: `security.md`
