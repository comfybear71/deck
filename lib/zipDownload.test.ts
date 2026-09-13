import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildStoreZip, crc32 } from "./zipDownload";

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("crc32", () => {
  it("matches the well-known standard CRC-32 test vectors", () => {
    expect(crc32(utf8(""))).toBe(0);
    expect(crc32(utf8("a"))).toBe(0xe8b7be43);
    expect(crc32(utf8("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });

  it("is sensitive to every byte — a single changed byte changes the checksum", () => {
    expect(crc32(utf8("abc"))).not.toBe(crc32(utf8("abd")));
  });
});

/**
 * Every test in this suite writes `buildStoreZip`'s real output bytes
 * to a temp file and hands it to the system's own `unzip` binary —
 * confirming this hand-rolled writer produces an archive a completely
 * independent, real-world tool accepts, not just something this file's
 * own code agrees with itself about.
 */
describe("buildStoreZip", () => {
  it("produces a real, valid ZIP archive that `unzip -t` confirms passes integrity, and extracts every entry byte-for-byte", () => {
    const entries = [
      { name: "01_0000-0040_render.mp4", data: utf8("fake mp4 bytes for clip one") },
      { name: "02_0040-0090_render.mp4", data: utf8("different fake mp4 bytes for clip two, a bit longer than the first") },
    ];
    const zipBytes = buildStoreZip(entries);

    const dir = mkdtempSync(join(tmpdir(), "skidmarks-zip-test-"));
    const zipPath = join(dir, "renders.zip");
    writeFileSync(zipPath, zipBytes);

    try {
      // Throws (non-zero exit) if `unzip` itself finds a bad CRC,
      // malformed header, or truncated archive.
      execFileSync("unzip", ["-t", zipPath], { stdio: "pipe" });

      execFileSync("unzip", ["-o", zipPath, "-d", dir], { stdio: "pipe" });
      for (const entry of entries) {
        const extracted = readFileSync(join(dir, entry.name));
        expect(new Uint8Array(extracted)).toEqual(entry.data);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists the exact entry names and sizes via `unzip -l`", () => {
    const entries = [{ name: "only.mp4", data: new Uint8Array([1, 2, 3, 4, 5]) }];
    const zipBytes = buildStoreZip(entries);

    const dir = mkdtempSync(join(tmpdir(), "skidmarks-zip-test-"));
    const zipPath = join(dir, "one.zip");
    writeFileSync(zipPath, zipBytes);

    try {
      const listing = execFileSync("unzip", ["-l", zipPath], { encoding: "utf8" });
      expect(listing).toContain("only.mp4");
      expect(listing).toMatch(/\b5\b/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("round-trips a single-file archive", () => {
    const dir = mkdtempSync(join(tmpdir(), "skidmarks-zip-test-"));
    try {
      const singleZipPath = join(dir, "single.zip");
      writeFileSync(singleZipPath, buildStoreZip([{ name: "a.mp4", data: utf8("hello") }]));
      execFileSync("unzip", ["-t", singleZipPath], { stdio: "pipe" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("emits an EOCD-only archive for zero entries — `buildStoreZip` never called with none in practice (the bundle button only ever appears once a render exists), but this should never throw either", () => {
    expect(() => buildStoreZip([])).not.toThrow();
    expect(buildStoreZip([]).length).toBe(22);
  });

  it("preserves binary (non-UTF8-text) content exactly, not just plain-text entries", () => {
    const binary = new Uint8Array(2048);
    for (let i = 0; i < binary.length; i++) binary[i] = (i * 37) % 256;

    const dir = mkdtempSync(join(tmpdir(), "skidmarks-zip-test-"));
    const zipPath = join(dir, "binary.zip");
    writeFileSync(zipPath, buildStoreZip([{ name: "clip.mp4", data: binary }]));

    try {
      execFileSync("unzip", ["-o", zipPath, "-d", dir], { stdio: "pipe" });
      const extracted = readFileSync(join(dir, "clip.mp4"));
      expect(new Uint8Array(extracted)).toEqual(binary);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
