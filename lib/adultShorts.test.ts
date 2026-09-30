import { describe, expect, it } from "vitest";
import {
  ADULT_SHORTS_ADULT_LOCK,
  ADULT_SHORTS_CONTENT_LOCK,
  adultShortsHaveUserContent,
  buildAdultShortsMotionPrompt,
  buildAdultShortsShot,
  buildAdultShortsStillPrompt,
  clampAdultShortsDuration,
  emptyAdultShortsState,
  estimateAdultShortsClipCostUsd,
  normalizeAdultShortsState,
  resolveAdultShortsStartImage,
  saveAdultShortToLibrary,
  startNewAdultShort,
  openSavedAdultShort,
  deleteSavedAdultShort,
  editorHasUnsavedChanges,
  type AdultShortsState,
} from "./adultShorts";

const character = { name: "Skye", look: "wavy blonde hair, gold necklaces", referenceUrls: ["https://x.test/a.jpg"] };

describe("adult shorts prompts", () => {
  it("always carries the adult and content locks", () => {
    const still = buildAdultShortsStillPrompt(character, { prompt: "lounging on a couch in a band room" });
    const motion = buildAdultShortsMotionPrompt(character, { prompt: "slow push-in, she laughs" });
    for (const p of [still, motion]) {
      expect(p).toContain(ADULT_SHORTS_ADULT_LOCK);
      expect(p).toContain(ADULT_SHORTS_CONTENT_LOCK);
      expect(p).toContain("Skye");
    }
    expect(still.startsWith("lounging")).toBe(true);
  });

  it("keeps the locks even when the shot prompt is huge", () => {
    const p = buildAdultShortsStillPrompt(character, { prompt: "x".repeat(5000) });
    expect(p.length).toBeLessThanOrEqual(2000);
    expect(p).toContain(ADULT_SHORTS_ADULT_LOCK);
    expect(p).toContain(ADULT_SHORTS_CONTENT_LOCK);
  });
});

describe("adult shorts state", () => {
  it("starts empty with one shot and no content", () => {
    const s = emptyAdultShortsState();
    expect(s.ageConfirmed).toBe(false);
    expect(s.shots).toHaveLength(1);
    expect(adultShortsHaveUserContent(s)).toBe(false);
  });

  it("normalizes junk safely and caps references at three", () => {
    expect(normalizeAdultShortsState(null)).toBeNull();
    const n = normalizeAdultShortsState({
      ageConfirmed: true,
      character: { name: "Skye", referenceUrls: ["https://a", "https://b", "https://c", "https://d", "javascript:x"] },
      shots: [{ id: "s1", prompt: "hi", durationSec: 99, plateUrl: "ftp://no" }, { id: "s1" }],
    })!;
    expect(n.character.referenceUrls).toEqual(["https://a", "https://b", "https://c"]);
    expect(n.shots).toHaveLength(1);
    expect(n.shots[0]!.durationSec).toBe(10);
    expect(n.shots[0]!.plateUrl).toBeNull();
    expect(adultShortsHaveUserContent(n)).toBe(true);
  });

  it("clamps durations and prices clips", () => {
    expect(clampAdultShortsDuration(1)).toBe(2);
    expect(clampAdultShortsDuration(NaN)).toBe(5);
    expect(estimateAdultShortsClipCostUsd(5)).toBe(0.9);
  });

  it("chains from the previous clip's last frame only when asked and available", () => {
    const a = { ...buildAdultShortsShot("a"), plateUrl: "https://p/a.jpg", lastFrameUrl: "https://f/a.jpg" };
    const b = { ...buildAdultShortsShot("b"), plateUrl: "https://p/b.jpg" };
    expect(resolveAdultShortsStartImage([a, b], 1)).toBe("https://p/b.jpg");
    expect(resolveAdultShortsStartImage([a, { ...b, chainFromPrevious: true }], 1)).toBe("https://f/a.jpg");
    expect(
      resolveAdultShortsStartImage([{ ...a, lastFrameUrl: null }, { ...b, chainFromPrevious: true }], 1)
    ).toBe("https://p/b.jpg");
  });
});

