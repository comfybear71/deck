import { describe, expect, it } from "vitest";
import { buildMp3AudioPathname, generateMp3AudioId, isSafeMp3AudioId, MP3_AUDIO_PATH_PREFIX } from "./mp3AudioPath";

describe("isSafeMp3AudioId", () => {
  it("accepts a real crypto.randomUUID-shaped id", () => {
    expect(isSafeMp3AudioId("3fae1c2b-9a4e-4d7c-8b1a-1234567890ab")).toBe(true);
  });

  it("rejects empty, path-traversal, slash-containing, or overlong ids", () => {
    expect(isSafeMp3AudioId("")).toBe(false);
    expect(isSafeMp3AudioId("../../etc/passwd")).toBe(false);
    expect(isSafeMp3AudioId("id/with/slash")).toBe(false);
    expect(isSafeMp3AudioId("a".repeat(201))).toBe(false);
  });

  it("rejects control characters and other unsafe punctuation", () => {
    expect(isSafeMp3AudioId("id\nnot-ok")).toBe(false);
    expect(isSafeMp3AudioId("id;rm -rf")).toBe(false);
  });
});

describe("buildMp3AudioPathname", () => {
  it("nests under the shared prefix with a .mp3 extension", () => {
    expect(buildMp3AudioPathname("abc123")).toBe(`${MP3_AUDIO_PATH_PREFIX}abc123.mp3`);
  });
});

describe("generateMp3AudioId", () => {
  it("returns a non-empty string, different each call", () => {
    const a = generateMp3AudioId();
    const b = generateMp3AudioId();
    expect(typeof a).toBe("string");
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
});
