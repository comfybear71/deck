import { describe, expect, it } from "vitest";
import {
  DECK_BLOB_STORE_HOST,
  blobPublicUrl,
  buildUrlMap,
  candidatePathnames,
  countOldLinks,
  deckTreeLayoutProblem,
  findRandomTag,
  formatCsv,
  parseCsv,
  parseMovePlanCsv,
  rewriteBlobLinks,
  validateMovePlan,
  versionedPathname,
} from "./deckBlobCopyPlan";

const HEADER = "old,new,owner,role,also,also_in_song_archives,bytes";
const U1 = "skidmarks/member-photos/ae681a24-c05d-4a51-acf1-e31ba99a6117.jpg";
const U2 = "skidmarks/plate-stills/8628cb7c-36db-4643-a9c0-e70202bfa00c.png";
const U3 = "skidmarks/adult-shorts/0b7f3c2e-1111-4a51-acf1-e31ba99a6117.mp4";

const plan = (lines: string[]) => parseMovePlanCsv([HEADER, ...lines].join("\n"));

describe("parseCsv / parseMovePlanCsv", () => {
  it("reads quoted fields with commas, curly quotes and doubled quotes", () => {
    expect(parseCsv('a,"b, c","say ""hi""",d\r\n1,2,3,4\n')).toEqual([
      ["a", "b, c", 'say "hi"', "d"],
      ["1", "2", "3", "4"],
    ]);
    const rows = plan([`${U1},deck/music-video/characters/big-sexy/big-sexy-avatar.jpg,Band X,avatar,,"CRACK HAUL.mp3, Man’s Best friends.mp3",120480`]);
    expect(rows[0]).toMatchObject({ line: 2, old: U1, alsoInSongArchives: "CRACK HAUL.mp3, Man’s Best friends.mp3", bytes: 120480 });
  });

  it("refuses a wrong header", () => {
    expect(() => parseMovePlanCsv("from,to\na,b\n")).toThrow(/header/);
  });

  it("formatCsv round-trips", () => {
    const rows = [["a", "b, c", 'q"x']];
    expect(parseCsv(formatCsv(rows))).toEqual(rows);
  });
});

describe("layout rules", () => {
  it("accepts the same shape for every genre", () => {
    for (const p of [
      "deck/sunnybank/characters/shazza/plates/shazza-plate-03.jpg",
      "deck/sunnybank/characters/unit-4s/unit-4s-reference.jpg",
      "deck/skidmarks/characters/dap/dap-reference-candidate.jpg",
      "deck/skidmarks/characters/dap/pictures/dap-picture-05.jpg",
      "deck/music-video/characters/big-sexy/stills/big-sexy-still-22.png",
      "deck/music-video/characters/big-sexy/looks/big-sexy-look-02.jpg",
      "deck/music-video/bands/bigsexy/bigsexy-cover.jpg",
      "deck/shorts/shorts/blonde-girl-1/blonde-girl-1-plate-02.jpg",
      "deck/shorts/shorts/blonde-girl-1/blonde-girl-1-clip-03-last-frame.jpg",
      "deck/shorts/characters/skye/plates/skye-plate-03.jpg",
      "deck/sunnybank/characters/shazza/plates/shazza-plate-03-v2.jpg",
    ]) {
      expect([p, deckTreeLayoutProblem(p)]).toEqual([p, null]);
    }
  });

  it("rejects random tags anywhere", () => {
    expect(findRandomTag("deck/shorts/shorts/short-3f9a2c/short-3f9a2c-plate-02.jpg")).toBe("3f9a2c");
    expect(findRandomTag("deck/shorts/characters/skye/plates/skye-7b1e04-plate-03.jpg")).toBe("7b1e04");
    expect(findRandomTag("deck/sunnybank/characters/unit-4s/plates/unit-4s-plate-01.jpg")).toBeNull();
    expect(findRandomTag("deck/sunnybank/characters/face/face-reference.jpg")).toBeNull();
    expect(deckTreeLayoutProblem("deck/shorts/shorts/short-3f9a2c/short-3f9a2c-plate-02.jpg")).toMatch(/random-looking tag/);
  });

  it("rejects paths outside the layout", () => {
    expect(deckTreeLayoutProblem("deck/sunnybank/characters/shazza/plates/nan-plate-03.jpg")).toMatch(/character file/);
    expect(deckTreeLayoutProblem("deck/sunnybank/characters/shazza/plates/shazza-plate-3.jpg")).toMatch(/character file/);
    expect(deckTreeLayoutProblem("deck/sunnybank/songs/x/x-clip-01a.jpg")).toMatch(/not characters/);
    expect(deckTreeLayoutProblem("deck/shorts/songs/x/x-plate-01.jpg")).toMatch(/not characters/);
    // Shorts episodes (2026-09-30) sit next to the older shorts folders.
    expect(deckTreeLayoutProblem("deck/shorts/episodes/ep01-blonde-girl-1/ep01-blonde-girl-1-plate-01.jpg")).toBeNull();
    expect(deckTreeLayoutProblem("deck/sunnybank/bands/x/x-cover.jpg")).toMatch(/only Music video/);
    expect(deckTreeLayoutProblem("deck/characters/skye/skye-reference.jpg")).toMatch(/genre|not a safe/);
    expect(deckTreeLayoutProblem("deck/shorts/shorts/blonde/other-plate-01.jpg")).toMatch(/must start with/);
    expect(deckTreeLayoutProblem("deck/Sunnybank/characters/shazza/shazza-reference.jpg")).toMatch(/not a safe/);
  });
});

