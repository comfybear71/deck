import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EpisodeExtrasCards } from "./EpisodeExtrasRow";
import { EPISODE_EXTRA_ACCEPT, type EpisodeExtra } from "@/lib/episodeExtras";
import { episodeExtrasProjectFor } from "@/lib/episodeExtrasProject";
import type { SkidmarksState } from "@/lib/skidmarks";

/** Episode Extras (2026-10-04): one shared row, in every genre's episode screen. */

const noop = () => {};
const BLOB = "https://abc123.public.blob.vercel-storage.com";

const EXTRAS: EpisodeExtra[] = [
  {
    id: "container-drop",
    name: "container drop",
    placement: "Act III between 8 and 9",
    url: `${BLOB}/deck/skidmarks/episodes/cornish-arsehole/extras/container-drop.mp4`,
    pathname: "deck/skidmarks/episodes/cornish-arsehole/extras/container-drop.mp4",
    ext: "mp4",
    kind: "video",
    originalFileName: "IMG_0412.MOV",
    sizeBytes: 1,
    createdAt: 1,
  },
  {
    id: "seagull",
    name: "seagull",
    placement: "",
    url: `${BLOB}/deck/skidmarks/episodes/cornish-arsehole/extras/seagull.wav`,
    pathname: "deck/skidmarks/episodes/cornish-arsehole/extras/seagull.wav",
    ext: "wav",
    kind: "audio",
    originalFileName: "seagull.wav",
    sizeBytes: 1,
    createdAt: 2,
  },
];

describe("EpisodeExtrasCards", () => {
  it("one sideways row: each extra with its name, placement, bin and pencil, then the dotted + at the far right", () => {
    const html = renderToStaticMarkup(
      createElement(EpisodeExtrasCards, {
        extras: EXTRAS,
        uploading: null,
        confirmDeleteId: "seagull",
        canAdd: true,
        blockedReason: null,
        notice: null,
        onPlay: noop,
        onEdit: noop,
        onDelete: noop,
        onPick: noop,
      }),
    );
    expect(html).toContain("Extras");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain('aria-label="Play container drop"');
    expect(html).toContain("Act III between 8 and 9");
    expect(html).toContain(`src="${EXTRAS[0].url}#t=0.1"`);
    expect(html).toContain('aria-label="Edit container drop"');
    expect(html).toContain('aria-label="Tap again to delete seagull"');
    // The + is a real file input inside a label (what opens the picker on iPhone Safari).
    expect(html).toContain(`accept="${EPISODE_EXTRA_ACCEPT}"`);
    expect(html).toContain('type="file"');
    expect(html.indexOf('aria-label="Add an extra"')).toBeGreaterThan(html.indexOf("seagull"));
  });

  it("shows an upload in progress and why + is off", () => {
    const html = renderToStaticMarkup(
      createElement(EpisodeExtrasCards, {
        extras: [],
        uploading: { name: "container drop", percentage: 42 },
        confirmDeleteId: null,
        canAdd: false,
        blockedReason: "Attach the song first, then add extras.",
        notice: null,
        onPlay: noop,
        onEdit: noop,
        onDelete: noop,
        onPick: noop,
      }),
    );
    expect(html).toContain("Uploading container drop, 42%");
    expect(html).toContain("Attach the song first");
    expect(html).toMatch(/type="file"[^>]*disabled=""/);
  });
});

describe("the same row in all four genres", () => {
  it("every genre's episode screen mounts the one shared EpisodeExtrasRow", () => {
    const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
    // Sunnybank, Skidmarks and Shorts (every episode, 2026-10-05) share the studio panel, which passes its genre.
    expect(read("./SkidmarksSunnyBanksPanel.tsx")).toContain("<EpisodeExtrasRow genre={genre} />");
    expect(read("./SkidmarksDetailSheet.tsx")).toContain('<SkidmarksSunnyBanksPanel genre="shorts" />');
    expect(read("./SkidmarksDetailSheet.tsx")).toContain('<EpisodeExtrasRow genre="music-video" />');
    // No genre-only copy of the row anywhere.
    expect(read("./EpisodeExtrasRow.tsx")).not.toMatch(/genre === "(sunnybank|skidmarks|shorts|music-video)"/);
  });

  it("each genre's row finds its own episode folder", () => {
    const state = {
      bands: [],
      session: { projectKind: "skidmarks", bandId: "b", mp3: { fileName: "CRACK HAUL.mp3", segments: [] }, scriptSequenceDraft: null },
      removedSeedBandIds: [],
      sunnyBanks: { live: { actIds: ["I"], activeAct: "I", actScripts: { I: "" }, runtimeMap: {}, workspaceTitle: "The Big Wet", mediaSlug: "ep05-the-big-wet", defaultLocationId: "park_site_4", locationOverrides: {}, characterOverrides: {} }, workspaces: [], saveSeq: 0 },
      skidmarksStudio: { live: { actIds: ["I"], activeAct: "I", actScripts: { I: "" }, runtimeMap: {}, workspaceTitle: "EP00 — Cornish Arsehole", mediaSlug: "cornish-arsehole", defaultLocationId: "town_street", locationOverrides: {}, characterOverrides: {} }, workspaces: [], saveSeq: 0 },
      adultShorts: { mediaSlug: "ep01-blonde-girl-1", saved: [], character: { name: "", look: "", referenceUrls: [] }, shots: [] },
    } as unknown as SkidmarksState;
    expect(episodeExtrasProjectFor(state, "sunnybank").folder).toBe("deck/sunnybank/episodes/ep05-the-big-wet");
    expect(episodeExtrasProjectFor(state, "skidmarks").folder).toBe("deck/skidmarks/episodes/cornish-arsehole");
    expect(episodeExtrasProjectFor(state, "shorts").folder).toBe("deck/shorts/episodes/ep01-blonde-girl-1");
    expect(episodeExtrasProjectFor(state, "music-video").folder).toBe("deck/music-video/songs/crack-haul");
    const noSong = { ...state, session: { ...state.session, mp3: null } } as SkidmarksState;
    expect(episodeExtrasProjectFor(noSong, "music-video")).toMatchObject({ folder: null, canAdd: false });
  });
});
