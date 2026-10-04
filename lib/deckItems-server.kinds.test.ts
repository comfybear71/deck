import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildStarterEpisode } from "./skidmarksEpisodes";
import { buildAdultShortsShot, type AdultShortsSaved } from "./adultShorts";
import { DECK_ITEM_KIND_FOLDERS, isDeckItemKind } from "./deckItems";

/**
 * Skidmarks episodes and shorts through the same server module as
 * characters (`lib/deckItems-server.test.ts` covers the SQL itself).
 * Mocked at the `@neondatabase/serverless` boundary; never DDL.
 */
const sqlMock = vi.fn();
vi.mock("@neondatabase/serverless", () => ({ neon: () => sqlMock }));

const ORIGINAL_ENV = { ...process.env };
const load = () => import("./deckItems-server");

const episode = buildStarterEpisode("EP01 · The Bin Chicken", 1_759_000_000_000, "ep_11111111-2222-3333-4444-555555555555");
const short: AdultShortsSaved = {
  id: "short_mg5x0abc_1a2b3c4d",
  title: "Skye · beach walk",
  savedAt: "2026-09-29T10:00:00.000Z",
  character: { name: "Skye", look: "auburn hair", referenceUrls: ["https://x.public.blob.vercel-storage.com/r.png"] },
  shots: [{ ...buildAdultShortsShot("shot_1"), prompt: "walks along the beach", clipUrl: "https://x.public.blob.vercel-storage.com/c.mp4" }],
};

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

describe("kinds", () => {
  it("knows skidmarks-episode, shorts-episode and adult-short, each in its project folder", () => {
    expect(isDeckItemKind("skidmarks-episode")).toBe(true);
    expect(isDeckItemKind("shorts-episode")).toBe(true);
    expect(isDeckItemKind("adult-short")).toBe(true);
    expect(isDeckItemKind("adult-shorts")).toBe(false);
    expect(isDeckItemKind("sunnybank-episode")).toBe(true);
    expect(isDeckItemKind("character")).toBe(true);
    expect(DECK_ITEM_KIND_FOLDERS).toEqual({
      "sunnybank-episode": "sunnybank",
      "skidmarks-episode": "skidmarks",
      "shorts-episode": "adult-shorts",
      "adult-short": "adult-shorts",
    });
  });
});

describe("prepareDeckItemData", () => {
  it("cleans an episode and files it under skidmarks", async () => {
    const { prepareDeckItemData } = await load();
    const out = prepareDeckItemData("skidmarks-episode", episode.id, { ...episode, junk: 1 });
    // An episode saved by the old nine-beat editor (PR 216) still saves:
    // it becomes an episode card with the same id (2026-10-04).
    expect(out).toMatchObject({
      ok: true,
      folder: "skidmarks",
      data: { id: episode.id, label: "EP01 · The Bin Chicken", actIds: ["I"] },
    });
    expect((out as { data: Record<string, unknown> }).data.junk).toBeUndefined();
    expect((out as { data: Record<string, unknown> }).data.beats).toBeUndefined();
  });

  it("cleans a Skidmarks episode card (the Sunny Banks structure) as it is", async () => {
    const { prepareDeckItemData } = await load();
    const { buildEmptySunnyBanksLive, buildSunnyBanksWorkspaceFromLive } = await import("./sunnyBanksWorkspace");
    const card = buildSunnyBanksWorkspaceFromLive(
      { ...buildEmptySunnyBanksLive("skidmarks"), workspaceTitle: "Cornish Arsehole", castIds: ["cast_dap"] },
      1_759_000_000_000,
      1,
      "skidmarks"
    );
    const out = prepareDeckItemData("skidmarks-episode", card.id, card);
    expect(out).toMatchObject({ ok: true, folder: "skidmarks", data: { id: card.id, label: "Cornish Arsehole", castIds: ["cast_dap"] } });
    expect(prepareDeckItemData("skidmarks-episode", "other", card)).toMatchObject({ ok: false });
  });

  it("cleans a Shorts script episode card (shorts-episode, 2026-10-04) and files it under adult-shorts", async () => {
    const { prepareDeckItemData } = await load();
    const { buildEmptySunnyBanksLive, buildSunnyBanksWorkspaceFromLive } = await import("./sunnyBanksWorkspace");
    const card = buildSunnyBanksWorkspaceFromLive(
      { ...buildEmptySunnyBanksLive("shorts"), workspaceTitle: "EP04 Test Night" },
      1_759_000_000_000,
      1,
      "shorts"
    );
    const out = prepareDeckItemData("shorts-episode", card.id, { ...card, junk: 1 });
    expect(out).toMatchObject({ ok: true, folder: "adult-shorts", data: { id: card.id, label: "EP04 Test Night" } });
    expect((out as { data: Record<string, unknown> }).data.junk).toBeUndefined();
    expect(prepareDeckItemData("shorts-episode", "other", card)).toMatchObject({ ok: false });
    expect(prepareDeckItemData("shorts-episode", card.id, { nope: true })).toMatchObject({ ok: false });
  });

  it("cleans a saved short and files it under adult-shorts", async () => {
    const { prepareDeckItemData } = await load();
    const out = prepareDeckItemData("adult-short", short.id, short);
    expect(out).toMatchObject({ ok: true, folder: "adult-shorts", data: { id: short.id, title: "Skye · beach walk" } });
  });

  it("refuses a mismatched id, junk, or the wrong kind of thing", async () => {
    const { prepareDeckItemData } = await load();
    expect(prepareDeckItemData("skidmarks-episode", "ep_other", episode)).toMatchObject({ ok: false });
    expect(prepareDeckItemData("adult-short", "short_other", short)).toMatchObject({ ok: false });
    expect(prepareDeckItemData("skidmarks-episode", episode.id, { title: "no id" })).toMatchObject({ ok: false });
    expect(prepareDeckItemData("adult-short", short.id, { ...short, shots: [] })).toMatchObject({ ok: false });
    expect(prepareDeckItemData("adult-short", short.id, [short])).toMatchObject({ ok: false });
  });
});

describe("putDeckItem for the new kinds", () => {
  it("writes an episode under its own kind and folder", async () => {
    sqlMock.mockResolvedValueOnce([{ item_id: episode.id, folder: "skidmarks", data: episode, revision: 1, updated_at: null, deleted_at: null }]);
    const { putDeckItem } = await load();
    const out = await putDeckItem("skidmarks-episode", episode.id, episode, 0);
    expect(out).toMatchObject({ ok: true, item: { itemId: episode.id, folder: "skidmarks", revision: 1 } });
    const values = sqlMock.mock.calls[0].slice(1);
    expect(values).toContain("skidmarks-episode");
    expect(values).toContain("skidmarks");
  });

  it("writes a short under kind adult-short, folder adult-shorts", async () => {
    sqlMock.mockResolvedValueOnce([{ item_id: short.id, folder: "adult-shorts", data: short, revision: 1, updated_at: null, deleted_at: null }]);
    const { putDeckItem } = await load();
    await putDeckItem("adult-short", short.id, short, 0);
    const values = sqlMock.mock.calls[0].slice(1);
    expect(values).toContain("adult-short");
    expect(values).toContain("adult-shorts");
  });

  it("an invalid short never reaches the database", async () => {
    const { putDeckItem } = await load();
    expect(await putDeckItem("adult-short", short.id, { id: short.id }, 0)).toMatchObject({ ok: false, reason: "invalid" });
    expect(sqlMock).not.toHaveBeenCalled();
  });
});