describe("validateMovePlan", () => {
  it("is empty for a good plan", () => {
    const rows = plan([
      `${U1},deck/sunnybank/characters/shazza/plates/shazza-plate-01.jpg,Character Shazza,training plate 1,,,219005`,
      `${U2},deck/music-video/characters/big-sexy/stills/big-sexy-still-22.png,Band,still,,,1`,
      `${U3},deck/shorts/shorts/blonde-girl-1/blonde-girl-1-clip-02.mp4,Short,clip,,,1`,
    ]);
    expect(validateMovePlan(rows, 3)).toEqual([]);
  });

  it("catches count, repeats, extension changes, bad old folders", () => {
    const rows = plan([
      `${U1},deck/sunnybank/characters/shazza/plates/shazza-plate-01.jpg,a,b,,,1`,
      `${U1},deck/sunnybank/characters/shazza/plates/shazza-plate-01.jpg,a,b,,,1`,
      `${U2},deck/sunnybank/characters/shazza/plates/shazza-plate-02.jpg,a,b,,,1`,
      `skidmarks/archive/x.jpg,deck/sunnybank/characters/shazza/plates/shazza-plate-03.jpg,a,b,,,1`,
    ]);
    const problems = validateMovePlan(rows, 207).join("\n");
    expect(problems).toMatch(/4 rows, expected 207/);
    expect(problems).toMatch(/line 3: old path repeats line 2/);
    expect(problems).toMatch(/line 3: new path repeats line 2/);
    expect(problems).toMatch(/line 4: extension changes/);
    expect(problems).toMatch(/line 5: old path "skidmarks\/archive\/x.jpg"/);
  });
});

describe("-vN names", () => {
  it("never reuses the plan name for version 2+", () => {
    expect(versionedPathname("deck/a/b/c-plate-01.jpg", 1)).toBe("deck/a/b/c-plate-01.jpg");
    expect(versionedPathname("deck/a/b/c-plate-01.jpg", 2)).toBe("deck/a/b/c-plate-01-v2.jpg");
    expect(candidatePathnames("deck/a/b/c.mp4", 3)).toEqual(["deck/a/b/c.mp4", "deck/a/b/c-v2.mp4", "deck/a/b/c-v3.mp4"]);
  });
});

