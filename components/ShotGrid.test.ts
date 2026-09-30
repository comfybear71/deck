import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SHOT_GRID_CLASS, ShotGrid } from "./ShotGrid";

const noop = () => {};

describe("ShotGrid (shared by Shorts and Sunnybank)", () => {
  const tiles = [
    { id: "a", number: 1, pictureUrl: "https://x.test/p1.jpg", clipUrl: "https://x.test/c1.mp4", status: "rendered" as const, engine: { label: "[SIRAY]" } },
    { id: "b", number: 2, pictureUrl: "https://x.test/p2.jpg", clipUrl: null, status: "rendering" as const },
    { id: "c", number: 3, pictureUrl: null, clipUrl: null, status: "empty" as const, caption: "Two brothers arm-wrestle" },
  ];

  it("draws a tile per shot (number, status, engine chip), two across on a phone, and the add tile", () => {
    const html = renderToStaticMarkup(
      createElement(ShotGrid, { tiles, openId: null, onToggle: noop, renderPanel: () => "PANEL", onAdd: noop }),
    );
    expect(SHOT_GRID_CLASS).toBe("grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4");
    expect(html).toContain(SHOT_GRID_CLASS);
    expect(html).toContain('aria-label="Shot 1: Rendered. Open"');
    expect(html).toContain('aria-label="Shot 2: Rendering…. Open"');
    expect(html).toContain('aria-label="Shot 3: No clip. Open"');
    expect(html).toContain("[SIRAY]");
    // The clip plays over its plate (the plate is its poster).
    expect(html).toContain('poster="https://x.test/p1.jpg"');
    expect(html).toContain("No plate");
    expect(html).toContain("Two brothers arm-wrestle");
    expect(html).toContain("+ Add shot");
    expect(html).not.toContain("PANEL");
  });

  it("opens one shot's panel under the grid with its controls and a close button", () => {
    const html = renderToStaticMarkup(
      createElement(ShotGrid, { tiles, openId: "b", onToggle: noop, renderPanel: (id: string) => `CONTROLS FOR ${id}` }),
    );
    expect(html).toContain("CONTROLS FOR b");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-label="Close shot 2"');
    expect(html).not.toContain("+ Add shot");
  });

  it("a clip with no picture asks iOS Safari for its first frame", () => {
    const html = renderToStaticMarkup(
      createElement(ShotGrid, {
        tiles: [{ id: "x", number: 4, pictureUrl: null, clipUrl: "https://x.test/line4.mp4", status: "rendered" as const }],
        openId: null,
        onToggle: noop,
        renderPanel: () => null,
        labelPrefix: "Line",
      }),
    );
    expect(html).toContain('src="https://x.test/line4.mp4#t=0.1"');
    expect(html).toContain('aria-label="Line 4: Rendered. Open"');
  });
});
