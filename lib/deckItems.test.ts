import { describe, expect, it } from "vitest";
import { characterFolder, isDeckItemKind, isValidDeckItemId } from "./deckItems";
import { rosterExtraSourceKey } from "./rosterExtras";

describe("characterFolder", () => {
  it("maps each sourceKey prefix to its home folder", () => {
    expect(characterFolder("sb:shazza")).toBe("sunnybank");
    expect(characterFolder(rosterExtraSourceKey("sunny-banks", "chr_1"))).toBe("sunnybank");
    expect(characterFolder("mv:jack-ash-frontman")).toBe("music-video");
    expect(characterFolder(rosterExtraSourceKey("music-video", "chr_2"))).toBe("music-video");
    expect(characterFolder("sk:cast_9")).toBe("skidmarks");
    expect(characterFolder("as:skye")).toBe("adult-shorts");
    expect(characterFolder(rosterExtraSourceKey("adult-shorts", "chr_3"))).toBe("adult-shorts");
  });

  it("puts a card with no (or an unknown) sourceKey at the Deck root", () => {
    expect(characterFolder(null)).toBe("deck");
    expect(characterFolder(undefined)).toBe("deck");
    expect(characterFolder("zz:thing")).toBe("deck");
  });
});

describe("ids and kinds", () => {
  it("accepts app-made ids only", () => {
    expect(isValidDeckItemId("clora_skye")).toBe(true);
    expect(isValidDeckItemId("clora_0b1c2d3e-aaaa-bbbb-cccc-123456789abc")).toBe(true);
    expect(isValidDeckItemId("")).toBe(false);
    expect(isValidDeckItemId("a b")).toBe(false);
    expect(isValidDeckItemId("x".repeat(201))).toBe(false);
    expect(isValidDeckItemId(5)).toBe(false);
  });

  it("knows only the character kind in step 1", () => {
    expect(isDeckItemKind("character")).toBe(true);
    expect(isDeckItemKind("episode")).toBe(false);
  });
});
