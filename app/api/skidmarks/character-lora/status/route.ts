import { NextResponse } from "next/server";
import { hfResolveLink, loraFileNames, slugifyCharacterName } from "@/lib/characterLoras";
import { resolveHfCredentials, uploadFilesToHf } from "@/lib/hfUpload";
import { convertReplicateTrainedTar } from "@/lib/loraFiles";
import { getTraining, resolveReplicateToken, trainingCostUsd } from "@/lib/replicateTrainer";

/**
 * POST /api/skidmarks/character-lora/status — polled by the Characters
 * screen while a LoRA trains. While Replicate is still going it returns
 * `{ state: "training" }` at once. When the training has succeeded it
 * downloads `trained_model.tar`, converts both files to Comfy's format
 * (`lib/loraFiles.ts`) and uploads them to the private Hugging Face repo,
 * then returns `{ state: "ready", hfRepo, loraFile, embeddingFile }`.
 * Safe to call again after a dropped connection: if both files are
 * already on Hugging Face it skips straight to "ready".
 */

export const runtime = "nodejs";
export const maxDuration = 300;

interface Body {
  trainingId?: unknown;
  slug?: unknown;
  version?: unknown;
  name?: unknown;
}

async function existsOnHf(token: string, repo: string, file: string): Promise<boolean> {
  const res = await fetch(hfResolveLink(repo, file), {
    method: "HEAD",
    headers: { Authorization: `Bearer ${token}` },
    redirect: "manual",
  });
  return res.status === 200 || res.status === 302 || res.status === 307;
}

export async function POST(req: Request) {
  const token = resolveReplicateToken();
  if (!token) return NextResponse.json({ error: "REPLICATE_API_TOKEN isn't set in Vercel." }, { status: 503 });
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const trainingId = typeof body.trainingId === "string" ? body.trainingId : "";
  const slug = slugifyCharacterName(typeof body.slug === "string" ? body.slug : "");
  const version = typeof body.version === "number" && body.version >= 1 ? Math.floor(body.version) : 1;
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : slug;
  if (!trainingId) return NextResponse.json({ error: "Missing training id." }, { status: 400 });

  try {
    const t = await getTraining(token, trainingId);
    if (t.status === "starting" || t.status === "processing") {
      return NextResponse.json({ state: "training", replicateStatus: t.status });
    }
    if (t.status !== "succeeded") {
      return NextResponse.json({
        state: "failed",
        error: t.error ? String(t.error).slice(0, 400) : `Replicate says the training ${t.status}.`,
      });
    }
    const weights = t.output?.weights;
    if (!weights) return NextResponse.json({ state: "failed", error: "Training finished without a weights file." });

    const hf = resolveHfCredentials();
    if (!hf) {
      return NextResponse.json(
        { error: "Training finished, but HF_TOKEN isn't set in Vercel, so it can't be stored yet. Add it and tap Check again." },
        { status: 503 },
      );
    }
    const { loraFile, embeddingFile } = loraFileNames(slug, version);
    const costUsd = trainingCostUsd(t);
    const ready = { state: "ready", hfRepo: hf.repo, loraFile, embeddingFile, costUsd };

    if ((await existsOnHf(hf.token, hf.repo, loraFile)) && (await existsOnHf(hf.token, hf.repo, embeddingFile))) {
      return NextResponse.json(ready);
    }
    const res = await fetch(weights);
    if (!res.ok) throw new Error(`Couldn't download the trained weights (HTTP ${res.status}).`);
    const { lora, embedding } = convertReplicateTrainedTar(new Uint8Array(await res.arrayBuffer()));
    await uploadFilesToHf(
      hf,
      [
        { path: loraFile, bytes: lora },
        { path: embeddingFile, bytes: embedding },
      ],
      `Add ${name} v${version} LoRA (Replicate training ${trainingId})`,
    );
    return NextResponse.json(ready);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Status check failed." }, { status: 502 });
  }
}
