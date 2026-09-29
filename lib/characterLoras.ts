/**
 * Character LoRAs (2026-09-29, Stuart's ask) — the fifth landing tile.
 * One card per Deck character (Skye, Jack Ash, Big Sexy, the Skidmarks
 * cast, the AIG!itch besties, anyone new) with its training pictures and
 * a **Train LoRA** button, so every character gets a face that holds
 * across songs, episodes and shorts.
 *
 * The chain, proven end to end on Skye first:
 * 1. Train on Replicate's `stability-ai/sdxl` trainer (~4.5 min,
 *    ~US$0.27) — `lib/replicateTrainer.ts`.
 * 2. Convert the output to Comfy's format and upload it to Stuart's
 *    private Hugging Face repo — `lib/loraFiles.ts`, `lib/hfUpload.ts`.
 * 3. Stuart pastes the two links into Comfy Cloud → Models → Import
 *    (loras + embeddings). That step is by hand: Comfy Cloud has no
 *    import API, and it pulls with his own saved HF secret.
 *
 * **Content rule:** fictional characters only, clearly adult, never a
 * real person's face or photos. Training is refused unless the card's
 * "made-up adult" box is ticked.
 *
 * Persisted on the same Neon session row as everything else
 * (`SkidmarksState.characterLoras`), URLs only, never image bytes.
 */

export const CHARACTER_LORA_MIN_IMAGES = 8;
export const CHARACTER_LORA_MAX_IMAGES = 30;
export const CHARACTER_LORA_RECOMMENDED = "12 to 20";
/** Skye's pilot run: 274.5s on an L40S at $0.000975/s, rounded up a little. */
export const CHARACTER_LORA_ESTIMATED_COST_USD = 0.3;
export const CHARACTER_LORA_DEFAULT_REPO = "comfybear71/deck-loras";

export type CharacterLoraStatus = "draft" | "making" | "training" | "finishing" | "ready" | "failed";

/**
 * How the trainer should treat the pictures. `photo` crops around the
 * face (the SDXL trainer's face detection) and captions "a photo of";
 * `cartoon` (Sunny Banks) and `faceless` (Jack Ash's shadowed fedora)
 * switch face detection off, since there's no real face to find, and
 * caption "a cartoon of" / "a photo of" respectively.
 */
export type CharacterTrainingStyle = "photo" | "cartoon" | "faceless";
export const CHARACTER_TRAINING_STYLES: CharacterTrainingStyle[] = ["photo", "cartoon", "faceless"];

/** Pictures the one-tap flow aims for (existing pictures plus Siray-made ones). */
export const AUTO_PICTURE_TARGET = 15;
/** Siray Seedream 4.5 is a flat US$0.04 a picture (`lib/sirayClient.ts`). */
export const SIRAY_PICTURE_COST_USD = 0.04;

export interface CharacterLoraEntry {
  id: string;
  name: string;
  /** Lowercase file-safe stem, e.g. `skye`, `jack_ash`. */
  slug: string;
  /** Word after the trigger in every caption and prompt: woman, man, person… */
  subjectWord: string;
  /** Blob https URLs of the training pictures. */
  trainingImageUrls: string[];
  /** Ticked: made up, clearly adult, not a real person. Training needs this. */
  fictionalAdultConfirmed: boolean;
  status: CharacterLoraStatus;
  /** Which training this is (v1, v2…); bumps on every retrain so Comfy sees a new file name. */
  version: number;
  replicateTrainingId: string | null;
  error: string | null;
  /** Set once uploaded, e.g. `skye_v1.safetensors` in `hfRepo`. */
  hfRepo: string | null;
  loraFile: string | null;
  embeddingFile: string | null;
  costUsd: number | null;
  trainedAt: string | null;
  /** Stuart ticked "imported into Comfy" after pasting both links. */
  importedToComfy: boolean;
  createdAt: string;
  /**
   * Which existing Deck character this card belongs to, e.g.
   * `mv:jack-ash-frontman`, `sb:shazza`, `sk:<cast id>` (see
   * `lib/characterRoster.ts`). `null` for a card added by hand.
   */
  sourceKey: string | null;
  trainingStyle: CharacterTrainingStyle;
  /** The one picture Siray copies the character from in the one-tap flow. */
  referenceUrl: string | null;
  /** While `status` is `making`: how many pictures to reach before it stops for a look. */
  autoPictureTarget: number | null;
  /** Siray has finished the pictures; waiting for Stuart to check them and tap Train. */
  awaitingReview: boolean;
}

export interface CharacterLorasState {
  characters: CharacterLoraEntry[];
}

