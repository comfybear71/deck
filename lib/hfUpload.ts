/**
 * Character LoRAs (2026-09-29) — server-only upload of the trained,
 * Comfy-ready files into Stuart's private Hugging Face model repo
 * (`HF_LORA_REPO`, default `comfybear71/deck-loras`), so Comfy Cloud's
 * Model Library → Import can pull them with his saved HF secret.
 *
 * Plain `fetch` against Hugging Face's public Hub HTTP API (no SDK):
 * 1. `preupload` asks which paths must go through LFS (big binaries do);
 * 2. LFS files are pushed with the git-lfs batch API (basic single PUT,
 *    or multipart when the Hub hands back a `chunk_size`);
 * 3. one `commit` records every file on `main`.
 * Needs `HF_TOKEN` with **write** access.
 */

import { createHash } from "node:crypto";

const HF = "https://huggingface.co";
export const DEFAULT_HF_LORA_REPO = "comfybear71/deck-loras";

export interface HfUploadFile {
  path: string;
  bytes: Uint8Array;
}

export interface HfCredentials {
  token: string;
  repo: string;
}

export function resolveHfCredentials(env: NodeJS.ProcessEnv = process.env): HfCredentials | null {
  const token = (env.HF_TOKEN ?? env.HUGGINGFACE_TOKEN ?? "").trim();
  if (!token) return null;
  const repo = (env.HF_LORA_REPO ?? DEFAULT_HF_LORA_REPO).trim() || DEFAULT_HF_LORA_REPO;
  return { token, repo };
}

async function hfJson<T>(url: string, init: RequestInit, what: string): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`Hugging Face ${what} failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** Makes sure the private model repo exists (a 409 "already exists" is fine). */
export async function ensureHfRepo(creds: HfCredentials): Promise<void> {
  const [organization, name] = creds.repo.split("/");
  const res = await fetch(`${HF}/api/repos/create`, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "model", name, organization, private: true }),
  });
  if (res.ok || res.status === 409) return;
  const text = await res.text();
  throw new Error(`Hugging Face repo create failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
}

interface LfsAction {
  href: string;
  header?: Record<string, string>;
}

interface LfsBatchObject {
  oid: string;
  size: number;
  actions?: { upload?: LfsAction; verify?: LfsAction };
  error?: { code: number; message: string };
}

async function uploadLfsObject(creds: HfCredentials, bytes: Uint8Array, oid: string): Promise<void> {
  const batch = await hfJson<{ objects: LfsBatchObject[] }>(
    `${HF}/${creds.repo}.git/info/lfs/objects/batch`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.token}`,
        Accept: "application/vnd.git-lfs+json",
        "Content-Type": "application/vnd.git-lfs+json",
      },
      body: JSON.stringify({
        operation: "upload",
        transfers: ["basic", "multipart"],
        hash_algo: "sha256",
        ref: { name: "main" },
        objects: [{ oid, size: bytes.length }],
      }),
    },
    "LFS batch",
  );
  const obj = batch.objects?.[0];
  if (!obj) throw new Error("Hugging Face LFS batch returned no object.");
  if (obj.error) throw new Error(`Hugging Face LFS refused the file: ${obj.error.message}`);
  const upload = obj.actions?.upload;
  if (!upload) return; // Already stored on the Hub.

  const header = upload.header ?? {};
  const chunkSize = header.chunk_size ? parseInt(header.chunk_size, 10) : 0;
  if (chunkSize > 0) {
    const partKeys = Object.keys(header)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b));
    const parts: { partNumber: number; etag: string }[] = [];
    for (const k of partKeys) {
      const i = Number(k);
      const chunk = bytes.subarray((i - 1) * chunkSize, Math.min(i * chunkSize, bytes.length));
      const res = await fetch(header[k], { method: "PUT", body: new Blob([chunk as BlobPart]) });
      if (!res.ok) throw new Error(`Hugging Face part ${i} upload failed (HTTP ${res.status}).`);
      parts.push({ partNumber: i, etag: res.headers.get("etag") ?? "" });
    }
    const done = await fetch(upload.href, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.token}`,
        Accept: "application/vnd.git-lfs+json",
        "Content-Type": "application/vnd.git-lfs+json",
      },
      body: JSON.stringify({ oid, parts }),
    });
    if (!done.ok) throw new Error(`Hugging Face multipart finish failed (HTTP ${done.status}).`);
  } else {
    const res = await fetch(upload.href, { method: "PUT", headers: header, body: new Blob([bytes as BlobPart]) });
    if (!res.ok) throw new Error(`Hugging Face LFS upload failed (HTTP ${res.status}).`);
  }
  const verify = obj.actions?.verify;
  if (verify) {
    const res = await fetch(verify.href, {
      method: "POST",
      headers: { ...(verify.header ?? {}), "Content-Type": "application/vnd.git-lfs+json" },
      body: JSON.stringify({ oid, size: bytes.length }),
    });
    if (!res.ok) throw new Error(`Hugging Face LFS verify failed (HTTP ${res.status}).`);
  }
}

/** Uploads every file and records them in one commit on `main`. */
export async function uploadFilesToHf(creds: HfCredentials, files: HfUploadFile[], summary: string): Promise<void> {
  await ensureHfRepo(creds);
  const pre = await hfJson<{ files: { path: string; uploadMode: "lfs" | "regular" }[] }>(
    `${HF}/api/models/${creds.repo}/preupload/main`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        files: files.map((f) => ({
          path: f.path,
          size: f.bytes.length,
          sample: Buffer.from(f.bytes.subarray(0, 512)).toString("base64"),
        })),
      }),
    },
    "preupload",
  );
  const mode = new Map(pre.files.map((f) => [f.path, f.uploadMode]));
  const lines: string[] = [JSON.stringify({ key: "header", value: { summary } })];
  for (const f of files) {
    if (mode.get(f.path) === "lfs") {
      const oid = createHash("sha256").update(f.bytes).digest("hex");
      await uploadLfsObject(creds, f.bytes, oid);
      lines.push(JSON.stringify({ key: "lfsFile", value: { path: f.path, algo: "sha256", oid, size: f.bytes.length } }));
    } else {
      lines.push(
        JSON.stringify({
          key: "file",
          value: { path: f.path, content: Buffer.from(f.bytes).toString("base64"), encoding: "base64" },
        }),
      );
    }
  }
  await hfJson(
    `${HF}/api/models/${creds.repo}/commit/main`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/x-ndjson" },
      body: lines.join("\n"),
    },
    "commit",
  );
}

/** The direct download link Comfy Cloud's Import box takes. */
export function hfResolveUrl(repo: string, path: string): string {
  return `${HF}/${repo}/resolve/main/${path.split("/").map(encodeURIComponent).join("/")}`;
}
