import { beforeEach, describe, expect, it, vi } from "vitest";

const listMock = vi.fn();
const restoreMock = vi.fn();
vi.mock("@/lib/skidmarksSession-server", () => ({
  listSkidmarksSessionBackups: (...a: unknown[]) => listMock(...a),
  restoreSkidmarksSessionBackup: (...a: unknown[]) => restoreMock(...a),
}));

import { GET, POST } from "./route";

const post = (body: unknown) =>
  new Request("https://deck.test/api/skidmarks/session/backups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  listMock.mockReset();
  restoreMock.mockReset();
});

describe("/api/skidmarks/session/backups", () => {
  it("GET passes the list through", async () => {
    listMock.mockResolvedValueOnce({ ok: true, configured: true, backups: [] });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, configured: true, backups: [] });
  });

  it("POST refuses a missing or bad id without touching the database", async () => {
    const res = await POST(post({ id: "9" }));
    expect(res.status).toBe(400);
    expect(restoreMock).not.toHaveBeenCalled();
  });

  it("POST restores the chosen save", async () => {
    restoreMock.mockResolvedValueOnce({ ok: true, updatedAt: "2026-09-30T00:50:00.000Z", revision: 1450 });
    const res = await POST(post({ id: 9 }));
    expect(restoreMock).toHaveBeenCalledWith(9);
    expect(await res.json()).toEqual({ ok: true, updatedAt: "2026-09-30T00:50:00.000Z", revision: 1450 });
  });

  it("POST reports a missing save as 404", async () => {
    restoreMock.mockResolvedValueOnce({ ok: false, configured: true, error: "That earlier save wasn't found." });
    const res = await POST(post({ id: 9 }));
    expect(res.status).toBe(404);
  });
});