/** Skye, trained by hand on 2026-09-29 as the pilot, already imported into Comfy Cloud. */
export const SKYE_SEED: CharacterLoraEntry = {
  id: "clora_skye",
  name: "Skye",
  slug: "skye",
  subjectWord: "woman",
  trainingImageUrls: [],
  fictionalAdultConfirmed: true,
  status: "ready",
  version: 1,
  replicateTrainingId: "a5649erm05rmw0d0xd9vrwnzvm",
  error: null,
  hfRepo: CHARACTER_LORA_DEFAULT_REPO,
  loraFile: "skye_v1.safetensors",
  embeddingFile: "skye_v1_emb.safetensors",
  costUsd: 0.27,
  trainedAt: "2026-09-29T04:06:00.000Z",
  importedToComfy: true,
  createdAt: "2026-09-29T04:00:00.000Z",
  sourceKey: null,
  trainingStyle: "photo",
  referenceUrl: null,
  autoPictureTarget: null,
  awaitingReview: false,
};

export function emptyCharacterLorasState(): CharacterLorasState {
  return { characters: [{ ...SKYE_SEED }] };
}

export function slugifyCharacterName(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return s || "character";
}

/** A slug no other card already uses (`jack`, then `jack_2`, …). */
export function uniqueSlug(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugifyCharacterName(name);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}_${i}`)) return `${base}_${i}`;
}

export function loraFileNames(slug: string, version: number): { loraFile: string; embeddingFile: string } {
  const stem = `${slug}_v${version}`;
  return { loraFile: `${stem}.safetensors`, embeddingFile: `${stem}_emb.safetensors` };
}

/** Replicate destination model for a character. */
export function replicateModelName(slug: string): string {
  return `deck-lora-${slug.replace(/_/g, "-")}`;
}

export function hfResolveLink(repo: string, file: string): string {
  return `https://huggingface.co/${repo}/resolve/main/${encodeURIComponent(file)}`;
}

/**
 * The name Comfy Cloud gives an imported file: `owner__repo__file`
 * (seen live on Skye: `comfybear71__deck-loras__skye_v1.safetensors`).
 */
export function comfyImportedName(repo: string, file: string): string {
  return `${repo.replace("/", "__")}__${file}`;
}

export function comfyEmbeddingToken(repo: string, embeddingFile: string): string {
  return `embedding:${comfyImportedName(repo, embeddingFile).replace(/\.safetensors$/, "")}`;
}

/** Caption opener, used both for training captions (`TOK`) and the Comfy prompt (the embedding token). */
export function captionPrefix(style: CharacterTrainingStyle, token: string, subjectWord: string): string {
  const word = subjectWord.trim().toLowerCase() || (style === "cartoon" ? "character" : "person");
  return `${style === "cartoon" ? "a cartoon of" : "a photo of"} ${token} ${word}, `;
}

/** The prompt opener that switches the character on in Comfy. */
export function comfyPromptSnippet(entry: CharacterLoraEntry): string | null {
  if (!entry.hfRepo || !entry.embeddingFile) return null;
  return captionPrefix(entry.trainingStyle, comfyEmbeddingToken(entry.hfRepo, entry.embeddingFile), entry.subjectWord);
}

export type TrainBlocker = "name" | "images-few" | "images-many" | "confirm" | "busy" | null;

export function trainBlocker(entry: CharacterLoraEntry): TrainBlocker {
  if (entry.status === "making" || entry.status === "training" || entry.status === "finishing") return "busy";
  if (!entry.name.trim()) return "name";
  if (entry.trainingImageUrls.length < CHARACTER_LORA_MIN_IMAGES) return "images-few";
  if (entry.trainingImageUrls.length > CHARACTER_LORA_MAX_IMAGES) return "images-many";
  if (!entry.fictionalAdultConfirmed) return "confirm";
  return null;
}