describe("adult shorts Library save / new / open", () => {
  const now = new Date("2026-09-29T00:10:00Z");
  const withWork = (): AdultShortsState => {
    const st = emptyAdultShortsState();
    st.character = { name: "Skye", look: "wavy blonde hair", referenceUrls: ["https://b/ref1.png"] };
    st.shots = [
      { ...buildAdultShortsShot("s1"), prompt: "Sitting in a white wicker chair on a terrace", clipUrl: "https://b/c1.mp4" },
      { ...buildAdultShortsShot("s2"), prompt: "She stands up", sirayTaskId: "task_9" },
    ];
    return st;
  };

  it("saves a copy with a suggested title and marks the editor as that entry", () => {
    const saved = saveAdultShortToLibrary(withWork(), now, "", "short_a");
    expect(saved.saved).toHaveLength(1);
    expect(saved.saved[0]).toMatchObject({ id: "short_a", title: "Skye · Sitting in a white wicker", savedAt: now.toISOString() });
    expect(saved.saved[0].shots[1].sirayTaskId).toBeNull();
    expect(saved.shots[1].sirayTaskId).toBe("task_9");
    expect(saved.currentSavedId).toBe("short_a");
    expect(editorHasUnsavedChanges(saved)).toBe(false);
  });

  it("saving again updates the same entry instead of duplicating", () => {
    let st = saveAdultShortToLibrary(withWork(), now, "First", "short_a");
    st = { ...st, shots: st.shots.map((s, i) => (i === 1 ? { ...s, clipUrl: "https://b/c2.mp4" } : s)) };
    expect(editorHasUnsavedChanges(st)).toBe(true);
    st = saveAdultShortToLibrary(st, now, "", "short_b");
    expect(st.saved.map((x) => x.id)).toEqual(["short_a"]);
    expect(st.saved[0].title).toBe("First");
    expect(st.saved[0].shots[1].clipUrl).toBe("https://b/c2.mp4");
  });

  it("new short clears the editor, keeps the Library, and can keep the character", () => {
    const st = saveAdultShortToLibrary(withWork(), now, "One", "short_a");
    const same = startNewAdultShort(st, true);
    expect(same.shots).toHaveLength(1);
    expect(same.shots[0].prompt).toBe("");
    expect(same.character.name).toBe("Skye");
    expect(same.saved).toHaveLength(1);
    expect(same.currentSavedId).toBeNull();
    const fresh = startNewAdultShort(st, false);
    expect(fresh.character).toEqual({ name: "", look: "", referenceUrls: [] });
  });

  it("opens a saved short back into the editor and deletes cleanly", () => {
    const st = startNewAdultShort(saveAdultShortToLibrary(withWork(), now, "One", "short_a"), false);
    const opened = openSavedAdultShort(st, "short_a");
    expect(opened.character.name).toBe("Skye");
    expect(opened.shots[0].clipUrl).toBe("https://b/c1.mp4");
    expect(opened.currentSavedId).toBe("short_a");
    const gone = deleteSavedAdultShort(opened, "short_a");
    expect(gone.saved).toHaveLength(0);
    expect(gone.currentSavedId).toBeNull();
  });

  it("round-trips saved shorts through normalize (old rows without saved still load)", () => {
    const st = saveAdultShortToLibrary(withWork(), now, "One", "short_a");
    const back = normalizeAdultShortsState(JSON.parse(JSON.stringify(st)));
    expect(back?.saved[0].title).toBe("One");
    expect(back?.currentSavedId).toBe("short_a");
    const old = normalizeAdultShortsState({ ageConfirmed: true, character: { name: "X" }, shots: [] });
    expect(old?.saved).toEqual([]);
    expect(old?.currentSavedId).toBeNull();
  });
});

describe("adult shorts Blob folder name", () => {
  const withSlug = (tag: string): AdultShortsState => ({
    ...emptyAdultShortsState(),
    ageConfirmed: true,
    character,
    shots: [{ ...buildAdultShortsShot("shot_1"), prompt: "On the couch" }],
    mediaSlug: tag,
  });

  it("survives a reload and rides along into the Library copy", () => {
    const saved = saveAdultShortToLibrary(withSlug("blonde-girl-1"), new Date("2026-09-30T00:00:00Z"), "Test");
    expect(saved.saved[0].mediaSlug).toBe("blonde-girl-1");
    const reloaded = normalizeAdultShortsState(JSON.parse(JSON.stringify(saved)))!;
    expect(reloaded.mediaSlug).toBe("blonde-girl-1");
    expect(reloaded.saved[0].mediaSlug).toBe("blonde-girl-1");
  });

  it("drops a junk folder name on load", () => {
    expect(normalizeAdultShortsState({ ...withSlug("blonde-girl-1"), mediaSlug: "../x" })!.mediaSlug).toBeUndefined();
  });

  it("a new short starts without one; opening a saved short brings its own back", () => {
    const saved = saveAdultShortToLibrary(withSlug("blonde-girl-1"), new Date("2026-09-30T00:00:00Z"), "Test");
    const fresh = startNewAdultShort(saved, false);
    expect(fresh.mediaSlug).toBeUndefined();
    expect(openSavedAdultShort(fresh, saved.saved[0].id).mediaSlug).toBe("blonde-girl-1");
  });
});

