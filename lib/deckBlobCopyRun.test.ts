import { beforeEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => ({
  store: new Map<string, string>(),
  copy: vi.fn(),
  head: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({ copy: blob.copy, head: blob.head, del: blob.del }));

import { blobPublicUrl, parseMovePlanCsv } from "./deckBlobCopyPlan";
import { copyRow, writeTokenProblem } from "./deckBlobCopyRun";

const HOST_URL = (p: string) => blobPublicUrl(p);
const OLD = "skidmarks/member-photos/ae681a24-c05d-4a51-acf1-e31ba99a6117.jpg";
const NEW = "deck/sunnybank/characters/shazza/plates/shazza-plate-01.jpg";
const [row] = parseMovePlanCsv(`old,new,owner,role,also,also_in_song_archives,bytes\n${OLD},${NEW},Character Shazza,plate,,,3\n`);
const src = { size: 3, contentType: "image/jpeg" } as never;

beforeEach(() => {
  blob.store.clear();
  blob.store.set(OLD, "abc");
  blob.copy.mockReset().mockImplementation(async (_from: string, to: string) => {
    if (blob.store.has(to)) throw new Error(`Vercel Blob: This blob already exists`);
    blob.store.set(to, blob.store.get(OLD)!);
    return { url: HOST_URL(to), pathname: to };
  });
  blob.head.mockReset().mockImplementation(async (url: string) => {
    const p = new URL(url).pathname.slice(1);
    return { url, pathname: p, size: blob.store.get(p)!.length, contentType: "image/jpeg" };
  });
  vi.stubGlobal("fetch", async (url: string) => {
    const p = new URL(url).pathname.slice(1);
    return new Response(blob.store.get(p) ?? "", { status: blob.store.has(p) ? 200 : 404 });
  });
});

describe("copyRow (shared by the CLI and the one-off route)", () => {
  it("copies to the planned name without overwriting", async () => {
    const res = await copyRow(row, src, new Set([NEW]), "t");
    expect(res).toEqual({ landed: NEW, outcome: "copied" });
    expect(blob.copy).toHaveBeenCalledWith(HOST_URL(OLD), NEW, expect.objectContaining({ allowOverwrite: false, addRandomSuffix: false }));
  });

  it("re-running reuses an identical copy instead of duplicating it", async () => {
    await copyRow(row, src, new Set([NEW]), "t");
    const again = await copyRow(row, src, new Set([NEW]), "t");
    expect(again).toEqual({ landed: NEW, outcome: "reused" });
    expect([...blob.store.keys()].filter((k) => k.startsWith("deck/"))).toEqual([NEW]);
  });

  it("moves to -v2 when the name holds a different file, and never deletes", async () => {
    blob.store.set(NEW, "xyz");
    const res = await copyRow(row, src, new Set([NEW]), "t");
    expect(res.landed).toBe(NEW.replace(".jpg", "-v2.jpg"));
    expect(blob.store.get(NEW)).toBe("xyz");
    expect(blob.store.get(OLD)).toBe("abc");
    expect(blob.del).not.toHaveBeenCalled();
  });
});

describe("writeTokenProblem", () => {
  it("refuses a missing token or one for another store", () => {
    expect(writeTokenProblem(undefined)).toMatch(/not set/);
    expect(writeTokenProblem("vercel_blob_rw_otherstore_abc")).toMatch(/different store/);
    expect(writeTokenProblem("vercel_blob_rw_klpgwmpsxnp9aoca_abc")).toBeNull();
  });
});
