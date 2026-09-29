import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCharacterLoraEntry } from "./characterLoras";
import { buildEmptySunnyBanksLive, buildSunnyBanksWorkspaceFromLive } from "./sunnyBanksWorkspace";

/**
 * `lib/deckItems-server.ts` mocked at the `@neondatabase/serverless`
 * boundary, same shape as `lib/skidmarksSession-server.test.ts`. Also
 * pins the rule that the app never creates tables: no statement it sends
 * may be DDL.
 */
const sqlMock = vi.fn();
vi.mock("@neondatabase/serverless", () => ({ neon: () => sqlMock }));

const ORIGINAL_ENV = { ...process.env };

async function load() {
  return await import("./deckItems-server");
}

function queryText(callIndex: number): string {
  const strings = sqlMock.mock.calls[callIndex][0] as TemplateStringsArray;
  return strings.join("?");
}

function allQueryText(): string[] {
  return sqlMock.mock.calls.map((_, i) => queryText(i));
}

const character = { ...buildCharacterLoraEntry("Shazza", []), id: "clora_a", sourceKey: "sb:shazza" };
const row = (revision: number, deleted: string | null = null) => ({
  item_id: "clora_a",
  folder: "sunnybank",
  data: character,
  revision,
  updated_at: new Date("2026-09-30T00:00:00Z"),
  deleted_at: deleted,
});

beforeEach(() => {
  vi.resetModules();
  sqlMock.mockReset();
  process.env = { ...ORIGINAL_ENV, DATABASE_URL: "postgres://u:p@h/db" };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  // Never DDL, in any test.
  for (const q of allQueryText()) expect(q).not.toMatch(/\b(CREATE|ALTER|DROP|TRUNCATE)\b/i);
});

