import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EpisodeExtrasCards, episodeExtraFailureText } from "./EpisodeExtrasRow";
import { EPISODE_EXTRAS_BROKEN_TEXT, EpisodeExtrasBoundary } from "./EpisodeExtrasBoundary";

/**
 * Stuart, 4 Oct 2026, 3:27–3:29 PM (Windows Chrome, Skidmarks, EP00):
 * after adding an extra the main area went black with only the left
 * menu showing. Both files did upload and save. The cause: the hidden
 * file input behind the + tile was placed against the page's whole main
 * column (its tile had no `position: relative`), so clicking + made
 * Chrome scroll that column, which has no scrollbar, to show the input.
 * The header and the page slid up out of sight and couldn't be scrolled
 * back. Reproduced with Chrome on the box (column scrolled 456px) and
 * gone with this fix (0px).
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const noop = () => {};

describe("the + tile keeps its file input inside itself", () => {
  it("the label around the input is relative, so the browser never scrolls the page column to reach it", () => {
    const html = renderToStaticMarkup(
      createElement(EpisodeExtrasCards, {
        extras: [],
        uploading: null,
        confirmDeleteId: null,
        canAdd: true,
        blockedReason: null,
        notice: null,
        onPlay: noop,
        onEdit: noop,
        onDelete: noop,
        onPick: noop,
      }),
    );
    const label = html.match(/<label aria-label="Add an extra"[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/label>/);
    expect(label).not.toBeNull();
    expect(label![1].split(/\s+/)).toContain("relative");
    expect(label![2]).toContain('type="file"');
    expect(label![2]).toContain('class="sr-only"');
  });

  it("the Create screen's columns are clipped, not hidden, so nothing can scroll them out of sight", () => {
    const sheet = read("./SkidmarksDetailSheet.tsx");
    expect(sheet).toContain('<div className="relative flex min-w-0 flex-1 flex-col overflow-clip">');
    expect(sheet).toContain('"relative z-10 flex h-[92vh] w-full flex-col overflow-clip rounded-t-3xl');
    expect(sheet).not.toContain('<div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">');
  });
});

describe("a fault in Extras never blanks the page", () => {
  it("the row is drawn inside its own error boundary", () => {
    const row = read("./EpisodeExtrasRow.tsx");
    expect(row).toMatch(/<EpisodeExtrasBoundary>\s*<EpisodeExtrasRowInner genre=\{genre\} \/>\s*<\/EpisodeExtrasBoundary>/);
  });

  it("the boundary catches a drawing error and shows one plain line with Try again", () => {
    expect(EpisodeExtrasBoundary.getDerivedStateFromError()).toEqual({ failed: true });
    const ok = new EpisodeExtrasBoundary({ children: createElement("p", null, "row") });
    expect(renderToStaticMarkup(ok.render() as never)).toBe("<p>row</p>");
    const broken = new EpisodeExtrasBoundary({ children: createElement("p", null, "row") });
    broken.state = { failed: true };
    const html = renderToStaticMarkup(broken.render() as never);
    expect(html).toContain('aria-label="Extras"');
    expect(html).toContain('role="alert"');
    expect(html).toContain(EPISODE_EXTRAS_BROKEN_TEXT.split(".")[0]);
    expect(html).toContain("Try again");
    expect(html).not.toContain("<p>row</p>");
  });

  it("anything thrown while adding a file becomes a plain message in the row", () => {
    expect(episodeExtraFailureText(new TypeError("Cannot read properties of undefined (reading 'split')"))).toBe(
      "Something went wrong adding that file (Cannot read properties of undefined (reading 'split')). Nothing else was changed; try again.",
    );
    expect(episodeExtraFailureText({})).toBe("Something went wrong adding that file. Nothing else was changed; try again.");
  });

  it("the add flow is wrapped in try/catch and the success note no longer splits a possibly missing pathname", () => {
    const row = read("./EpisodeExtrasRow.tsx");
    expect(row).toContain("setNotice({ text: episodeExtraFailureText(err), tone: \"error\" });");
    expect(row).not.toContain("pathname.split");
  });
});
