import { beforeEach, describe, expect, it, vi } from "vitest";

const listMock = vi.fn();
vi.mock("@vercel/blob", () => ({ list: (...a: unknown[]) => listMock(...a) }));

import { GET } from "./route";

const req = (q: string) => new Request(`https://deck.test/api/skidmarks/picture-finder${q}`);
const blob = (pathname: string, uploadedAt: string) => ({ pathname, url: `https://x/${pathname}`, uploadedAt: new Date(uploadedAt), size: 10 });

beforeEach(() => listMock.mockReset());

describe("GET /api/skidmarks/picture-finder", () => {
  it("lists member photos oldest first inside the time window", async () => {
    listMock.mockResolvedValueOnce({
      blobs: [
        blob("skidmarks/member-photos/c.png", "2026-09-29T12:30:00Z"),
        blob("skidmarks/member-photos/a.png", "2026-09-29T11:00:00Z"),
        blob("skidmarks/member-photos/old.png", "2026-09-20T11:00:00Z"),
      ],
      hasMore: false,
    });
    const res = await GET(req("?since=2026-09-29T00:00:00Z"));
    const body = await res.json();
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ prefix: "skidmarks/member-photos/" }));
    expect(body.configured).toBe(true);
    expect(body.items.map((i: { pathname: string }) => i.pathname)).toEqual([
      "skidmarks/member-photos/a.png",
      "skidmarks/member-photos/c.png",
    ]);
  });

  it("follows pages", async () => {
    listMock.mockResolvedValueOnce({ blobs: [blob("skidmarks/member-photos/1.png", "2026-09-29T11:00:00Z")], hasMore: true, cursor: "n" });
    listMock.mockResolvedValueOnce({ blobs: [blob("skidmarks/member-photos/2.png", "2026-09-29T11:01:00Z")], hasMore: false });
    const body = await (await GET(req(""))).json();
    expect(body.count).toBe(2);
    expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "n" }));
  });

  it("refuses prefixes outside skidmarks/", async () => {
    const res = await GET(req("?prefix=other/"));
    expect(res.status).toBe(400);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("reports configured:false, not a 500, when Blob is not set up", async () => {
    listMock.mockRejectedValueOnce(new Error("no BLOB_READ_WRITE_TOKEN"));
    const body = await (await GET(req(""))).json();
    expect(body).toMatchObject({ configured: false, items: [] });
  });
});
