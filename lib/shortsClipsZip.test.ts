import { describe, expect, it } from "vitest";
import { planShortsClipsZip, shortsZipEpisodeName } from "./shortsClipsZip";

const BLOB = "https://abc123.public.blob.vercel-storage.com";

describe("Shorts episode zip", () => {
  it("names the zip and clips readably, in shot order", () => {
    const plan = planShortsClipsZip({
      episode: "ep01-blonde-girl-1",
      clips: [
        { url: `${BLOB}/a/5.mp4`, shot: 5, character: "SKYLAR" },
        { url: `${BLOB}/a/2.mp4`, shot: 2, character: "SKYLAR" },
      ],
    });
    expect(plan).toEqual({
      ok: true,
      zipName: "ep01-blonde-girl-1.zip",
      entries: [
        { name: "ep01-blonde-girl-1-shot-02-skylar.mp4", url: `${BLOB}/a/2.mp4` },
        { name: "ep01-blonde-girl-1-shot-05-skylar.mp4", url: `${BLOB}/a/5.mp4` },
      ],
    });
  });

  it("uses the pinned episode folder name, else EP number and title", () => {
    expect(shortsZipEpisodeName(1, "BLONDE GIRL _1")).toBe("ep01-blonde-girl-1");
    expect(shortsZipEpisodeName(3, "Beach", "ep03-beach-day")).toBe("ep03-beach-day");
    // A short pinned before episodes still zips under its episode number.
    expect(shortsZipEpisodeName(1, "BLONDE GIRL _1", "blonde-girl-1")).toBe("ep01-blonde-girl-1");
  });

  it("refuses an empty episode and any link that isn't one of Deck's saved clips", () => {
    expect(planShortsClipsZip({ episode: "ep01-x", clips: [] })).toMatchObject({ ok: false });
    expect(planShortsClipsZip({ episode: "ep01-x", clips: [{ url: "https://evil.test/a.mp4", shot: 1, character: "" }] })).toEqual({
      ok: false,
      error: "A clip's link isn't one of Deck's saved clips.",
    });
    expect(planShortsClipsZip(null)).toMatchObject({ ok: false });
  });

  it("Episode Extras (2026-10-04): adds an extras/ folder after the clips, clips unchanged", () => {
    const extra = {
      id: "container-drop",
      name: "container drop",
      placement: "Act III between 8 and 9",
      ext: "mp4" as const,
      url: `${BLOB}/deck/shorts/episodes/ep01-blonde-girl-1/extras/container-drop.mp4`,
    };
    const plan = planShortsClipsZip({
      episode: "ep01-blonde-girl-1",
      clips: [{ url: `${BLOB}/a/2.mp4`, shot: 2, character: "SKYLAR" }],
      extras: [extra],
    });
    expect(plan).toEqual({
      ok: true,
      zipName: "ep01-blonde-girl-1.zip",
      entries: [
        { name: "ep01-blonde-girl-1-shot-02-skylar.mp4", url: `${BLOB}/a/2.mp4` },
        { name: "extras/act-3-between-8-and-9 - container-drop.mp4", url: extra.url },
      ],
    });
    // Extras alone still zip; an outside link is refused.
    expect(planShortsClipsZip({ episode: "ep01-x", clips: [], extras: [extra] })).toMatchObject({ ok: true });
    expect(planShortsClipsZip({ episode: "ep01-x", clips: [], extras: [{ ...extra, url: "https://evil.test/a.mp4" }] })).toMatchObject({ ok: false });
  });
});
