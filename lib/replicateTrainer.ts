/**
 * Character LoRAs (2026-09-29) — server-only Replicate calls for the
 * "Train LoRA" button. Uses Replicate's official `stability-ai/sdxl`
 * trainer (same SDXL family as Juggernaut XL, which Comfy Cloud has),
 * the exact settings the Skye pilot trained with: 1000 steps, 1024px,
 * face-detection masks, LoRA on, one trigger token. Skye's run took
 * ~4.5 minutes on an L40S and cost about US$0.27.
 *
 * Needs `REPLICATE_API_TOKEN`. Each character trains into its own
 * private Replicate model (`<account>/deck-lora-<slug>`), created on
 * the first run — Replicate requires a destination model.
 */

import { captionPrefix, type CharacterTrainingStyle } from "./characterLoras";

const API = "https://api.replicate.com/v1";

/** `stability-ai/sdxl` trainer version the Skye pilot used. */
export const SDXL_TRAINER_VERSION = "7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc";

export function resolveReplicateToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const t = (env.REPLICATE_API_TOKEN ?? env.REPLICATE_API_KEY ?? "").trim();
  return t || null;
}

async function rep<T>(token: string, path: string, init: RequestInit, what: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as { detail?: string; title?: string };
      detail = j.detail ?? j.title ?? detail;
    } catch {
      /* keep raw text */
    }
    throw new Error(`Replicate ${what} failed (HTTP ${res.status}): ${detail}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export async function getReplicateUsername(token: string): Promise<string> {
  const acct = await rep<{ username?: string }>(token, "/account", { method: "GET" }, "account lookup");
  if (!acct.username) throw new Error("Replicate didn't say which account this token belongs to.");
  return acct.username;
}

/** Creates `<owner>/<name>` as a private model unless it already exists. */
export async function ensureReplicateModel(token: string, owner: string, name: string): Promise<void> {
  const res = await fetch(`${API}/models/${owner}/${name}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.ok) return;
  if (res.status !== 404) throw new Error(`Replicate model lookup failed (HTTP ${res.status}).`);
  await rep(
    token,
    "/models",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner,
        name,
        visibility: "private",
        hardware: "gpu-l40s",
        description: "Deck character LoRA (fictional adult character).",
      }),
    },
    "model create",
  );
}

/** Uploads the training zip; returns the URL Replicate accepts as `input_images`. */
export async function uploadReplicateFile(token: string, zip: Uint8Array, filename: string): Promise<string> {
  const form = new FormData();
  form.append("content", new Blob([zip as BlobPart], { type: "application/zip" }), filename);
  const file = await rep<{ urls?: { get?: string } }>(token, "/files", { method: "POST", body: form }, "file upload");
  const url = file.urls?.get;
  if (!url) throw new Error("Replicate accepted the pictures but returned no file URL.");
  return url;
}

export interface SdxlTrainingInput {
  inputImagesUrl: string;
  /** The word after the trigger in every caption, e.g. "woman". */
  subjectWord: string;
  style?: CharacterTrainingStyle;
}

/** The trainer input, kept pure so the exact settings are unit tested. */
export function buildSdxlTrainingInput({
  inputImagesUrl,
  subjectWord,
  style = "photo",
}: SdxlTrainingInput): Record<string, unknown> {
  return {
    input_images: inputImagesUrl,
    input_images_filetype: "zip",
    token_string: "TOK",
    caption_prefix: captionPrefix(style, "TOK", subjectWord),
    // Face detection crops around a real face. A cartoon or a
    // shadow-faced silhouette has none to find, so it trains on the
    // whole picture instead.
    use_face_detection_instead: style === "photo",
    is_lora: true,
    resolution: 1024,
    max_train_steps: 1000,
    seed: 42,
  };
}

export interface ReplicateTraining {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  error?: string | null;
  output?: { version?: string; weights?: string } | null;
  metrics?: { predict_time?: number } | null;
}

export async function startSdxlTraining(
  token: string,
  destination: string,
  input: Record<string, unknown>,
): Promise<ReplicateTraining> {
  return rep<ReplicateTraining>(
    token,
    `/models/stability-ai/sdxl/versions/${SDXL_TRAINER_VERSION}/trainings`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destination, input }),
    },
    "training start",
  );
}

export async function getTraining(token: string, id: string): Promise<ReplicateTraining> {
  if (!/^[a-z0-9]+$/i.test(id)) throw new Error("That doesn't look like a Replicate training id.");
  return rep<ReplicateTraining>(token, `/trainings/${id}`, { method: "GET" }, "training lookup");
}

/** L40S rate Replicate bills the SDXL trainer at (per second of run time). */
export const REPLICATE_L40S_USD_PER_SEC = 0.000975;

export function trainingCostUsd(t: Pick<ReplicateTraining, "metrics">): number | null {
  const s = t.metrics?.predict_time;
  return typeof s === "number" && s > 0 ? Math.round(s * REPLICATE_L40S_USD_PER_SEC * 100) / 100 : null;
}
