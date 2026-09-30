import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EpisodeCardsRow } from "./EpisodeCardsRow";
import { CharacterProfileFields } from "./CharacterProfileFields";

const noop = () => {};

describe("EpisodeCardsRow (shared by Sunnybank and Shorts)", () => {
  it("draws each card with its bin, pencil and zip, the open one ringed, and + New last", () => {
    const html = renderToStaticMarkup(
      createElement(EpisodeCardsRow, {
        cards: [
          { id: "a", label: "EP01 · BLONDE GIRL _1", sub: "7 shots · 6 clips", clipUrl: "https://x.test/1.mp4", active: true },
          { id: "b", label: "EP02 · Beach", sub: "1 shot · 0 clips", clipUrl: null, active: false },
        ],
        busy: false,
        confirmDeleteId: "b",
        downloadingId: null,
        notice: { text: "Tap the bin again to delete EP02 · Beach.", tone: "warn" },
        onOpen: noop,
        onEdit: noop,
        onDelete: noop,
        onDownload: noop,
        onNew: noop,
      }),
    );
    expect(html).toContain("Episodes");
    expect(html).toContain('aria-label="Open EP01 · BLONDE GIRL _1" aria-pressed="true"');
    expect(html).toContain('aria-label="Tap again to delete EP02 · Beach"');
    expect(html).toContain('aria-label="Download EP01 · BLONDE GIRL _1 (.zip)"');
    expect(html).toContain('src="https://x.test/1.mp4#t=0.1"');
    expect(html.indexOf("New episode")).toBeGreaterThan(html.indexOf("EP02"));
    expect(html).toContain("Tap the bin again");
  });
});

describe("CharacterProfileFields", () => {
  it("is one folded line: the saved age and the AI-generated label", () => {
    const char = { sourceKey: "asx:skye", group: "adult-shorts", name: "Skye" } as never;
    const entry = { profile: { age: 24, aiGenerated: true } } as never;
    const html = renderToStaticMarkup(createElement(CharacterProfileFields, { char, entry }));
    expect(html).toContain("Profile · 24 · AI-generated");
    expect(html).not.toContain("<textarea");
    const blank = renderToStaticMarkup(createElement(CharacterProfileFields, { char, entry: null }));
    expect(blank).toContain("Profile · AI-generated");
  });
});
