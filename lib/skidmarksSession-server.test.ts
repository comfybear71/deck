import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `lib/skidmarksSession-server.ts` mocked at the `@neondatabase/
 * serverless` boundary — same "mock the vendor SDK, exercise our own
 * code for real" shape `app/api/skidmarks/clip-renders/route.test.ts`
 * already uses for `@vercel/blob`. `vi.resetModules()` + a dynamic
 * `import()` per test gives each test a fresh `schemaEnsured`/
 * `cachedSql` module singleton, so one test's "table already ensured"
 * cache can't leak into the next.
 */
const sqlMock = vi.fn();
const neonMock = vi.fn();
neonMock.mockReturnValue(sqlMock);
vi.mock("@neondatabase/serverless", () => ({
  neon: (...args: unknown[]) => neonMock(...args),
}));

async function importModule() {
  return await import("./skidmarksSession-server");
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  sqlMock.mockReset();
  neonMock.mockClear();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("loadSkidmarksSession", () => {
  it("returns configured: false, never throwing, when DATABASE_URL isn't set", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_URL_UNPOOLED;
    const { loadSkidmarksSession } = await importModule();
    const outcome = await loadSkidmarksSession();
    expect(outcome).toEqual({
      configured: false,
      error: expect.stringContaining("DATABASE_URL"),
    });
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("returns the honest empty-state outcome (configured: true, state: null) for a brand-new owner row", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@host/db";
    sqlMock.mockResolvedValueOnce([]); // CREATE TABLE
    sqlMock.mockResolvedValueOnce([]); // ALTER TABLE — revision column
    sqlMock.mockResolvedValueOnce([]); // SELECT — no row yet
    const { loadSkidmarksSession, SKIDMARKS_SESSION_NO_ROW_REVISION } = await importModule();
    const outcome = await loadSkidmarksSession();
    // Revision 0 is "I read the row and there wasn't one" — the only
    // value that lets a genuinely first-ever save insert.
    expect(outcome).toEqual({
      configured: true,
      state: null,
      updatedAt: null,
      revision: SKIDMARKS_SESSION_NO_ROW_REVISION,
    });
  });

  it("returns the real saved state once a row exists", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@host/db";
    const savedState = { bands: [], session: { projectKind: null, bandId: null, mp3: null }, removedSeedBandIds: [] };
    sqlMock.mockResolvedValueOnce([]); // CREATE TABLE
    sqlMock.mockResolvedValueOnce([]); // ALTER TABLE — revision column
    sqlMock.mockResolvedValueOnce([
      { state: savedState, updated_at: "2026-09-13T00:00:00.000Z", revision: "7" },
    ]);
    const { loadSkidmarksSession } = await importModule();
    const outcome = await loadSkidmarksSession();
    // Neon hands BIGINT back as a string — it has to come out a number.
    expect(outcome).toEqual({
      configured: true,
      state: savedState,
      updatedAt: "2026-09-13T00:00:00.000Z",
      revision: 7,
    });
  });

  it("returns an honest configured:false failure, not a throw, when the query itself errors", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@host/db";
    sqlMock.mockRejectedValueOnce(new Error("connection refused"));
    const { loadSkidmarksSession } = await importModule();
    const outcome = await loadSkidmarksSession();
    expect(outcome).toEqual({ configured: false, error: "connection refused" });
  });

  it("falls back to DATABASE_URL_UNPOOLED when DATABASE_URL isn't set", async () => {
    delete process.env.DATABASE_URL;
    process.env.DATABASE_URL_UNPOOLED = "postgres://user:pass@host/db-unpooled";
    sqlMock.mockResolvedValueOnce([]);
    sqlMock.mockResolvedValueOnce([]);
    sqlMock.mockResolvedValueOnce([]);
    const { loadSkidmarksSession } = await importModule();
    await loadSkidmarksSession();
    expect(neonMock).toHaveBeenCalledWith("postgres://user:pass@host/db-unpooled");
  });
});

describe("saveSkidmarksSession", () => {
  it("returns ok: false, configured: false, never throwing, when DATABASE_URL isn't set", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_URL_UNPOOLED;
    const { saveSkidmarksSession } = await importModule();
    const outcome = await saveSkidmarksSession({ bands: [] });
    expect(outcome).toEqual({ ok: false, configured: false, error: expect.stringContaining("DATABASE_URL") });
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("upserts and returns the real updatedAt on success", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@host/db";
    sqlMock.mockResolvedValueOnce([]); // CREATE TABLE
    sqlMock.mockResolvedValueOnce([]); // ALTER TABLE — revision column
    sqlMock.mockResolvedValueOnce([{ updated_at: "2026-09-13T01:00:00.000Z", revision: 4 }]);
    const { saveSkidmarksSession } = await importModule();
    // No `expectedRevision`: the pre-2026-09-18 unconditional upsert,
    // still supported so a mid-deploy tab on the old client keeps saving.
    const outcome = await saveSkidmarksSession({ bands: [] });
    expect(outcome).toEqual({ ok: true, updatedAt: "2026-09-13T01:00:00.000Z", revision: 4 });
  });

  it("returns an honest ok:false, configured:true failure, not a throw, when the upsert itself errors", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@host/db";
    sqlMock.mockResolvedValueOnce([]); // CREATE TABLE
    sqlMock.mockResolvedValueOnce([]); // ALTER TABLE — revision column
    sqlMock.mockRejectedValueOnce(new Error("write timeout"));
    const { saveSkidmarksSession } = await importModule();
    const outcome = await saveSkidmarksSession({ bands: [] });
    expect(outcome).toEqual({ ok: false, configured: true, error: "write timeout" });
  });
});

