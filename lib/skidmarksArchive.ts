/**
 * Client-side half of "Archive" — the finished-song archive shelf at
 * the bottom of the Skidmarks sheet (see `components/
 * SkidmarksArchiveShelf.tsx`). Per AGENTS.md's hard lock: **no
 * `localStorage` for this** — this is genuinely new durable state (the
 * archive of record for a finished song), not an extension of the
 * existing `lib/skidmarks.ts` session mirror, so it goes straight to
 * Vercel Blob (JSON metadata + JSON snapshot; Neon isn't patterned
 * anywhere in this repo yet — see AGENTS.md's env-vars section — so
 * Blob is the honest "durable now" answer, with Neon still the
 * intended eventual home per the README's Skidmarks follow-up note).
 *
 * **Two Blob artifacts per archived song**:
 * 1. A small **index** entry (`app/api/skidmarks/archive/route.ts`,
 *    one shared `skidmarks/archive/index.json` file covering every
 *    archived song) — just enough metadata to render the bottom shelf
 *    row (title, cover, clip/plate counts, when) without fetching every
 *    song's full snapshot up front.
 * 2. A full **snapshot** (`skidmarks/archive/{id}/snapshot.json`,
 *    uploaded client-side-direct via `@vercel/blob/client`'s `upload()`
 *    — see `app/api/skidmarks/blob-upload/route.ts`'s doc comment for
 *    why this can't go through a normal POST body) — the entire band +
 *    mp3 attachment (segments, plates' still references, shot prompts,
 *    motion prompts) needed to actually restore the session via "Open in
 *    editor." A plate's own still is itself just a Blob URL as of
 *    2026-09-14 (`lib/plateStillBlob.ts`), not an embedded `data:` URL —
 *    this snapshot stays small regardless, but still goes
 *    direct-to-Blob rather than a normal route body, same as every other
 *    upload this feature makes.
 *
 * **The archived song's audio is *referenced*, not re-uploaded** — by
 * the time Stuart taps Archive, the attached MP3's own audio already
 * has a durable Blob URL (`lib/mp3Blob.ts`, uploaded at attach time for
 * "play survives a refresh"). Archiving just carries that same URL
 * forward into the archived song's metadata; if it was never uploaded
 * (Blob unconfigured, or the upload itself failed), the archived song
 * honestly has no audio reference — surfaced plainly in the project
 * zip rather than silently omitted.
 */

import { upload } from "@vercel/blob/client";
import { buildStoreZip } from "./zipDownload";
import { fetchPersistedClipRenders } from "./clipRenders";
import { getSkidmarksCharacterLock, resolvePlateReferenceDataUrl, resolveVocalistForPrompt } from "./plateGeneration";
import { formatDuration, type SkidmarksBand, type SkidmarksMp3Attachment } from "./skidmarks";

const ARCHIVE_PATH_PREFIX = "skidmarks/archive/";
const HANDLE_UPLOAD_URL = "/api/skidmarks/blob-upload";
const ARCHIVE_ENDPOINT = "/api/skidmarks/archive";

export interface SkidmarksArchivedSong {
  id: string;
  bandId: string;
  bandName: string;
  coverImage?: string;
  fileName: string;
  archivedAt: number;
  durationSec: number | null;
  clipCount: number;
  /** How many plates already had a persisted render at the moment this
   * song was archived — a snapshot-in-time count for the row's glance
   * text, not re-computed live (an archived song's renders don't
   * change). */
  renderedPlateCount: number;
  /** The full band+mp3 snapshot's own Blob URL — see this module's doc
   * comment. Always set; "Open in editor" fetches this directly. */
  snapshotUrl: string;
  /** The archived song's own durable audio URL, carried forward from
   * `SkidmarksMp3Attachment.audioUrl` at archive time — `undefined`
   * when that upload never succeeded (see this module's doc comment). */
  audioUrl?: string;
}

export interface SkidmarksArchiveSnapshot {
  band: SkidmarksBand;
  mp3: SkidmarksMp3Attachment;
}

