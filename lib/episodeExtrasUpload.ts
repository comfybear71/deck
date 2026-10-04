/**
 * Browser half of Episode Extras (`lib/episodeExtras.ts`): sends the
 * picked file straight from the phone or PC to Blob (`@vercel/blob/client`
 * `upload()`, the same client-upload pattern as the MP3 and archive
 * uploads, via `/api/skidmarks/blob-upload`), so a big video never goes
 * through a serverless function. Big files go in parts (`multipart`).
 *
 * The file name is the extra's readable name; if Blob already has that
 * name (an extra deleted earlier keeps its file), the next try is `-2`,
 * then `-3`… Never a random tag, never an overwrite (the token route
 * issues extras tokens with `allowOverwrite: false`).
 *
 * Saving the extra onto the episode is the caller's job, once this
 * returns (`addEpisodeExtra` in `lib/skidmarks.ts`).
 */

import { upload } from "@vercel/blob/client";
import { isBlobAlreadyExistsError } from "./deckMediaPaths";
import { BLOB_HANDLE_UPLOAD_URL } from "./deckMediaUpload";
import {
  EPISODE_EXTRA_CONTENT_TYPES,
  EPISODE_EXTRA_MAX_BYTES,
  EPISODE_EXTRA_NAME_MAX,
  EPISODE_EXTRA_PLACEMENT_MAX,
  cleanEpisodeExtraText,
  episodeExtraExtensionFor,
  episodeExtraFileSlug,
  episodeExtraKind,
  episodeExtraPathname,
  nextEpisodeExtraFileSlug,
  type EpisodeExtra,
} from "./episodeExtras";

/** Files over this go up in parts. */
const MULTIPART_FROM_BYTES = 20 * 1024 * 1024;
/** How many `-2`, `-3`… names to try before giving up. */
const MAX_NAME_TRIES = 30;

export type UploadEpisodeExtraOutcome = { ok: true; extra: EpisodeExtra } | { ok: false; error: string };

/** The upload function, swappable in tests. */
export type BlobClientUpload = typeof upload;

/** A Blob error message, kept short enough for the Extras row. */
function shortMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return raw.replace(/\s+/g, " ").trim().slice(0, 160);
}

export async function uploadEpisodeExtra(args: {
  file: File;
  name: string;
  placement: string;
  /** The episode's Blob folder (`deck/skidmarks/episodes/cornish-arsehole`). */
  episodeFolder: string;
  /** File names (`id`s) the episode's extras already use. */
  takenIds: readonly string[];
  onProgress?: (percentage: number) => void;
  now?: number;
  uploadImpl?: BlobClientUpload;
}): Promise<UploadEpisodeExtraOutcome> {
  const { file } = args;
  const ext = episodeExtraExtensionFor(file.name, file.type);
  if (!ext) return { ok: false, error: "That file isn't a video (mp4, mov, webm) or audio file (mp3, wav)." };
  if (file.size <= 0) return { ok: false, error: "That file is empty." };
  if (file.size > EPISODE_EXTRA_MAX_BYTES) return { ok: false, error: "That file is over 2 GB. Pick a smaller one." };
  const name = cleanEpisodeExtraText(args.name, EPISODE_EXTRA_NAME_MAX);
  if (!name) return { ok: false, error: "Give the extra a name first." };
  const contentType = EPISODE_EXTRA_CONTENT_TYPES[ext];
  const doUpload = args.uploadImpl ?? upload;
  // Progress can still arrive after the upload has finished (2026-10-04:
  // the card sat at "100%" and kept the row locked). Only report while
  // it is running, and only real numbers 0–100.
  let running = true;
  const onProgress = (percentage: unknown) => {
    if (!running || typeof percentage !== "number" || !Number.isFinite(percentage)) return;
    args.onProgress?.(Math.min(100, Math.max(0, Math.round(percentage))));
  };
  try {
    return await uploadUnderFreeName({ ...args, name, contentType, ext, doUpload, onProgress });
  } finally {
    running = false;
  }
}

async function uploadUnderFreeName(args: {
  file: File;
  name: string;
  placement: string;
  episodeFolder: string;
  takenIds: readonly string[];
  now?: number;
  contentType: string;
  ext: NonNullable<ReturnType<typeof episodeExtraExtensionFor>>;
  doUpload: BlobClientUpload;
  onProgress: (percentage: unknown) => void;
}): Promise<UploadEpisodeExtraOutcome> {
  const { file, episodeFolder, name, contentType, ext, doUpload } = args;
  const tried: string[] = [];
  let slug = episodeExtraFileSlug(name, args.takenIds);
  for (let attempt = 0; attempt < MAX_NAME_TRIES; attempt++) {
    const pathname = episodeExtraPathname(episodeFolder, slug, ext);
    try {
      const result = await doUpload(pathname, file, {
        access: "public",
        handleUploadUrl: BLOB_HANDLE_UPLOAD_URL,
        contentType,
        multipart: file.size > MULTIPART_FROM_BYTES,
        onUploadProgress: (p) => args.onProgress(p?.percentage),
      });
      const url = typeof result?.url === "string" ? result.url : "";
      if (!/^https:\/\//i.test(url)) {
        return { ok: false, error: "The upload didn't come back with a file address. Nothing was saved; try again." };
      }
      return {
        ok: true,
        extra: {
          id: slug,
          name,
          placement: cleanEpisodeExtraText(args.placement, EPISODE_EXTRA_PLACEMENT_MAX),
          url,
          // Blob always sends its pathname back; the one asked for is the same.
          pathname: typeof result.pathname === "string" && result.pathname ? result.pathname : pathname,
          ext,
          kind: episodeExtraKind(ext),
          originalFileName: file.name.slice(0, 200),
          sizeBytes: file.size,
          createdAt: args.now ?? Date.now(),
        },
      };
    } catch (err) {
      if (isBlobAlreadyExistsError(err)) {
        tried.push(slug);
        slug = nextEpisodeExtraFileSlug(slug, [...args.takenIds, ...tried]);
        continue;
      }
      const message = shortMessage(err);
      return {
        ok: false,
        error: /BLOB_READ_WRITE_TOKEN|No token|not configured/i.test(message)
          ? "Storage isn't connected here, so the file wasn't saved."
          : `The upload didn't finish${message ? ` (${message})` : ""}. Nothing was saved; try again.`,
      };
    }
  }
  return { ok: false, error: "Too many files already have that name. Try a different name." };
}
