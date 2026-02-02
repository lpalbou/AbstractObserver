import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Icon, type IconName } from "@abstractuic/ui-kit";

describe("AbstractObserver icons", () => {
  it("supports action icons used in the Backlog UI", () => {
    const names: IconName[] = ["plus", "refresh", "copy", "edit", "trash", "terminal", "settings"];
    for (const name of names) {
      const html = renderToStaticMarkup(<Icon name={name} size={16} title={name} />);
      expect(html).toContain("<svg");
      expect(html).toContain("stroke=");
      expect(html).toMatch(/<path|<rect/);
    }
  });
});
