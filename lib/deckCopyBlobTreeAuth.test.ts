import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { COPY_BLOB_TREE_PROOF_MESSAGE, connectionPassword, copyBlobTreeProof, isCopyBlobTreeAuthorized } from "./deckCopyBlobTreeAuth";

const CONN = "postgresql://neondb_owner:p%40ss-w0rd-xyz@ep-x-pooler.example.neon.tech/neondb?sslmode=require";
const proof = createHmac("sha256", "p@ss-w0rd-xyz").update(COPY_BLOB_TREE_PROOF_MESSAGE).digest("hex");

describe("copy-blob-tree auth", () => {
  it("derives the proof from the decoded connection password", () => {
    expect(connectionPassword(CONN)).toBe("p@ss-w0rd-xyz");
    expect(copyBlobTreeProof(CONN)).toBe(proof);
  });

  it("accepts only the right bearer proof", () => {
    expect(isCopyBlobTreeAuthorized(`Bearer ${proof}`, CONN)).toBe(true);
    expect(isCopyBlobTreeAuthorized(`bearer ${proof.toUpperCase()}`, CONN)).toBe(true);
    expect(isCopyBlobTreeAuthorized(null, CONN)).toBe(false);
    expect(isCopyBlobTreeAuthorized("", CONN)).toBe(false);
    expect(isCopyBlobTreeAuthorized(proof, CONN)).toBe(false);
    expect(isCopyBlobTreeAuthorized(`Bearer ${proof.slice(0, 63)}0`, CONN)).toBe(false);
    expect(isCopyBlobTreeAuthorized("Bearer p@ss-w0rd-xyz", CONN)).toBe(false);
  });

  it("refuses everything when there is no usable connection string", () => {
    expect(isCopyBlobTreeAuthorized(`Bearer ${proof}`, null)).toBe(false);
    expect(isCopyBlobTreeAuthorized(`Bearer ${proof}`, "not a url")).toBe(false);
    expect(isCopyBlobTreeAuthorized(`Bearer ${copyBlobTreeProof("postgresql://u:short@h/db")}`, "postgresql://u:short@h/db")).toBe(false);
    expect(isCopyBlobTreeAuthorized(`Bearer ${proof}`, "postgresql://neondb_owner:other-password@h/db")).toBe(false);
  });
});
