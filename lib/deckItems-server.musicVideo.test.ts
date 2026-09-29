import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `lib/deckItems-server.ts` for Music video bands and songs, mocked at
 * the `@neondatabase/serverless` boundary like `deckItems-server.test.ts`
 * (kept in its own file so the character tests stay untouched).
 */
const sqlMock = vi.fn();
vi.mock("@neondatabase/serverless", () => ({ neon: () => sqlMock }));

const ORIGINAL_ENV = { ...process.env };
const load = () => import("./deckItems-server");
const queryText = (i: number) => (sqlMock.mock.calls[i][0] as TemplateStringsArray).join("?");

const band = {
  id: "band_b",
  name: "BIGSEXY",
  tagline: "",
  coverSeed: 3,
  editIcon: "camera",
  coverImage: "https://x.public.blob.vercel-storage.com/cover.jpg",
  mediaSlug: "bigsexy",
  members: [
    { id: "member_1", name: "BIG SEXY", emoji: "🎤", looks: [], avatarImage: "data:image/png;base64,AAAA", characterId: "clora_1" },
    { id: "member_2", name: "Backup", emoji: "🎸", looks: [], characterId: "not an id!" },
  ],
};
const song = {
  id: "mp3_a",
  bandId: "band_b",
  mp3: { attachId: "mp3_a", fileName: "CRACK HAUL.mp3", segments: [{ id: "s1", plates: [{ id: "p1", still: { dataUrl: "data:image/jpeg;base64,AA" } }] }] },
  scriptSequenceDraft: { script: "Verse 1" },
};
const bandRow = (revision: number) => ({ item_id: "band_b", folder: "music-video", data: band, revision, updated_at: "t", deleted_at: null });

beforeEach(() => {
  vi.resetModules();
  sqlMock.mockReset();
  process.env = { ...ORIGINAL_ENV, DATABASE_URL: "postgres://u:p@h/db" };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  for (const call of sqlMock.mock.calls) {
    expect((call[0] as TemplateStringsArray).join("?")).not.toMatch(/\b(CREATE|ALTER|DROP|TRUNCATE)\b/i);
  }
});

describe("prepareDeckItemData: music-video-band", () => {
  it("cleans a band, keeps member character references (by id only), drops inline bytes, folder music-video", async () => {
    const { prepareDeckItemData } = await load();
    const out = prepareDeckItemData("music-video-band", "band_b", band);
    expect(out).toMatchObject({ ok: true, folder: "music-video" });
    if (!out.ok) return;
    expect(out.data).toMatchObject({ id: "band_b", name: "BIGSEXY", mediaSlug: "bigsexy", editIcon: "camera" });
    const members = out.data.members as { id: string; characterId: string | null; avatarImage?: string }[];
    expect(members.map((m) => [m.id, m.characterId])).toEqual([
      ["member_1", "clora_1"],
      ["member_2", null],
    ]);
    expect(members[0].avatarImage).toBeUndefined();
    expect(JSON.stringify(out.data)).not.toContain("data:");
  });

  it("refuses a band whose id doesn't match, or that isn't a band", async () => {
    const { prepareDeckItemData } = await load();
    expect(prepareDeckItemData("music-video-band", "band_other", band)).toMatchObject({ ok: false });
    expect(prepareDeckItemData("music-video-band", "band_b", { name: "no id" })).toMatchObject({ ok: false });
  });
});

describe("prepareDeckItemData: music-video-song", () => {
  it("keeps the song, drops an inline plate still, folder music-video", async () => {
    const { prepareDeckItemData } = await load();
    const out = prepareDeckItemData("music-video-song", "mp3_a", song);
    expect(out).toMatchObject({ ok: true, folder: "music-video", data: { id: "mp3_a", bandId: "band_b", scriptSequenceDraft: { script: "Verse 1" } } });
    expect(JSON.stringify(out)).not.toContain("data:image");
  });

  it("refuses a song whose attach id doesn't match its item id", async () => {
    const { prepareDeckItemData } = await load();
    expect(prepareDeckItemData("music-video-song", "mp3_other", song)).toMatchObject({ ok: false });
    expect(prepareDeckItemData("music-video-song", "mp3_a", { ...song, mp3: { ...song.mp3, attachId: "mp3_b" } })).toMatchObject({ ok: false });
  });
});

describe("putDeckItem / listDeckItems for Music video", () => {
  it("writes a band as kind band in the music-video folder", async () => {
    sqlMock.mockResolvedValueOnce([bandRow(1)]);
    const { putDeckItem } = await load();
    expect(await putDeckItem("music-video-band", "band_b", band, 0)).toMatchObject({ ok: true, item: { itemId: "band_b", revision: 1 } });
    expect(sqlMock.mock.calls[0]).toContain("music-video-band");
    expect(sqlMock.mock.calls[0]).toContain("music-video");
  });

  it("songs count as seeded once the Music video seed has put in any band (one extra read, no write)", async () => {
    sqlMock.mockResolvedValueOnce([]); // no song rows
    sqlMock.mockResolvedValueOnce([{ seeded: true }]); // but bands exist
    const { listDeckItems } = await load();
    expect(await listDeckItems("music-video-song")).toMatchObject({ ok: true, seeded: true, items: [] });
    expect(queryText(1)).toMatch(/SELECT EXISTS[\s\S]*kind = ANY/);
    expect(sqlMock.mock.calls[1]).toContainEqual(["music-video-band", "music-video-song"]);
  });

  it("not seeded while there are no band or song rows", async () => {
    sqlMock.mockResolvedValueOnce([]);
    sqlMock.mockResolvedValueOnce([{ seeded: false }]);
    const { listDeckItems } = await load();
    expect(await listDeckItems("music-video-band")).toMatchObject({ ok: true, seeded: false });
  });

  it("characters still ask only their own kind (one query)", async () => {
    sqlMock.mockResolvedValueOnce([]);
    const { listDeckItems } = await load();
    expect(await listDeckItems("character")).toMatchObject({ ok: true, seeded: false });
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });
});
