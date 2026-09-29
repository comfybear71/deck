import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyBlobTreeProof } from "@/lib/deckCopyBlobTreeAuth";

const neon = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@neondatabase/serverless", () => ({
  neon: () => {
    neon.calls++;
    throw new Error("no database in tests");
  },
}));

import { GET, POST } from "./route";

const FAKE = "postgresql://neondb_owner:test-password-123@ep-test.example/neondb";
const BASE = "https://deck.example/api/deck/admin/copy-blob-tree";

describe("one-off copy-blob-tree route auth", () => {
  beforeEach(() => {
    neon.calls = 0;
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("refuses unauthenticated GET and POST before touching the database", async () => {
    vi.stubEnv("DATABASE_URL", FAKE);
    expect((await GET(new Request(BASE))).status).toBe(401);
    expect((await POST(new Request(`${BASE}?write=1`, { method: "POST" }))).status).toBe(401);
    const wrong = { authorization: `Bearer ${"0".repeat(64)}` };
    expect((await GET(new Request(BASE, { headers: wrong }))).status).toBe(401);
    expect((await POST(new Request(`${BASE}?write=1`, { method: "POST", headers: wrong }))).status).toBe(401);
    expect(neon.calls).toBe(0);
  });

  it("refuses everything when no database is configured", async () => {
    const auth = { authorization: `Bearer ${copyBlobTreeProof(FAKE)}` };
    expect((await GET(new Request(BASE, { headers: auth }))).status).toBe(401);
  });

  it("POST needs ?write=1 and a production deployment", async () => {
    vi.stubEnv("DATABASE_URL", FAKE);
    const auth = { authorization: `Bearer ${copyBlobTreeProof(FAKE)}` };
    expect((await POST(new Request(BASE, { method: "POST", headers: auth }))).status).toBe(400);
    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await POST(new Request(`${BASE}?write=1`, { method: "POST", headers: auth }))).status).toBe(403);
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    expect((await POST(new Request(`${BASE}?write=1`, { method: "POST", headers: auth }))).status).toBe(503);
    expect(neon.calls).toBe(0);
  });
});
