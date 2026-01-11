import { describe, expect, it } from "vitest";

import { SseParser } from "./sse_parser";

describe("SseParser", () => {
  it("parses id/event/data blocks and dispatches on blank line", () => {
    const parser = new SseParser();
    const events: Array<{ id?: string; event?: string; data?: string }> = [];

    const input =
      "id: 1\n" +
      "event: step\n" +
      "data: {\"cursor\": 1, \"record\": {\"status\": \"started\"}}\n" +
      "\n" +
      ": keep-alive\n" +
      "\n" +
      "id: 2\n" +
      "event: step\n" +
      "data: line1\n" +
      "data: line2\n" +
      "\n";

    // Push in chunks to simulate streaming.
    parser.push(input.slice(0, 15), (ev) => events.push(ev));
    parser.push(input.slice(15), (ev) => events.push(ev));

    expect(events.length).toBe(2);
    expect(events[0].id).toBe("1");
    expect(events[0].event).toBe("step");
    expect(events[0].data).toContain("\"cursor\": 1");

    expect(events[1].id).toBe("2");
    expect(events[1].event).toBe("step");
    expect(events[1].data).toBe("line1\nline2");
  });
});