export function generateArchiveId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export type UploadArchiveSnapshotOutcome = { ok: true; url: string } | { ok: false; message: string };

/** Uploads the full band+mp3 snapshot to its own Blob pathname —
 * see this module's doc comment for why this is a client-side-direct
 * upload rather than a normal POST body. */
export async function uploadArchiveSnapshot(
  archiveId: string,
  snapshot: SkidmarksArchiveSnapshot
): Promise<UploadArchiveSnapshotOutcome> {
  const pathname = `${ARCHIVE_PATH_PREFIX}${archiveId}/snapshot.json`;
  try {
    const blob = new Blob([JSON.stringify(snapshot)], { type: "application/json" });
    const result = await upload(pathname, blob, {
      access: "public",
      handleUploadUrl: HANDLE_UPLOAD_URL,
      contentType: "application/json",
    });
    return { ok: true, url: result.url };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not upload the archive snapshot." };
  }
}

interface ArchiveIndexRouteBody {
  configured?: unknown;
  songs?: unknown;
  error?: unknown;
}

function isArchivedSongShape(value: unknown): value is SkidmarksArchivedSong {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<SkidmarksArchivedSong>;
  return (
    typeof v.id === "string" &&
    typeof v.bandId === "string" &&
    typeof v.bandName === "string" &&
    typeof v.fileName === "string" &&
    typeof v.archivedAt === "number" &&
    typeof v.clipCount === "number" &&
    typeof v.renderedPlateCount === "number" &&
    typeof v.snapshotUrl === "string"
  );
}

export type FetchArchiveIndexOutcome =
  | { ok: true; songs: SkidmarksArchivedSong[] }
  | { ok: false; songs: []; message?: string };

/** Lists every archived song's metadata — never throws; an
 * unconfigured Blob store or any other failure comes back as an honest
 * `{ ok: false, songs: [] }` rather than blowing up the shelf that
 * called it. `{ ok: true, songs: [] }` (not `ok: false`) is the real,
 * successful "nothing archived yet" answer. */
export async function fetchSkidmarksArchiveIndex(): Promise<FetchArchiveIndexOutcome> {
  let res: Response;
  try {
    res = await fetch(ARCHIVE_ENDPOINT);
  } catch (err) {
    return { ok: false, songs: [], message: err instanceof Error ? err.message : "Network error." };
  }
  let body: ArchiveIndexRouteBody | null = null;
  try {
    body = (await res.json()) as ArchiveIndexRouteBody;
  } catch {
    // Handled by the checks below either way.
  }
  if (!res.ok || !body || body.configured !== true) {
    return { ok: false, songs: [], message: typeof body?.error === "string" ? body.error : undefined };
  }
  const songs = Array.isArray(body.songs) ? body.songs.filter(isArchivedSongShape) : [];
  return { ok: true, songs };
}

export type ArchiveMutationOutcome = { ok: true } | { ok: false; message: string };

/** Appends (or replaces, by `id`) one archived song's metadata in the
 * shared index — the small POST that actually makes an archived song
 * show up in the bottom shelf, called right after
 * `uploadArchiveSnapshot` succeeds. */
export async function addSkidmarksArchivedSong(song: SkidmarksArchivedSong): Promise<ArchiveMutationOutcome> {
  try {
    const res = await fetch(ARCHIVE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", song }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, message: typeof body?.error === "string" ? body.error : `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Network error." };
  }
}

/** Removes one archived song from the index — used right after
 * "Open in editor" restores it into the live workspace, so it isn't
 * shown both live *and* archived at once (per AGENTS.md's "no doubled
 * UI" lock). Does **not** delete the underlying snapshot/audio blobs —
 * re-archiving after further edits just uploads a fresh snapshot under
 * a new id; the old one is orphaned storage, not a correctness issue. */
export async function removeSkidmarksArchivedSong(id: string): Promise<ArchiveMutationOutcome> {
  try {
    const res = await fetch(ARCHIVE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", id }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, message: typeof body?.error === "string" ? body.error : `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Network error." };
  }
}