describe("SKIDMARKS_STUDIO_OWNER_ID", () => {
  it("defaults to the literal 'stuart' — single-user, no auth system", async () => {
    delete process.env.SKIDMARKS_STUDIO_OWNER_ID;
    const { SKIDMARKS_STUDIO_OWNER_ID } = await importModule();
    expect(SKIDMARKS_STUDIO_OWNER_ID).toBe("stuart");
  });

  it("is overridable via env var for a separate environment", async () => {
    process.env.SKIDMARKS_STUDIO_OWNER_ID = "staging";
    const { SKIDMARKS_STUDIO_OWNER_ID } = await importModule();
    expect(SKIDMARKS_STUDIO_OWNER_ID).toBe("staging");
  });
});

describe("saveSkidmarksSession compare-and-swap (2026-09-18)", () => {
  /** The reported failure this exists for: a second device opened the
   * app, showed an older copy, and its next autosave would have pushed
   * that older copy straight over the good one. */
  async function withSchema() {
    process.env.DATABASE_URL = "postgres://user:pass@host/db";
    sqlMock.mockResolvedValueOnce([]); // CREATE TABLE
    sqlMock.mockResolvedValueOnce([]); // ALTER TABLE
    return await importModule();
  }

  it("writes when the caller's revision still matches the row", async () => {
    const { saveSkidmarksSession } = await withSchema();
    sqlMock.mockResolvedValueOnce([{ updated_at: "2026-09-18T05:00:00.000Z", revision: "9" }]);
    const outcome = await saveSkidmarksSession({ bands: [] }, 8);
    expect(outcome).toEqual({ ok: true, updatedAt: "2026-09-18T05:00:00.000Z", revision: 9 });
  });

  it("refuses, never overwrites, when the row moved on since the caller read it", async () => {
    const { saveSkidmarksSession } = await withSchema();
    sqlMock.mockResolvedValueOnce([]); // UPDATE ... WHERE revision = 3 matched nothing
    sqlMock.mockResolvedValueOnce([
      { state: { bands: [] }, updated_at: "2026-09-18T06:00:00.000Z", revision: "12" },
    ]); // re-read of what is actually there
    const outcome = await saveSkidmarksSession({ bands: [] }, 3);
    expect(outcome).toMatchObject({
      ok: false,
      conflict: true,
      configured: true,
      revision: 12,
      updatedAt: "2026-09-18T06:00:00.000Z",
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/another device|changed since/i);
  });

  it("revision 0 inserts a genuinely first-ever row", async () => {
    const { saveSkidmarksSession, SKIDMARKS_SESSION_NO_ROW_REVISION } = await withSchema();
    sqlMock.mockResolvedValueOnce([{ updated_at: "2026-09-18T07:00:00.000Z", revision: 1 }]);
    const outcome = await saveSkidmarksSession({ bands: [] }, SKIDMARKS_SESSION_NO_ROW_REVISION);
    expect(outcome).toEqual({ ok: true, updatedAt: "2026-09-18T07:00:00.000Z", revision: 1 });
  });

  it("revision 0 against a row that already exists is a conflict, not a clobber", async () => {
    const { saveSkidmarksSession } = await withSchema();
    sqlMock.mockResolvedValueOnce([]); // INSERT ... ON CONFLICT DO NOTHING wrote nothing
    sqlMock.mockResolvedValueOnce([
      { state: { bands: [] }, updated_at: "2026-09-18T08:00:00.000Z", revision: "2" },
    ]);
    const outcome = await saveSkidmarksSession({ bands: [] }, 0);
    expect(outcome).toMatchObject({ ok: false, conflict: true, revision: 2 });
  });

  it("an unparseable revision reads as a real row, never as absent", async () => {
    // Guessing "absent" would hand a stale client a green light to
    // insert over live work — the exact thing this guards.
    process.env.DATABASE_URL = "postgres://user:pass@host/db";
    sqlMock.mockResolvedValueOnce([]); // CREATE TABLE
    sqlMock.mockResolvedValueOnce([]); // ALTER TABLE
    sqlMock.mockResolvedValueOnce([
      { state: { bands: [] }, updated_at: "2026-09-18T09:00:00.000Z", revision: null },
    ]);
    const { loadSkidmarksSession, SKIDMARKS_SESSION_NO_ROW_REVISION } = await importModule();
    const outcome = await loadSkidmarksSession();
    expect(outcome.configured).toBe(true);
    if (!outcome.configured) return;
    expect(outcome.revision).toBe(1);
    expect(outcome.revision).not.toBe(SKIDMARKS_SESSION_NO_ROW_REVISION);
  });
});
