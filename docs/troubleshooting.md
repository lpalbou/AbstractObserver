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

## CORS errors in the browser console
Use same-origin deployment (recommended) or configure CORS on the gateway for your UI origin.
See `configuration.md`.

## Blank Gateway URL + CLI server shows 404s under /api
The packaged CLI (`bin/cli.js`) is a static server and does not proxy `/api`.
- Set **Gateway URL** to your gateway base URL (e.g. `http://localhost:8081`), or
- deploy behind a reverse proxy so the UI and gateway are same-origin and `/api` routes to the gateway.

## Mindmap shows counts but the graph canvas is blank
If Mindmap shows a snapshot count (assertions/nodes/edges) but the canvas looks empty:
- click **fit view** in the graph controls (bottom-left)
- if you previously saved a layout in Mindmap, open **layout → Clear saved** (a bad saved viewport can pan you far away)

## Stale UI after updating
Production builds register a service worker (`src/main.tsx`, `public/sw.js`).
If you see stale UI assets:
- hard refresh, or
- clear site data / unregister service worker for the site.

In dev, AbstractObserver automatically unregisters service workers on load (see `src/main.tsx`).

## See also
- Getting started: `getting-started.md`
- FAQ: `faq.md`
- Configuration & deployment: `configuration.md`
- Security & trust boundaries: `security.md`
