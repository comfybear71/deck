import { NextResponse } from "next/server";
import {
  CHARACTER_LORA_MAX_IMAGES,
  CHARACTER_LORA_MIN_IMAGES,
  isAllowedTrainingImageUrl,
  replicateModelName,
  slugifyCharacterName,
} from "@/lib/characterLoras";
import { decodeDataUrl } from "@/lib/dataUrl";
import { buildStoredZip } from "@/lib/loraFiles";
import {
  buildSdxlTrainingInput,
  ensureReplicateModel,
  getReplicateUsername,
  resolveReplicateToken,
  startSdxlTraining,
  uploadReplicateFile,
} from "@/lib/replicateTrainer";

/**
 * POST /api/skidmarks/character-lora/train — Character LoRAs' Train
 * button. Fetches the card's training pictures (Deck's Blob store only),
 * zips them, uploads the zip to Replicate, makes sure the character's
 * private Replicate model exists, and starts an SDXL LoRA training.
 * Returns `{ trainingId }` straight away; the client then polls
 * `/api/skidmarks/character-lora/status`. This is the one paid call
 * (about US$0.30), so it only runs on a deliberate tap.
 */

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

interface Body {
  name?: unknown;
  slug?: unknown;
  subjectWord?: unknown;
  imageUrls?: unknown;
  fictionalAdultConfirmed?: unknown;
}

function extFor(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}

async function loadImage(url: string): Promise<{ bytes: Uint8Array; mime: string }> {
  if (url.startsWith("data:")) {
    const d = decodeDataUrl(url);
    if (!d) throw new Error("One picture couldn't be read.");
    return { bytes: d.bytes, mime: d.mimeType };
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`One picture couldn't be downloaded (HTTP ${res.status}).`);
  const mime = res.headers.get("content-type") ?? "image/jpeg";
  if (!mime.startsWith("image/")) throw new Error("One of the training files isn't a picture.");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("One picture is over 15 MB.");
  return { bytes, mime };
}

export async function POST(req: Request) {
  const token = resolveReplicateToken();
  if (!token) {
    return NextResponse.json(
      { error: "Replicate isn't connected yet. Add REPLICATE_API_TOKEN in Vercel, then redeploy." },
      { status: 503 },
    );
  }
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "The character needs a name." }, { status: 400 });
  if (body.fictionalAdultConfirmed !== true) {
    return NextResponse.json(
      { error: "Only made-up adult characters can be trained. Tick the box on the card first." },
      { status: 400 },
    );
  }
  const slug = slugifyCharacterName(typeof body.slug === "string" && body.slug ? body.slug : name);
  const subjectWord = typeof body.subjectWord === "string" ? body.subjectWord.slice(0, 20) : "person";
  const urls = Array.isArray(body.imageUrls) ? body.imageUrls.filter((u): u is string => typeof u === "string") : [];
  if (urls.length < CHARACTER_LORA_MIN_IMAGES || urls.length > CHARACTER_LORA_MAX_IMAGES) {
    return NextResponse.json(
      { error: `Use between ${CHARACTER_LORA_MIN_IMAGES} and ${CHARACTER_LORA_MAX_IMAGES} pictures.` },
      { status: 400 },
    );
  }
  if (!urls.every(isAllowedTrainingImageUrl)) {
    return NextResponse.json({ error: "Training pictures must be uploaded through Deck." }, { status: 400 });
  }

  try {
    const images = await Promise.all(urls.map(loadImage));
    const zip = buildStoredZip(
      images.map((im, i) => ({ name: `${slug}_${String(i + 1).padStart(2, "0")}.${extFor(im.mime)}`, bytes: im.bytes })),
    );
    const owner = await getReplicateUsername(token);
    const model = replicateModelName(slug);
    await ensureReplicateModel(token, owner, model);
    const inputImagesUrl = await uploadReplicateFile(token, zip, `${slug}_training.zip`);
    const training = await startSdxlTraining(
      token,
      `${owner}/${model}`,
      buildSdxlTrainingInput({ inputImagesUrl, subjectWord }),
    );
    return NextResponse.json({ trainingId: training.id, status: training.status });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Training couldn't start." }, { status: 502 });
  }
}