/** Deletes a shelf row *and* its snapshot file — the deliberate,
 * confirmed "Delete" on a Finished Songs row. `removeSkidmarksArchivedSong`
 * above only drops the row, which orphan recovery would undo. */
export async function deleteSkidmarksArchivedSong(id: string): Promise<ArchiveMutationOutcome> {
  try {
    const res = await fetch(ARCHIVE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, message: typeof body?.error === "string" ? body.error : `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Network error." };
  }
}

export type FetchArchiveSnapshotOutcome =
  | { ok: true; snapshot: SkidmarksArchiveSnapshot }
  | { ok: false; message: string };

/** Fetches an archived song's full snapshot straight from its own
 * (public) Blob URL — a plain cross-origin `GET`, same "Blob serves
 * `Access-Control-Allow-Origin: *`" fact `lib/clipRenders.ts`'s
 * `buildRendersZip` already relies on. */
export async function fetchArchiveSnapshot(snapshotUrl: string): Promise<FetchArchiveSnapshotOutcome> {
  try {
    const res = await fetch(snapshotUrl);
    if (!res.ok) return { ok: false, message: `Downloading the archived snapshot returned HTTP ${res.status}.` };
    const parsed = (await res.json()) as Partial<SkidmarksArchiveSnapshot>;
    if (!parsed || typeof parsed !== "object" || !parsed.band || !parsed.mp3) {
      return { ok: false, message: "The archived snapshot was missing its band or mp3 data." };
    }
    return { ok: true, snapshot: parsed as SkidmarksArchiveSnapshot };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not download the archived snapshot." };
  }
}

export type ArchiveSessionOutcome = { ok: true; song: SkidmarksArchivedSong } | { ok: false; message: string };

/**
 * The whole "Archive" action, top to bottom: uploads the full band+mp3
 * snapshot, builds this song's metadata record off it (carrying forward
 * `mp3.audioUrl` — see this module's doc comment for why the audio
 * itself is never re-uploaded here), and appends it to the shared
 * index. `renderedPlateCount` is passed in by the caller
 * (`components/SkidmarksDetailSheet.tsx` already has the live "which
 * plates have a render" map from `hooks/useSkidmarksClipRenders.ts` —
 * no reason to re-derive or re-fetch it here). Never throws; a failure
 * at either step comes back as an honest `{ ok: false, message }`
 * rather than silently losing Stuart's finished song.
 */
export async function archiveSkidmarksSession(
  band: SkidmarksBand,
  mp3: SkidmarksMp3Attachment,
  renderedPlateCount: number
): Promise<ArchiveSessionOutcome> {
  const id = generateArchiveId();
  const uploadOutcome = await uploadArchiveSnapshot(id, { band, mp3 });
  if (!uploadOutcome.ok) {
    return { ok: false, message: `Could not save this song's project data \u2014 ${uploadOutcome.message}` };
  }

  const song: SkidmarksArchivedSong = {
    id,
    bandId: band.id,
    bandName: band.name,
    coverImage: band.coverImage,
    fileName: mp3.fileName,
    archivedAt: Date.now(),
    durationSec: mp3.durationSec,
    clipCount: mp3.segments.length,
    renderedPlateCount,
    snapshotUrl: uploadOutcome.url,
    audioUrl: mp3.audioUrl,
  };

  const addOutcome = await addSkidmarksArchivedSong(song);
  if (!addOutcome.ok) {
    return { ok: false, message: `Saved this song's project data, but couldn't list it \u2014 ${addOutcome.message}` };
  }
  return { ok: true, song };
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const commaIndex = dataUrl.indexOf(",");
  const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function extensionFromDataUrl(dataUrl: string): string {
  const match = /^data:image\/([a-zA-Z0-9.+-]+);base64,/.exec(dataUrl);
  const subtype = match?.[1]?.toLowerCase();
  if (subtype === "png") return "png";
  if (subtype === "webp") return "webp";
  return "jpg";
}

/** Strips a trailing `.mp3`/`.wav`/etc. extension for a readable "Song:"
 * line \u2014 this app has no separate song-title field distinct from the
 * attached file's own name, so the filename minus its extension is the
 * most honest title available without inventing one. */
function stripAudioExtension(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]{2,4}$/i, "");
}

