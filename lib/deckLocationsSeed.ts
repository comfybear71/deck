/**
 * Pure planning half of the one-time locations seed
 * (`scripts/seed-deck-items-locations.ts`, 2026-09-30). Turns the
 * session's `locations` list into the `deck_items` rows it would insert
 * (kind `location`, folder = genre), with Sunnybank's nine built-ins
 * added when Sunnybank has no saved locations yet, and the Blob copies it
 * would make: each built-in picture (a repo file under
 * `public/skidmarks/sunnybanks/`) goes to
 * `deck/sunnybank/locations/<location>.jpg`, and the row points at the copy.
 *
 * No database or Blob access here, so a `--dry-run` prints exactly what a
 * real run does.
 */
import {
  builtInDeckLocations,
  deckLocationPictureTarget,
  normalizeDeckLocation,
  savedDeckLocations,
  type DeckLocation,
} from "./deckLocations";
import { DECK_FOLDER_LABELS, isValidDeckItemId, type DeckFolder } from "./deckItems";

export interface LocationSeedRow {
  itemId: string;
  folder: DeckFolder;
  title: string;
  data: DeckLocation;
  /** Where it came from: already in the session, or a Sunnybank built-in. */
  source: "session" | "built-in";
  /** A repo picture to copy into Blob first (`data.pictureUrl` becomes the copy's URL). */
  blobCopy: { fromPublicPath: string; toPathname: string } | null;
}

export interface LocationSeedPlan {
  rows: LocationSeedRow[];
  skipped: { index: number; reason: string }[];
  sessionHasNoList: boolean;
}

function blobCopyFor(loc: DeckLocation): LocationSeedRow["blobCopy"] {
  const url = loc.pictureUrl;
  if (!url || !url.startsWith("/skidmarks/")) return null;
  const ext = (url.match(/\.(jpg|jpeg|png|webp)$/i)?.[1] ?? "jpg").toLowerCase().replace("jpeg", "jpg");
  const target = deckLocationPictureTarget(loc.genre, loc.key);
  return { fromPublicPath: url, toPathname: `${target.folder}/${target.name}.${ext}` };
}

export function planLocationSeed(sessionLocations: unknown): LocationSeedPlan {
  const plan: LocationSeedPlan = { rows: [], skipped: [], sessionHasNoList: false };
  const rawList =
    sessionLocations && typeof sessionLocations === "object" ? (sessionLocations as { locations?: unknown }).locations : undefined;
  const saved: DeckLocation[] = [];
  if (!Array.isArray(rawList)) plan.sessionHasNoList = true;
  else {
    const seen = new Set<string>();
    rawList.forEach((raw, index) => {
      const loc = normalizeDeckLocation(raw);
      if (!loc || !isValidDeckItemId(loc.id)) return plan.skipped.push({ index, reason: "not a location (no genre, key or name)" });
      if (seen.has(loc.id)) return plan.skipped.push({ index, reason: `duplicate ${loc.id} (first copy kept)` });
      seen.add(loc.id);
      saved.push(loc);
    });
  }
  for (const loc of saved) {
    plan.rows.push({ itemId: loc.id, folder: loc.genre, title: loc.name, data: loc, source: "session", blobCopy: blobCopyFor(loc) });
  }
  // Sunnybank shows its built-ins until it has saved locations; the first
  // edit copies them in. Same here, so nothing on screen changes.
  if (savedDeckLocations({ locations: saved }, "sunnybank").length === 0) {
    for (const loc of builtInDeckLocations("sunnybank")) {
      plan.rows.push({ itemId: loc.id, folder: "sunnybank", title: loc.name, data: loc, source: "built-in", blobCopy: blobCopyFor(loc) });
    }
  }
  return plan;
}

/** Plain-text folder tree of what the seed makes. */
export function formatLocationSeedTree(plan: LocationSeedPlan): string {
  const lines = ["Deck"];
  const folders = [...new Set(plan.rows.map((r) => r.folder))];
  folders.forEach((folder, fi) => {
    const lastFolder = fi === folders.length - 1;
    const rows = plan.rows.filter((r) => r.folder === folder);
    lines.push(`${lastFolder ? "└──" : "├──"} ${DECK_FOLDER_LABELS[folder]}`);
    const pad = lastFolder ? "    " : "│   ";
    lines.push(`${pad}└── Locations (${rows.length})`);
    rows.forEach((r, j) => {
      const pic = r.blobCopy ? r.blobCopy.toPathname : (r.data.pictureUrl ?? "no picture");
      lines.push(`${pad}    ${j === rows.length - 1 ? "└──" : "├──"} ${r.title}  [${r.itemId}]  ${pic}`);
    });
  });
  return lines.join("\n");
}