describe("rewriteBlobLinks", () => {
  const rows = plan([
    `${U1},deck/sunnybank/characters/shazza/plates/shazza-plate-01.jpg,a,b,,,1`,
    `${U2},deck/music-video/characters/big-sexy/stills/big-sexy-still-22.png,a,b,,,1`,
  ]);
  const map = buildUrlMap(rows);
  const oldUrl = blobPublicUrl(U1);

  it("swaps links in nested JSON, lists every field, and leaves the input alone", () => {
    const input = {
      trainingImageUrls: [oldUrl, "https://example.com/x.jpg"],
      "odd key": { referenceUrl: `${blobPublicUrl(U2)}?v=2` },
      prompt: `see ${oldUrl} and ${blobPublicUrl(U2)}`,
      n: 3,
      nil: null,
    };
    const before = JSON.stringify(input);
    const out = rewriteBlobLinks(input, map);
    expect(JSON.stringify(input)).toBe(before);
    expect(out.value.trainingImageUrls[0]).toBe(`https://${DECK_BLOB_STORE_HOST}/deck/sunnybank/characters/shazza/plates/shazza-plate-01.jpg`);
    expect(out.value.trainingImageUrls[1]).toBe("https://example.com/x.jpg");
    expect(out.value["odd key"].referenceUrl).toMatch(/big-sexy-still-22\.png\?v=2$/);
    expect(out.value.prompt).not.toMatch(/skidmarks\//);
    expect(out.changes.map((c) => c.field)).toEqual(["$.trainingImageUrls[0]", '$["odd key"].referenceUrl', "$.prompt"]);
    expect(out.changes[2].links).toHaveLength(2);
    expect(out.unmapped).toEqual([]);
    expect(countOldLinks(input)).toBe(4);
    expect(countOldLinks(out.value)).toBe(0);
  });

  it("reports old links the plan doesn't cover, and keeps them as they are", () => {
    const stray = blobPublicUrl("skidmarks/member-photos/ffffffff-0000-0000-0000-000000000000.jpg");
    const out = rewriteBlobLinks({ a: [stray] }, map);
    expect(out.value.a[0]).toBe(stray);
    expect(out.unmapped).toEqual([{ field: "$.a[0]", url: stray }]);
    expect(out.changes).toEqual([]);
  });

  it("ignores other stores and other folders", () => {
    const other = { a: `https://other.public.blob.vercel-storage.com/${U1}`, b: blobPublicUrl("skidmarks/archive/x.json") };
    const out = rewriteBlobLinks(other, map);
    expect(out.changes).toEqual([]);
    expect(out.unmapped).toEqual([]);
  });

  it("flags old links used as keys", () => {
    expect(rewriteBlobLinks({ [oldUrl]: 1 }, map).inKeys).toHaveLength(1);
  });

  it("uses the final -vN path when a copy had to move", () => {
    const m = buildUrlMap(rows, (r) => versionedPathname(r.new, 2));
    expect(rewriteBlobLinks(oldUrl, m).value).toMatch(/shazza-plate-01-v2\.jpg$/);
  });
});

describe("LINK_UPDATE_SQL", () => {
  it("is compare-and-swap on revision everywhere, keeps history, and has the all-or-nothing guard", async () => {
    const { LINK_UPDATE_SQL } = await import("./deckBlobCopyPlan");
    expect(LINK_UPDATE_SQL).toMatch(/d\.revision = x\.revision[\s\S]*d\.revision = x\.revision/);
    expect(LINK_UPDATE_SQL).toMatch(/UPDATE skidmarks_sessions[\s\S]*revision = \$2/);
    expect(LINK_UPDATE_SQL).toMatch(/INSERT INTO deck_item_history/);
    expect(LINK_UPDATE_SQL).toMatch(/INSERT INTO skidmarks_session_history/);
    expect(LINK_UPDATE_SQL).toMatch(/1 \/ \(CASE WHEN/);
    expect(LINK_UPDATE_SQL).not.toMatch(/\bDELETE\b/i);
  });
});
