// The shared top-bar set (operator ruling 2026-10-29: "change the widget once,
// it changes everywhere"): the docs drawer button, the theme picker
// (Appearance), the About dialog and the account widget are the KIT's
// components, never local copies. The app passes all four to the kit's
// AfTopBarActions; the Appearance it opens is the kit's AfAppearanceDialog and
// the docs drawer is panel-chat's DocsAssistantDrawer. Removing a piece from
// app.tsx (or re-implementing one locally) turns this red.
import React from "react";
import { readFileSync } from "fs";
import { resolve } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AfTopBarActions } from "@abstractframework/ui-kit";

import { observer_identity } from "./about";

const SRC = (name: string) => readFileSync(resolve(__dirname, name), "utf8");

/** The props text of the first `<Tag ... />` in `src` (brace-aware: `/>` inside `{...}` does not end it). */
function jsx_props(src: string, tag: string): string {
  const start = src.indexOf(`<${tag}`);
  expect(start, `<${tag} in app.tsx`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (depth === 0 && c === "/" && src[i + 1] === ">") return src.slice(start, i);
  }
  throw new Error(`<${tag} is never closed`);
}

describe("the shared top-bar set", () => {
  const app = SRC("app.tsx");
  const bar = jsx_props(app, "AfTopBarActions");

  it("passes the four kit pieces to AfTopBarActions", () => {
    expect(bar).toMatch(/\bdocs=\{\{ open: assistant_open,/);
    expect(bar).toMatch(/\bappearance=\{\{ onOpen: /);
    expect(bar).toMatch(/\babout=\{\{ identity: about_identity,/);
    // The ONE account widget needs identity + the connection status it reads the principal from.
    expect(bar).toContain('identity="menu"');
    expect(bar).toMatch(/status: gateway_connection\.status/);
  });

  it("opens the kit's dialogs and drawer, never local copies", () => {
    expect(app).toMatch(/import \{[^}]*\bAfAppearanceDialog\b[^}]*\} from "@abstractframework\/ui-kit"/);
    expect(jsx_props(app, "AfAppearanceDialog")).toMatch(/open=\{appearance_open\}/);
    expect(SRC("app_assistant.tsx")).toMatch(/import \{ DocsAssistantDrawer[^}]*\} from "@abstractframework\/panel-chat"/);
    for (const local of [/function \w*About\w*Dialog/, /function \w*Appearance\w*Dialog/, /Signed in as/, /af-topbar__/]) expect(app).not.toMatch(local);
  });

  it("the installed kit renders the set with the one account widget (ui-kit ^0.9.6)", () => {
    const status = { ok: true, has_session: true, gateway_url: "http://gw.local:8080", gateway: { ok: true, principal: { user_id: "alice" } } };
    const html = renderToStaticMarkup(
      <AfTopBarActions
        docs={{ open: false, onToggle: () => {} }}
        appearance={{ onOpen: () => {} }}
        about={{ identity: observer_identity() }}
        identity="menu"
        connection={{ phase: "connected", onConnect: () => {}, onDisconnect: () => {}, status }}
      />
    );
    const at = ["af-topbar__btn--docs", "af-topbar__btn--appearance", "af-topbar__btn--about", 'data-af-identity="menu"'].map((m) => html.indexOf(m));
    expect(at.every((v, i) => v >= 0 && (i === 0 || v > at[i - 1]))).toBe(true);
    expect(html).toContain('<span class="af-topbar__identity-label">alice</span>');
    expect(html).not.toContain("af-topbar__pill");
  });
});
