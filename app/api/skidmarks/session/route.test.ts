import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadMock = vi.fn();
const saveMock = vi.fn();
vi.mock("@/lib/skidmarksSession-server", () => ({
  loadSkidmarksSession: (...args: unknown[]) => loadMock(...args),
  saveSkidmarksSession: (...args: unknown[]) => saveMock(...args),
}));

async function importRoute() {
  return await import("./route");
}

function putRequest(body: unknown): Request {
  return new Request("http://localhost/api/skidmarks/session", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  loadMock.mockReset();
  saveMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/skidmarks/session", () => {
  it("returns the real saved state on success", async () => {
    loadMock.mockResolvedValueOnce({ configured: true, state: { bands: [] }, updatedAt: "2026-09-13T00:00:00.000Z" });
    const { GET } = await importRoute();
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ configured: true, state: { bands: [] }, updatedAt: "2026-09-13T00:00:00.000Z" });
  });

  it("returns the honest empty state (state: null) for a brand-new owner row, not an error", async () => {
    loadMock.mockResolvedValueOnce({ configured: true, state: null, updatedAt: null });
    const { GET } = await importRoute();
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ configured: true, state: null, updatedAt: null });
  });

  it("returns configured: false, not a 500, when Neon isn't set up", async () => {
    loadMock.mockResolvedValueOnce({ configured: false, error: "DATABASE_URL is not set." });
    const { GET } = await importRoute();
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ configured: false, state: null, error: "DATABASE_URL is not set." });
  });
});

describe("PUT /api/skidmarks/session", () => {
  it("rejects a non-JSON body without calling saveSkidmarksSession", async () => {
    const { PUT } = await importRoute();
    const res = await PUT(putRequest("not json"));
    expect(res.status).toBe(400);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("rejects a body missing `state`", async () => {
    const { PUT } = await importRoute();
    const res = await PUT(putRequest({}));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("rejects a `state` that isn't a plain object", async () => {
    const { PUT } = await importRoute();
    const res = await PUT(putRequest({ state: "not-an-object" }));
    expect(res.status).toBe(400);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("saves a well-formed state and returns ok: true", async () => {
    saveMock.mockResolvedValueOnce({ ok: true, updatedAt: "2026-09-13T02:00:00.000Z" });
    const state = { bands: [], session: { projectKind: null, bandId: null, mp3: null }, removedSeedBandIds: [] };
    const { PUT } = await importRoute();
    const res = await PUT(putRequest({ state }));
    const body = await res.json();
    expect(saveMock).toHaveBeenCalledWith(state);
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, updatedAt: "2026-09-13T02:00:00.000Z" });
  });

  it("returns an honest 502 failure, not a silent success, when the save itself fails", async () => {
    saveMock.mockResolvedValueOnce({ ok: false, error: "write timeout" });
    const { PUT } = await importRoute();
    const res = await PUT(putRequest({ state: { bands: [] } }));
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body).toEqual({ ok: false, error: "write timeout" });
  });
});
