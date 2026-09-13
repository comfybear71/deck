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
const neonMock = vi.fn(() => sqlMock);
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
    sqlMock.mockResolvedValueOnce([]); // SELECT — no row yet
    const { loadSkidmarksSession } = await importModule();
    const outcome = await loadSkidmarksSession();
    expect(outcome).toEqual({ configured: true, state: null, updatedAt: null });
  });

  it("returns the real saved state once a row exists", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@host/db";
    const savedState = { bands: [], session: { projectKind: null, bandId: null, mp3: null }, removedSeedBandIds: [] };
    sqlMock.mockResolvedValueOnce([]); // CREATE TABLE
    sqlMock.mockResolvedValueOnce([{ state: savedState, updated_at: "2026-09-13T00:00:00.000Z" }]);
    const { loadSkidmarksSession } = await importModule();
    const outcome = await loadSkidmarksSession();
    expect(outcome).toEqual({ configured: true, state: savedState, updatedAt: "2026-09-13T00:00:00.000Z" });
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
    sqlMock.mockResolvedValueOnce([{ updated_at: "2026-09-13T01:00:00.000Z" }]); // INSERT ... RETURNING
    const { saveSkidmarksSession } = await importModule();
    const outcome = await saveSkidmarksSession({ bands: [] });
    expect(outcome).toEqual({ ok: true, updatedAt: "2026-09-13T01:00:00.000Z" });
  });

  it("returns an honest ok:false, configured:true failure, not a throw, when the upsert itself errors", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@host/db";
    sqlMock.mockResolvedValueOnce([]); // CREATE TABLE
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