/**
 * `song-brief.txt` \u2014 Stuart's own per-song template (Song/Band/
 * Length/MP3/Lyrics/Brief/Artist), auto-filled with whatever this app
 * already knows and left blank for the rest, per his "Auto bit" ask.
 * Lyrics and Brief are never known to this app (no full-lyrics
 * transcript, and "Brief" is Stuart's own creative direction) \u2014
 * always blank, a real template field, not a missing-data bug. Artist
 * auto-fills from a locked character's `directorNote`
 * (`lib/plateGeneration.ts`) when the resolved vocalist has one (Jack
 * Ash today); every other band leaves it blank, same as an unlocked
 * member always has no injected look. New every song, per Stuart's
 * "brief + plan are new every song, brain stays" split \u2014 unlike
 * `director-brain.txt` (`docs/skidmarks/`), this is generated fresh
 * into each project zip, never a static repo file.
 */
export function buildSongBriefText(song: SkidmarksArchivedSong, snapshot: SkidmarksArchiveSnapshot): string {
  const vocalist = resolveVocalistForPrompt(snapshot.band.members);
  const artistLine = vocalist ? getSkidmarksCharacterLock(vocalist)?.directorNote ?? "" : "";
  const lengthText = song.durationSec !== null ? formatDuration(song.durationSec) : "";
  return [
    `Song: ${stripAudioExtension(song.fileName)}`,
    `Band: ${song.bandName}`,
    `Length: ${lengthText}`,
    `MP3: ${song.fileName}`,
    "Lyrics:",
    "Brief:",
    "",
    `Artist: ${artistLine}`,
    "",
  ].join("\n");
}

/**
 * `song-plan.txt` \u2014 Stuart's own beat/cut/frame planning table,
 * rewritten fresh per song (per his "rewrite the table every MP3" ask).
 * Only `Song:` is auto-filled; the table itself is a blank scaffold in
 * his own exact shape (Open/Lyric1/Verse/Chorus/Break), not derived
 * from this song's real segments \u2014 those don't map onto his beat
 * names (Verse/Chorus/etc. are song-structure beats, this app's
 * segments are Vocal/Instrumental time ranges), so inventing that
 * mapping would be guessing at his own creative process rather than
 * automating something this app genuinely knows.
 */
export function buildSongPlanText(song: SkidmarksArchivedSong): string {
  return [
    `Song: ${stripAudioExtension(song.fileName)}`,
    "",
    "Beat | Cut (Music Video Study) | Frame (Plate Study)",
    "-----|-------------------------|--------------------",
    "Open | linger / ease push |",
    "Lyric1 | mouth-on punch on attack |",
    "Verse | hold mouth-on; gesture between |",
    "Chorus | denser punches + one Wide |",
    "Break | leave mouth; Wide/Low travel |",
    "",
    "Notes:",
    "",
  ].join("\n");
}

function buildManifestText(song: SkidmarksArchivedSong, snapshot: SkidmarksArchiveSnapshot): string {
  const lines: string[] = [
    `Skidmarks project export \u2014 ${song.bandName}`,
    `Song: ${song.fileName}`,
    `Archived: ${new Date(song.archivedAt).toISOString()}`,
    "",
  ];
  snapshot.mp3.segments.forEach((segment, i) => {
    lines.push(`Clip ${i + 1} (${segment.startSec.toFixed(0)}s\u2013${segment.endSec.toFixed(0)}s, ${segment.label}):`);
    lines.push(`  Shot prompt: ${segment.shotPrompt || "(none)"}`);
    segment.plates.forEach((plate, plateIndex) => {
      const letter = segment.plates.length > 1 ? String.fromCharCode(97 + plateIndex) : "";
      const status = plate.still ? "filled" : "empty";
      lines.push(
        `  Plate ${i + 1}${letter} \u2014 ${status}${plate.motionPrompt ? ` \u2014 motion: ${plate.motionPrompt}` : ""}`
      );
    });
    lines.push("");
  });
  if (!song.audioUrl) {
    lines.push("Note: original audio was not available to include in this export (see the app's honesty note).");
  }
  return lines.join("\n");
}