describe("Shorts episodes (2026-09-30)", () => {
  const card = (id: string, savedAt: string, episodeNumber?: number) => ({
    id,
    title: id,
    savedAt,
    character: { name: "", look: "", referenceUrls: [] },
    shots: [{ ...buildAdultShortsShot(`${id}_s`), prompt: "x" }],
    ...(episodeNumber ? { episodeNumber } : {}),
  });

  it("numbers cards by their pinned number, else oldest first, and never reuses one", async () => {
    const { adultShortEpisodeNumbers, nextAdultShortEpisodeNumber, adultShortEpisodeCode } = await import("./adultShorts");
    const saved = [card("c", "2026-09-03"), card("b", "2026-09-02", 1), card("a", "2026-09-01")];
    const n = adultShortEpisodeNumbers(saved);
    expect([n.get("b"), n.get("a"), n.get("c")]).toEqual([1, 2, 3]);
    expect(nextAdultShortEpisodeNumber(saved)).toBe(4);
    expect(nextAdultShortEpisodeNumber([])).toBe(1);
    expect(adultShortEpisodeCode(1)).toBe("EP01");
    expect(adultShortEpisodeCode(105)).toBe("EP105");
  });

  it("keeps a pinned episode number through normalize and drops a junk one", () => {
    const state = normalizeAdultShortsState({ saved: [card("a", "2026-09-01", 7), { ...card("b", "2026-09-02"), episodeNumber: -3 }] })!;
    expect(state.saved.map((x) => x.episodeNumber)).toEqual([7, undefined]);
  });

  it("auto-save: nothing before the 18+ confirm, for a blank editor, or when nothing changed", async () => {
    const { autoSaveAdultShortEditor } = await import("./adultShorts");
    const now = new Date("2026-09-30T06:00:00Z");
    const blank = emptyAdultShortsState();
    expect(autoSaveAdultShortEditor(blank, now)).toBe(blank);
    const notConfirmed = { ...blank, shots: [{ ...blank.shots[0], prompt: "beach" }] };
    expect(autoSaveAdultShortEditor(notConfirmed, now)).toBe(notConfirmed);
    // A character alone is not an episode yet.
    const onlyCharacter = { ...blank, ageConfirmed: true, character };
    expect(autoSaveAdultShortEditor(onlyCharacter, now)).toBe(onlyCharacter);

    const first = autoSaveAdultShortEditor({ ...onlyCharacter, shots: [{ ...blank.shots[0], prompt: "beach" }] }, now, "short_new");
    expect(first.saved).toHaveLength(1);
    expect(first.saved[0]).toMatchObject({ id: "short_new", episodeNumber: 1, character: { name: "Skye" } });
    expect(first.currentSavedId).toBe("short_new");
    expect(autoSaveAdultShortEditor(first, now)).toBe(first);
  });

  it("auto-save updates the open card in place: same id, title, number and place in the row", async () => {
    const { autoSaveAdultShortEditor } = await import("./adultShorts");
    const base: AdultShortsState = {
      ...emptyAdultShortsState(),
      ageConfirmed: true,
      saved: [card("newer", "2026-09-02"), card("older", "2026-09-01")],
      currentSavedId: "older",
      character,
      shots: [{ ...buildAdultShortsShot("s1"), prompt: "terrace", sirayTaskId: "task_1" }],
    };
    const after = autoSaveAdultShortEditor(base, new Date("2026-09-30T06:00:00Z"));
    expect(after.saved.map((x) => x.id)).toEqual(["newer", "older"]);
    expect(after.saved[1]).toMatchObject({ id: "older", title: "older", episodeNumber: 1, character: { name: "Skye" } });
    expect(after.saved[1].shots[0]).toMatchObject({ prompt: "terrace", sirayTaskId: null });
    expect(after.saved[0]).toBe(base.saved[0]);
  });

  it("the open card shows the live editor; the others their saved copy", async () => {
    const { adultShortEpisodeView, describeAdultShortEpisode, firstAdultShortClipUrl } = await import("./adultShorts");
    const state: AdultShortsState = {
      ...emptyAdultShortsState(),
      saved: [card("a", "2026-09-01"), card("b", "2026-09-02")],
      currentSavedId: "a",
      shots: [
        { ...buildAdultShortsShot("s1") },
        { ...buildAdultShortsShot("s2"), clipUrl: "https://x.test/2.mp4" },
      ],
    };
    expect(adultShortEpisodeView(state, state.saved[0]).shots.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(adultShortEpisodeView(state, state.saved[1]).shots.map((s) => s.id)).toEqual(["b_s"]);
    expect(describeAdultShortEpisode(state.shots)).toBe("2 shots · 1 clip");
    expect(firstAdultShortClipUrl(state.shots)).toBe("https://x.test/2.mp4");
  });
});
