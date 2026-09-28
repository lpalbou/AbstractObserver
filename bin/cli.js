#!/usr/bin/env node

/**
 * AbstractObserver: serves the built app. Standalone at http://<host>:<port>/,
 * or through the gateway at /apps/observer/ (the gateway relays to this
 * server on 127.0.0.1; see bin/server.js).
 *
 *   abstractobserver [--gateway-url <url>] [--port <n>] [--host <addr>]
 *                    [--monitor-gpu] [--entity-app-url <url>] [--gateway-dir <dir>]
 *
 * Environment variables are legacy aliases below the flags (PORT, HOST,
 * ABSTRACTOBSERVER_GATEWAY_URL, ABSTRACTGATEWAY_URL, ABSTRACTOBSERVER_MONITOR_GPU,
 * ABSTRACTOBSERVER_ENTITY_APP_URL, ABSTRACTOBSERVER_GATEWAY_DIR).
 */

import * as http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createGatewayUrlResolver, parseAppFlagsOrExit } from "@abstractframework/app-server";

import { createObserverHandler } from "./server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const TRUE = ["1", "true", "yes", "on"];

const flags = parseAppFlagsOrExit(process.argv.slice(2), {
  appName: "AbstractObserver",
  command: "abstractobserver",
  envPrefix: "ABSTRACTOBSERVER",
  defaultPort: 3001,
  extra: {
    "monitor-gpu": { type: "boolean", help: "Show the gateway host's GPU monitor in the header." },
    "entity-app-url": { type: "string", metavar: "url", help: "Where the entity app lives (the Entities ↗ links)." },
    "gateway-dir": {
      type: "string",
      metavar: "dir",
      help: "Folder that relative workspace roots are resolved against for the local folder reveal (default: this package's parent folder).",
    },
  },
});

// The gateway URL follows the local gateway pointer (a gateway that moves
// port is followed) unless a flag or a legacy variable chose it.
const gatewayUrl =
  flags.gatewayUrlSource === "flag" || flags.gatewayUrlSource.startsWith("env:")
    ? flags.gatewayUrl
    : createGatewayUrlResolver({});

const handler = createObserverHandler({
  distDir: join(HERE, "..", "dist"),
  gatewayUrl,
  monitorGpu: Boolean(flags.extra["monitor-gpu"]) || TRUE.includes(String(process.env.ABSTRACTOBSERVER_MONITOR_GPU || "").trim().toLowerCase()),
  entityAppUrl: String(flags.extra["entity-app-url"] || process.env.ABSTRACTOBSERVER_ENTITY_APP_URL || ""),
  gatewayDir: String(flags.extra["gateway-dir"] || process.env.ABSTRACTOBSERVER_GATEWAY_DIR || join(HERE, "..", "..")),
});

const server = http.createServer(handler);
server.listen(flags.port, flags.host, () => {
  const gw = typeof gatewayUrl === "string" ? gatewayUrl : gatewayUrl.current();
  console.log(`AbstractObserver on http://${flags.host}:${flags.port}/ (gateway ${gw}, ${flags.gatewayUrlSource})`);
  console.log("Through the gateway: <gateway>/apps/observer/");
});

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(0));
