import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ADULT_SHORTS_LINE_MAX,
  ADULT_SHORTS_MAX_SHOTS,
  normalizeAdultShortsSavedEntry,
  normalizeAdultShortsState,
  type AdultShortsShot,
} from "./adultShorts";
import { ADULT_SHORT_MAX_DATA_BYTES, DECK_ITEM_MAX_DATA_BYTES } from "./deckItems";
import { prepareDeckItemData } from "./deckItems-server";
import { SHORTS_CLIPS_ZIP_MAX, planShortsClipsZip } from "./shortsClipsZip";

/**
 * Shorts can have up to 100 shots (2026-10-04, Stuart hit the old 10-shot
 * cap). Every place that keeps or saves shots reads the one constant, so
 * the editor, the session and the saved episode card all agree.
 */

const BLOB = "https://klpgwmpsxnp9aoca.public.blob.vercel-storage.com/deck/shorts/episodes/ep03-a-very-long-episode-name";

/** A shot as big as Deck lets one get in practice: the prompt at the
 * still route's 1900-character cap, a full Line, three Blob files, a
 * cast of four. Stuart's real shots are 650–1100 bytes each. */
function heavyShot(n: number): AdultShortsShot {
  const pad = String(n).padStart(2, "0");
  return {
    id: `shot_${pad}_abcdef12`,
    prompt: "Slow push-in as she turns towards the window, soft light, ".repeat(40).slice(0, 1900),
    durationSec: 10,
    referenceIndex: 2,
    plateUrl: `${BLOB}/shot-${pad}-plate-v1.jpg`,
    clipUrl: `${BLOB}/shot-${pad}-clip-v1.mp4`,
    lastFrameUrl: `${BLOB}/shot-${pad}-clip-v1-last-frame.jpg`,
    sirayTaskId: "siray_task_0123456789abcdef",
    chainFromPrevious: true,
    castNames: ["Skylar", "Skye", "Bloom", "Stuie"],
    line: "[whispers] ".concat("x".repeat(ADULT_SHORTS_LINE_MAX)).slice(0, ADULT_SHORTS_LINE_MAX),
    speakerName: "Skylar",
  };
}

function savedCard(shots: AdultShortsShot[]) {
  const person = (name: string) => ({
    name,
    look: "long auburn hair, green eyes, freckles, a fitted black dress and gold hoops ".repeat(2).trim(),
    referenceUrls: [1, 2, 3].map((i) => `${BLOB}/../characters/${name.toLowerCase()}/${name.toLowerCase()}-picture-0${i}.jpg`.replace("/../", "/")),
  });
  return {
    id: "short_mutk480k_76eef5fb",
    title: "EP03 — a very long episode name for testing",
    savedAt: "2026-10-04T09:00:00.000Z",
    character: person("Skylar"),
    starring: ["Skylar", "Skye", "Bloom", "Stuie", "Shazza", "Dazza"].map(person),
    shots,
    mediaSlug: "ep03-a-very-long-episode-name",
    episodeNumber: 3,
    adult: true,
  };
}

