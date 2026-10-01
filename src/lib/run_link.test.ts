// The run deep link `#run/<run_id>`: other apps (the gateway console's account
// Logs) open one run in Observe at `/apps/observer/#run/<run_id>`.
import { afterEach, describe, expect, it } from "vitest";

import { RUN_HASH_PREFIX, run_hash, run_id_from_location, run_id_from_run_hash, run_link_missing_message } from "./app_paths";
import { GatewayClient, GatewayRequestError } from "./gateway_client";
import { parse_app_hash } from "../ui/automations";

const RUN = "0f3c2c55-8f9e-4bd5-9d7a-2b1f7c1e9a10";

describe("#run/<run_id>: the address of one run", () => {
  it("round-trips a run id, uuid or not, through the hash", () => {
    expect(RUN_HASH_PREFIX).toBe("#run/");
    expect(run_hash(RUN)).toBe(`#run/${RUN}`);
    expect(run_id_from_run_hash(run_hash(RUN))).toBe(RUN);
    expect(run_id_from_run_hash(run_hash("run:a b"))).toBe("run:a b");
    expect(run_hash("run:a b")).toBe("#run/run%3Aa%20b");
  });

  it("reads only #run/<one segment>; every other hash is not a run link", () => {
    for (const h of ["", "#", "#run", "#run/", "#run/a/b", "#automations", `#observe/${RUN}`, `#${RUN}`, "#run/%E0%A4%A"]) {
      expect(run_id_from_run_hash(h)).toBe("");
    }
  });

  it("is one of the app's hash routes, beside #launch and #automations", () => {
    expect(parse_app_hash(`#run/${RUN}`)).toEqual({ page: "run", run_id: RUN });
    expect(parse_app_hash("#run/session_run_7")).toEqual({ page: "run", run_id: "session_run_7" });
    expect(parse_app_hash("#run/")).toBeNull();
    expect(parse_app_hash("#automations")).toEqual({ page: "automations" });
  });

  it("opens the run at load wherever the app is mounted, a non-uuid id included", () => {
    expect(run_id_from_location({ hash: `#run/${RUN}`, pathname: "/apps/observer/" })).toBe(RUN);
    expect(run_id_from_location({ hash: "#run/session_run_7", pathname: "/apps/observer/" })).toBe("session_run_7");
    expect(run_id_from_location({ hash: "#run/session_run_7", pathname: "/" })).toBe("session_run_7");
  });

  it("says plainly why a linked run cannot be opened", () => {
    expect(run_link_missing_message(RUN)).toBe(
      `Run ${RUN} cannot be opened: it does not exist on this gateway, or your account cannot see it.`,
    );
  });
});

describe("GatewayClient.find_run: the run behind a link, or null", () => {
  const real = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = real;
  });
  function answer(status: number, body: unknown): string[] {
    const urls: string[] = [];
    globalThis.fetch = (async (u: any) => {
      urls.push(String(u));
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    }) as any;
    return urls;
  }

  it("returns the run the gateway shows", async () => {
    const urls = answer(200, { run_id: RUN, status: "completed" });
    expect(await new GatewayClient({ base_url: "", auth_token: "" }).find_run(RUN)).toEqual({ run_id: RUN, status: "completed" });
    expect(urls).toEqual([`api/gateway/runs/${RUN}`]);
  });

  it("is null for an unknown run or another user's run (404) and a run this account may not see (403)", async () => {
    answer(404, { detail: `Run '${RUN}' not found` });
    expect(await new GatewayClient({ base_url: "", auth_token: "" }).find_run(RUN)).toBeNull();
    answer(403, { detail: "Forbidden" });
    expect(await new GatewayClient({ base_url: "", auth_token: "" }).find_run(RUN)).toBeNull();
  });

  it("throws the gateway's reason for any other refusal", async () => {
    answer(500, { detail: "Failed to load run: disk" });
    const e = await new GatewayClient({ base_url: "", auth_token: "" }).find_run(RUN).catch((x) => x);
    expect(e).toBeInstanceOf(GatewayRequestError);
    expect(e.message).toBe("Opening the run failed (HTTP 500): Failed to load run: disk");
  });
});
