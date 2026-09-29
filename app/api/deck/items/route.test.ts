import { beforeEach, describe, expect, it, vi } from "vitest";

const listMock = vi.fn();
const putMock = vi.fn();
const deleteMock = vi.fn();
vi.mock("@/lib/deckItems-server", () => ({
  listDeckItems: (...a: unknown[]) => listMock(...a),
  putDeckItem: (...a: unknown[]) => putMock(...a),
  deleteDeckItem: (...a: unknown[]) => deleteMock(...a),
}));

const route = () => import("./route");
const url = (q = "") => `http://localhost/api/deck/items${q}`;
const put = (body: unknown) =>
  new Request(url(), { method: "PUT", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(() => {
  listMock.mockReset();
  putMock.mockReset();
  deleteMock.mockReset();
});

describe("GET /api/deck/items", () => {
  it("needs a known kind", async () => {
    const { GET } = await route();
    expect((await GET(new Request(url("?kind=nope")))).status).toBe(400);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("returns live items, tombstones and seeded", async () => {
    listMock.mockResolvedValueOnce({ ok: true, items: [{ itemId: "clora_a", revision: 2 }], deleted: [], seeded: true });
    const { GET } = await route();
    const res = await GET(new Request(url("?kind=character")));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      configured: true,
      ready: true,
      seeded: true,
      items: [{ itemId: "clora_a", revision: 2 }],
      deleted: [],
    });
  });

  it("accepts the Sunnybank episode kind and passes it through", async () => {
    listMock.mockResolvedValueOnce({ ok: true, items: [], deleted: [], seeded: false });
    const { GET } = await route();
    const res = await GET(new Request(url("?kind=sunnybank-episode")));
    expect(res.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith("sunnybank-episode");
    expect(await res.json()).toMatchObject({ ok: true, seeded: false, items: [] });
  });

  it("503 with tableMissing when the migration hasn't run", async () => {
    listMock.mockResolvedValueOnce({ ok: false, reason: "table-missing", error: "missing" });
    const { GET } = await route();
    const res = await GET(new Request(url("?kind=character")));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ready: false, tableMissing: true });
  });

  it("configured: false (200) with no database", async () => {
    listMock.mockResolvedValueOnce({ ok: false, reason: "unconfigured", error: "no db" });
    const { GET } = await route();
    const res = await GET(new Request(url("?kind=character")));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ configured: false, ready: false });
  });
});

describe("PUT /api/deck/items", () => {
  it("requires expectedRevision", async () => {
    const { PUT } = await route();
    const res = await PUT(put({ kind: "character", itemId: "clora_a", data: {} }));
    expect(res.status).toBe(400);
    expect(putMock).not.toHaveBeenCalled();
  });

  it("rejects a bad body", async () => {
    const { PUT } = await route();
    expect((await PUT(put("nope"))).status).toBe(400);
    expect((await PUT(put({ kind: "character", itemId: "bad id", expectedRevision: 0 }))).status).toBe(400);
  });

  it("409 with the server's copy on a revision mismatch", async () => {
    putMock.mockResolvedValueOnce({ ok: false, conflict: true, item: { itemId: "clora_a", revision: 9 } });
    const { PUT } = await route();
    const res = await PUT(put({ kind: "character", itemId: "clora_a", expectedRevision: 3, data: { id: "clora_a" } }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ conflict: true, item: { revision: 9 } });
    expect(putMock).toHaveBeenCalledWith("character", "clora_a", { id: "clora_a" }, 3);
  });

  it("200 with the saved item", async () => {
    putMock.mockResolvedValueOnce({ ok: true, item: { itemId: "clora_a", revision: 1 } });
    const { PUT } = await route();
    const res = await PUT(put({ kind: "character", itemId: "clora_a", expectedRevision: 0, data: { id: "clora_a" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, item: { itemId: "clora_a", revision: 1 } });
  });
});

describe("DELETE /api/deck/items", () => {
  it("soft-deletes with the expected revision", async () => {
    deleteMock.mockResolvedValueOnce({ ok: true, item: { itemId: "clora_a", revision: 4, deletedAt: "t" } });
    const { DELETE } = await route();
    const res = await DELETE(new Request(url("?kind=character&itemId=clora_a&expectedRevision=3"), { method: "DELETE" }));
    expect(res.status).toBe(200);
    expect(deleteMock).toHaveBeenCalledWith("character", "clora_a", 3);
  });

  it("404 when there is no such item", async () => {
    deleteMock.mockResolvedValueOnce({ ok: false, notFound: true });
    const { DELETE } = await route();
    const res = await DELETE(new Request(url("?kind=character&itemId=clora_a"), { method: "DELETE" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ notFound: true });
  });

  it("rejects a malformed revision", async () => {
    const { DELETE } = await route();
    const res = await DELETE(new Request(url("?kind=character&itemId=clora_a&expectedRevision=abc"), { method: "DELETE" }));
    expect(res.status).toBe(400);
  });
});