describe("the Shorts shot cap is 100", () => {
  it("is 100", () => {
    expect(ADULT_SHORTS_MAX_SHOTS).toBe(100);
  });

  it("the editor keeps all 100 shots on load, in order, and drops a 101st", () => {
    const shots = Array.from({ length: 101 }, (_, i) => heavyShot(i + 1));
    const state = normalizeAdultShortsState({ ageConfirmed: true, shots, saved: [] })!;
    expect(state.shots).toHaveLength(100);
    expect(state.shots[0].id).toBe("shot_01_abcdef12");
    expect(state.shots[99].id).toBe("shot_100_abcdef12");
    // Stuart's real 10-shot episodes load exactly as before.
    expect(normalizeAdultShortsState({ shots: shots.slice(0, 10), saved: [] })!.shots).toHaveLength(10);
  });

  it("a saved 100-shot episode of real-sized shots fits even the shared 256 KB item limit", () => {
    const real = (n: number): AdultShortsShot => ({
      ...heavyShot(n),
      prompt: "Lounging on a worn velvet couch, slow push-in, warm lamp light, she glances back over her shoulder and smiles",
      line: "[whispers] You came back.",
    });
    const entry = normalizeAdultShortsSavedEntry(savedCard(Array.from({ length: 100 }, (_, i) => real(i + 1))))!;
    expect(entry.shots).toHaveLength(100);
    expect(JSON.stringify(entry).length).toBeLessThan(DECK_ITEM_MAX_DATA_BYTES);
  });

  it("a saved 100-shot episode with every field at its maximum is accepted by the server, under the Short's 512 KB limit", () => {
    const card = savedCard(Array.from({ length: 100 }, (_, i) => heavyShot(i + 1)));
    const entry = normalizeAdultShortsSavedEntry(card)!;
    expect(entry.shots).toHaveLength(100);
    const bytes = JSON.stringify(entry).length;
    // ~310 KB: too big for the shared 256 KB, which is why Shorts get 512 KB.
    expect(bytes).toBeGreaterThan(DECK_ITEM_MAX_DATA_BYTES);
    expect(bytes).toBeLessThan(ADULT_SHORT_MAX_DATA_BYTES * 0.75);
    const prepared = prepareDeckItemData("adult-short", card.id, card);
    expect(prepared.ok).toBe(true);
    if (prepared.ok) expect((prepared.data.shots as unknown[]).length).toBe(100);
  });

  it("a short over 512 KB is still turned away", () => {
    const card = savedCard(Array.from({ length: 100 }, (_, i) => ({ ...heavyShot(i + 1), prompt: "y".repeat(6000) })));
    expect(prepareDeckItemData("adult-short", card.id, card)).toEqual({ ok: false, error: "That short is too big to save." });
  });

  it("other kinds keep the shared 256 KB limit", () => {
    expect(DECK_ITEM_MAX_DATA_BYTES).toBe(256 * 1024);
    expect(ADULT_SHORT_MAX_DATA_BYTES).toBe(512 * 1024);
  });

  it("the episode zip takes all 100 clips, in order, with shot-100 after shot-099", () => {
    expect(SHORTS_CLIPS_ZIP_MAX).toBeGreaterThanOrEqual(ADULT_SHORTS_MAX_SHOTS);
    const clips = Array.from({ length: 100 }, (_, i) => ({
      url: `${BLOB}/shot-${i + 1}-clip-v1.mp4`,
      shot: i + 1,
      character: "Skylar",
    }));
    const plan = planShortsClipsZip({ episode: "ep03-long", clips });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const names = plan.entries.map((e) => e.name);
    expect(names).toHaveLength(100);
    expect(names[0]).toBe("ep03-long-shot-001-skylar.mp4");
    expect(names[98]).toBe("ep03-long-shot-099-skylar.mp4");
    expect(names[99]).toBe("ep03-long-shot-100-skylar.mp4");
    expect([...names].sort()).toEqual(names);
    // Up to 99 shots the names stay exactly as before.
    const small = planShortsClipsZip({ episode: "ep03-long", clips: clips.slice(0, 10) });
    expect(small.ok && small.entries[1].name).toBe("ep03-long-shot-02-skylar.mp4");
    expect(planShortsClipsZip({ episode: "ep03-long", clips: [...clips, { ...clips[0], shot: 101 }] }).ok).toBe(false);
  });

  it("the + Add shot tile reads the same constant (shown below 100, hidden at 100)", () => {
    const panel = readFileSync(new URL("../components/AdultShortsPanel.tsx", import.meta.url), "utf8");
    expect(panel).toMatch(/onAdd=\{\s*shots\.length < ADULT_SHORTS_MAX_SHOTS/);
    // No other hard-coded shot count anywhere in the Shorts code.
    const lib = readFileSync(new URL("./adultShorts.ts", import.meta.url), "utf8");
    expect(lib).toContain("shotsRaw.slice(0, ADULT_SHORTS_MAX_SHOTS)");
    expect(lib).toContain("export const ADULT_SHORTS_MAX_SHOTS = 100;");
  });
});
