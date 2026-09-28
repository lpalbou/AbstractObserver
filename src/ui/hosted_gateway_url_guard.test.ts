import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

let child: ChildProcessWithoutNullStreams | undefined;

function free_port(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function request_json(
  port: number,
  method: string,
  path: string,
  payload: Record<string, unknown> | undefined,
  host_header: string,
  extra_headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const raw = payload ? Buffer.from(JSON.stringify(payload)) : Buffer.alloc(0);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method,
        path,
        headers: {
          Host: host_header,
          Accept: "application/json",
          "Content-Type": "application/json",
          "Content-Length": String(raw.length),
          ...extra_headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode || 0, body: text ? JSON.parse(text) : {} });
        });
      },
    );
    req.on("error", reject);
    if (raw.length) req.write(raw);
    req.end();
  });
}

async function wait_ready(port: number): Promise<void> {
  const deadline = Date.now() + 5000;
  let last_error: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await request_json(port, "GET", "/api/connection/gateway", undefined, "127.0.0.1");
      if (response.status === 200) return;
    } catch (error) {
      last_error = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw last_error || new Error("AbstractObserver test server did not become ready");
}

afterEach(() => {
  child?.kill("SIGTERM");
  child = undefined;
});

async function start_observer(): Promise<number> {
  const port = await free_port();
  child = spawn(process.execPath, ["bin/cli.js"], {
    cwd: new URL("../..", import.meta.url),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      ABSTRACTOBSERVER_GATEWAY_URL: "http://127.0.0.1:65534",
    },
  });
  await wait_ready(port);
  return port;
}

const RECONFIGURE = { gateway_url: "http://127.0.0.1:65533", gateway_user_id: "alice", gateway_token: "secret" };

describe("hosted Gateway URL guard (a browser on this machine = loopback peer AND loopback Host)", () => {
  // The kit's gate (@abstractframework/app-server >= 0.1.11, requestContext
  // clientIsLoopback): the socket peer must be loopback AND the Host must name
  // loopback. A loopback peer that sends a non-local Host is a DNS-rebinding
  // page and is refused. The remote-peer half needs a second interface and is
  // covered by the kit's own tests.
  it("a loopback peer with a non-local Host (DNS rebinding) is refused at the gate", async () => {
    const port = await start_observer();
    const response = await request_json(port, "POST", "/api/connection/gateway", RECONFIGURE, "observer.abstractframework.ai");
    expect(response.status).toBe(403);
    expect(String(response.body.detail || "")).toContain("Browser-supplied Gateway URL changes are disabled");
  });

  it("a loopback peer with a loopback Host passes the gate and fails downstream on the unreachable gateway", async () => {
    const port = await start_observer();
    const response = await request_json(port, "POST", "/api/connection/gateway", RECONFIGURE, "127.0.0.1:" + String(port));
    expect(response.status).not.toBe(403);
    expect(String(response.body.detail || "")).not.toContain("Browser-supplied Gateway URL changes are disabled");
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