export function trainBlockerMessage(b: TrainBlocker, entry: CharacterLoraEntry): string | null {
  switch (b) {
    case "name":
      return "Give the character a name first.";
    case "images-few":
      return `Add at least ${CHARACTER_LORA_MIN_IMAGES} pictures (${entry.trainingImageUrls.length} so far). ${CHARACTER_LORA_RECOMMENDED} works best.`;
    case "images-many":
      return `Use at most ${CHARACTER_LORA_MAX_IMAGES} pictures.`;
    case "confirm":
      return "Tick the made-up adult box first.";
    case "busy":
      return "Already training.";
    default:
      return null;
  }
}

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `clora_${crypto.randomUUID()}`;
  return `clora_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildCharacterLoraEntry(
  name: string,
  taken: Iterable<string>,
  now: Date = new Date(),
  extra: Partial<Pick<CharacterLoraEntry, "sourceKey" | "trainingStyle" | "referenceUrl" | "subjectWord">> = {},
): CharacterLoraEntry {
  const trimmed = name.trim();
  return {
    id: generateId(),
    name: trimmed,
    slug: uniqueSlug(trimmed, taken),
    subjectWord: "person",
    trainingImageUrls: [],
    fictionalAdultConfirmed: false,
    status: "draft",
    version: 0,
    replicateTrainingId: null,
    error: null,
    hfRepo: null,
    loraFile: null,
    embeddingFile: null,
    costUsd: null,
    trainedAt: null,
    importedToComfy: false,
    createdAt: now.toISOString(),
    sourceKey: null,
    trainingStyle: "photo",
    referenceUrl: null,
    autoPictureTarget: null,
    awaitingReview: false,
    ...extra,
  };
}

/** A retrain gets the next version so its Comfy file name never collides with the last one. */
export function nextTrainingVersion(entry: CharacterLoraEntry): number {
  return Math.max(0, entry.version) + 1;
}

const STATUSES: CharacterLoraStatus[] = ["draft", "making", "training", "finishing", "ready", "failed"];

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function normalizeEntry(raw: unknown): CharacterLoraEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name : "";
  const id = str(r.id);
  if (!id) return null;
  const urls = Array.isArray(r.trainingImageUrls)
    ? r.trainingImageUrls.filter((u): u is string => typeof u === "string" && /^(https:|data:image\/)/.test(u))
    : [];
  const status = STATUSES.includes(r.status as CharacterLoraStatus) ? (r.status as CharacterLoraStatus) : "draft";
  return {
    id,
    name,
    slug: str(r.slug) ?? slugifyCharacterName(name),
    subjectWord: str(r.subjectWord) ?? "person",
    trainingImageUrls: urls.slice(0, CHARACTER_LORA_MAX_IMAGES),
    fictionalAdultConfirmed: r.fictionalAdultConfirmed === true,
    status,
    version: typeof r.version === "number" && r.version >= 0 ? Math.floor(r.version) : 0,
    replicateTrainingId: str(r.replicateTrainingId),
    error: str(r.error),
    hfRepo: str(r.hfRepo),
    loraFile: str(r.loraFile),
    embeddingFile: str(r.embeddingFile),
    costUsd: typeof r.costUsd === "number" ? r.costUsd : null,
    trainedAt: str(r.trainedAt),
    importedToComfy: r.importedToComfy === true,
    createdAt: str(r.createdAt) ?? new Date(0).toISOString(),
    sourceKey: str(r.sourceKey),
    trainingStyle: CHARACTER_TRAINING_STYLES.includes(r.trainingStyle as CharacterTrainingStyle)
      ? (r.trainingStyle as CharacterTrainingStyle)
      : "photo",
    referenceUrl: typeof r.referenceUrl === "string" && /^(https:|data:image\/|\/)/.test(r.referenceUrl) ? r.referenceUrl : null,
    autoPictureTarget:
      typeof r.autoPictureTarget === "number" && r.autoPictureTarget > 0
        ? Math.min(CHARACTER_LORA_MAX_IMAGES, Math.floor(r.autoPictureTarget))
        : null,
    awaitingReview: r.awaitingReview === true,
  };
}

/** Missing (older sessions) reads as `null`, which the getter turns into the Skye seed. */
export function normalizeCharacterLorasState(raw: unknown): CharacterLorasState | null {
  if (!raw || typeof raw !== "object") return null;
  const list = (raw as { characters?: unknown }).characters;
  if (!Array.isArray(list)) return null;
  const characters = list.map(normalizeEntry).filter((e): e is CharacterLoraEntry => e !== null);
  return { characters };
}

export function characterLorasHaveUserContent(state: CharacterLorasState | null | undefined): boolean {
  if (!state) return false;
  // Deleting Skye or adding anyone is a real edit worth keeping.
  if (state.characters.length !== 1) return true;
  return JSON.stringify(state.characters[0]) !== JSON.stringify(SKYE_SEED);
}

export function formatCostUsd(n: number): string {
  return `US$${n.toFixed(2)}`;
}

export const CHARACTER_LORA_BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";
const BLOB_SUFFIX = CHARACTER_LORA_BLOB_HOST_SUFFIX;

/**
 * Training pictures the server is allowed to fetch: Deck's own Vercel
 * Blob store only (https, no credentials, no port), or an inline
 * `data:image/…` from local dev. Anything else is refused, never fetched.
 */
export function isAllowedTrainingImageUrl(raw: string): boolean {
  if (/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(raw)) return true;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  return host.endsWith(BLOB_SUFFIX) && host.length > BLOB_SUFFIX.length;
}
