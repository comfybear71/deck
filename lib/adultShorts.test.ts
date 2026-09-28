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
    expect(estimateAdultShortsClipCostUsd(5)).toBe(0.23);
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