export type BuildArchiveZipOutcome = { ok: true; zipBytes: Uint8Array } | { ok: false; message: string };

/**
 * Builds the "Download project zip" bundle for one archived song: a
 * plain-text manifest (prompts + motion texts + timing), every plate's
 * still image, every persisted render this song's clips still have, and
 * the original audio when it was actually saved. "As practical," per
 * the task's own framing — this never fabricates a piece that genuinely
 * isn't available (a still that was never generated, audio that was
 * never uploaded); it just honestly omits it and says so in the
 * manifest.
 */
export async function buildArchiveZip(
  song: SkidmarksArchivedSong,
  snapshot: SkidmarksArchiveSnapshot
): Promise<BuildArchiveZipOutcome> {
  const entries: { name: string; data: Uint8Array }[] = [];

  entries.push({ name: "manifest.txt", data: new TextEncoder().encode(buildManifestText(song, snapshot)) });
  // Stuart's own per-song brief/plan templates \u2014 see this module's
  // "Auto bit" doc comments above. `director-brain.txt` deliberately
  // does NOT go in here: it's the one persistent, cross-song document
  // ("brief + plan are new every song, brain stays"), kept in
  // `docs/skidmarks/` instead.
  entries.push({ name: "brief.txt", data: new TextEncoder().encode(buildSongBriefText(song, snapshot)) });
  entries.push({ name: "plan.txt", data: new TextEncoder().encode(buildSongPlanText(song)) });

  // A plate's own still is a real Blob URL as of 2026-09-14 (`lib/
  // plateStillBlob.ts`), not an embedded `data:` URL — `resolvePlate
  // ReferenceDataUrl` fetches it back into real bytes (a fast no-op for
  // a still saved before that change, still a literal `data:` URL).
  // Best-effort per plate, same spirit as the audio/render fetches below
  // — one still failing to fetch shouldn't fail the whole zip.
  for (let segmentIndex = 0; segmentIndex < snapshot.mp3.segments.length; segmentIndex += 1) {
    const segment = snapshot.mp3.segments[segmentIndex];
    for (let plateIndex = 0; plateIndex < segment.plates.length; plateIndex += 1) {
      const plate = segment.plates[plateIndex];
      if (!plate.still) continue;
      try {
        const resolvedDataUrl = await resolvePlateReferenceDataUrl(plate.still.dataUrl);
        const letter = segment.plates.length > 1 ? String.fromCharCode(97 + plateIndex) : "";
        const ext = extensionFromDataUrl(resolvedDataUrl);
        const filename = `plates/${String(segmentIndex + 1).padStart(2, "0")}${letter}_${segment.label}.${ext}`;
        entries.push({ name: filename, data: dataUrlToBytes(resolvedDataUrl) });
      } catch {
        // Best-effort — see comment above.
      }
    }
  }

  if (song.audioUrl) {
    try {
      const res = await fetch(song.audioUrl);
      if (res.ok) {
        entries.push({ name: `audio/${song.fileName}`, data: new Uint8Array(await res.arrayBuffer()) });
      }
    } catch {
      // Honestly best-effort — the manifest already documents when
      // audio isn't included; a fetch hiccup here shouldn't fail the
      // whole zip.
    }
  }

  const segmentIds = snapshot.mp3.segments.map((s) => s.id);
  const rendersOutcome = await fetchPersistedClipRenders(segmentIds);
  if (rendersOutcome.ok) {
    for (const render of rendersOutcome.renders) {
      try {
        const res = await fetch(render.url);
        if (!res.ok) continue;
        entries.push({ name: `renders/${render.filename}`, data: new Uint8Array(await res.arrayBuffer()) });
      } catch {
        // Best-effort, same reasoning as the audio fetch above.
      }
    }
  }

  try {
    return { ok: true, zipBytes: buildStoreZip(entries) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not build the project zip." };
  }
}

export { ARCHIVE_PATH_PREFIX };