describe("listDeckItems", () => {
  it("unconfigured without DATABASE_URL, no query", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_URL_UNPOOLED;
    const { listDeckItems } = await load();
    expect(await listDeckItems("character")).toMatchObject({ ok: false, reason: "unconfigured" });
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("reports a missing table clearly instead of creating it", async () => {
    sqlMock.mockRejectedValueOnce(Object.assign(new Error('relation "deck_items" does not exist'), { code: "42P01" }));
    const { listDeckItems } = await load();
    const out = await listDeckItems("character");
    expect(out).toMatchObject({ ok: false, reason: "table-missing" });
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it("splits live items from tombstones and says whether the seed has run", async () => {
    sqlMock.mockResolvedValueOnce([row(3), { ...row(2, "2026-09-30T01:00:00Z"), item_id: "clora_gone" }]);
    const { listDeckItems } = await load();
    const out = await listDeckItems("character");
    expect(out).toMatchObject({
      ok: true,
      seeded: true,
      items: [{ itemId: "clora_a", revision: 3, deletedAt: null, updatedAt: "2026-09-30T00:00:00.000Z" }],
      deleted: [{ itemId: "clora_gone", revision: 2 }],
    });
    expect(queryText(0)).toMatch(/^\s*SELECT/);
  });

  it("seeded: false with no rows at all", async () => {
    sqlMock.mockResolvedValueOnce([]);
    const { listDeckItems } = await load();
    expect(await listDeckItems("character")).toMatchObject({ ok: true, seeded: false, items: [] });
  });
});

describe("putDeckItem", () => {
  it("inserts a new item only if the id has never existed (expectedRevision 0)", async () => {
    sqlMock.mockResolvedValueOnce([row(1)]);
    const { putDeckItem } = await load();
    const out = await putDeckItem("character", "clora_a", character, 0);
    expect(out).toMatchObject({ ok: true, item: { revision: 1, folder: "sunnybank" } });
    expect(queryText(0)).toMatch(/INSERT INTO deck_items[\s\S]*ON CONFLICT[\s\S]*DO NOTHING/);
  });

  it("an update copies the prior version to history in the same statement, then trims", async () => {
    sqlMock.mockResolvedValueOnce([row(4)]);
    sqlMock.mockResolvedValueOnce([]);
    const { putDeckItem } = await load();
    const out = await putDeckItem("character", "clora_a", character, 3);
    expect(out).toMatchObject({ ok: true, item: { revision: 4 } });
    expect(queryText(0)).toMatch(/revision = \?[\s\S]*UPDATE deck_items[\s\S]*INSERT INTO deck_item_history/);
    expect(queryText(1)).toMatch(/DELETE FROM deck_item_history/);
  });

  it("a revision mismatch writes nothing and returns the server's copy", async () => {
    sqlMock.mockResolvedValueOnce([]); // guarded UPDATE matched nothing
    sqlMock.mockResolvedValueOnce([row(7)]); // read current
    const { putDeckItem } = await load();
    const out = await putDeckItem("character", "clora_a", character, 3);
    expect(out).toMatchObject({ ok: false, conflict: true, item: { revision: 7 } });
  });

  it("folder comes from the card's sourceKey, not the client", async () => {
    sqlMock.mockResolvedValueOnce([row(1)]);
    const { putDeckItem } = await load();
    await putDeckItem("character", "clora_a", { ...character, sourceKey: "mvx:chr_1" }, 0);
    expect(sqlMock.mock.calls[0]).toContain("music-video");
  });

  it("saves a Sunnybank episode card in the sunnybank folder, whatever the client says", async () => {
    const live = { ...buildEmptySunnyBanksLive(), workspaceTitle: "The Big Wet" };
    const episode = { ...buildSunnyBanksWorkspaceFromLive(live, 1_727_600_000_000, 1), id: "ws-1", folder: "deck" };
    sqlMock.mockResolvedValueOnce([{ ...row(1), item_id: "ws-1", data: episode }]);
    const { putDeckItem } = await load();
    const out = await putDeckItem("sunnybank-episode", "ws-1", episode, 0);
    expect(out).toMatchObject({ ok: true });
    expect(sqlMock.mock.calls[0]).toContain("sunnybank");
    expect(sqlMock.mock.calls[0]).toContain("sunnybank-episode");
  });

  it("refuses an episode whose id doesn't match, or that isn't an episode, without a query", async () => {
    const live = { ...buildEmptySunnyBanksLive(), workspaceTitle: "EP" };
    const episode = { ...buildSunnyBanksWorkspaceFromLive(live, 1, 1), id: "ws-1" };
    const { putDeckItem } = await load();
    expect(await putDeckItem("sunnybank-episode", "ws-2", episode, 0)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await putDeckItem("sunnybank-episode", "ws-1", { id: "ws-1" }, 0)).toMatchObject({ ok: false, reason: "invalid" });
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("refuses data whose id doesn't match, without a query", async () => {
    const { putDeckItem } = await load();
    expect(await putDeckItem("character", "clora_other", character, 0)).toMatchObject({ ok: false, reason: "invalid" });
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("a missing history table is table-missing, not a silent write", async () => {
    sqlMock.mockRejectedValueOnce(Object.assign(new Error('relation "deck_item_history" does not exist'), { code: "42P01" }));
    const { putDeckItem } = await load();
    expect(await putDeckItem("character", "clora_a", character, 2)).toMatchObject({ ok: false, reason: "table-missing" });
  });
});

describe("deleteDeckItem", () => {
  it("soft-deletes (sets deleted_at), keeping history", async () => {
    sqlMock.mockResolvedValueOnce([row(4, "2026-09-30T02:00:00Z")]);
    sqlMock.mockResolvedValueOnce([]);
    const { deleteDeckItem } = await load();
    const out = await deleteDeckItem("character", "clora_a", 3);
    expect(out).toMatchObject({ ok: true, item: { deletedAt: "2026-09-30T02:00:00Z" } });
    expect(queryText(0)).toMatch(/SET deleted_at = now\(\)/);
    expect(queryText(0)).toMatch(/INSERT INTO deck_item_history/);
    expect(queryText(0)).not.toMatch(/DELETE FROM deck_items/);
  });

  it("not found when there is no row", async () => {
    sqlMock.mockResolvedValueOnce([]);
    sqlMock.mockResolvedValueOnce([]);
    const { deleteDeckItem } = await load();
    expect(await deleteDeckItem("character", "clora_a", 3)).toEqual({ ok: false, notFound: true });
  });

  it("conflict when the item changed since", async () => {
    sqlMock.mockResolvedValueOnce([]);
    sqlMock.mockResolvedValueOnce([row(5)]);
    const { deleteDeckItem } = await load();
    expect(await deleteDeckItem("character", "clora_a", 3)).toMatchObject({ ok: false, conflict: true, item: { revision: 5 } });
  });
});
