/**
 * Per-member still sleeve (library) — pure helpers.
 *
 * Each band member keeps a durable sleeve of stills: their avatar plus
 * every plate still Stuart marks **Keep**. Sleeve lives on the member
 * record (Neon session → `bands[].members[]`), not on the song/MP3, so
 * switching songs never clears it. Switching members shows that
 * member's sleeve only — never another artist's.
 *
 * Picking a sleeve still onto a plate is a free apply (Blob URL copy,
 * `source: "library"`) — never a generate-still API call. Generate
 * plates treats a library still like an approved still and skips that
 * row.
 */

/** One kept still in a member's sleeve. `dataUrl` is a Blob `https://`
 * URL (or a seeded `/…` avatar path) — never invented pixels. */
export interface SkidmarksMemberSleeveEntry {
  id: string;
  dataUrl: string;
  createdAt: number;
}

/** Cap so a sleeve can't grow without bound (URLs only, but still). */
export const MAX_MEMBER_SLEEVE_STILLS = 48;

/** Stable id for the avatar row when it appears in the resolved sleeve. */
export const MEMBER_SLEEVE_AVATAR_ID = "sleeve-avatar";

export interface MemberSleeveSource {
  avatarImage?: string;
  stillSleeve?: SkidmarksMemberSleeveEntry[];
}

/** Minimal plate-still shape this module writes — matches
 * `SkidmarksPlateStill` in `lib/skidmarks.ts` (including `source:
 * "library"`). */
export interface LibraryPlateStill {
  dataUrl: string;
  source: "library";
  createdAt: number;
}

function trimUrl(url: string | undefined | null): string | undefined {
  if (typeof url !== "string") return undefined;
  const t = url.trim();
  return t.length > 0 ? t : undefined;
}

/**
 * Resolves the sleeve Stuart sees for one member: avatar first (when
 * set), then every Keep'd still — deduped by URL so keeping the avatar
 * (or keeping the same plate twice) doesn't double-list it. Never pulls
 * another member's entries.
 */
export function resolveMemberStillSleeve(
  member: MemberSleeveSource | null | undefined
): SkidmarksMemberSleeveEntry[] {
  if (!member) return [];
  const out: SkidmarksMemberSleeveEntry[] = [];
  const seen = new Set<string>();

  const avatar = trimUrl(member.avatarImage);
  if (avatar) {
    seen.add(avatar);
    out.push({ id: MEMBER_SLEEVE_AVATAR_ID, dataUrl: avatar, createdAt: 0 });
  }

  const kept = Array.isArray(member.stillSleeve) ? member.stillSleeve : [];
  for (const entry of kept) {
    const url = trimUrl(entry?.dataUrl);
    if (!url || seen.has(url)) continue;
    if (typeof entry.id !== "string" || entry.id.length === 0) continue;
    if (typeof entry.createdAt !== "number") continue;
    seen.add(url);
    out.push({ id: entry.id, dataUrl: url, createdAt: entry.createdAt });
  }
  return out;
}

/**
 * Appends a Keep'd still URL to the stored sleeve (not including the
 * virtual avatar row). No-ops / returns the same array when the URL is
 * blank, already present, or already the avatar. Caps at
 * `MAX_MEMBER_SLEEVE_STILLS` (drops oldest kept entry when full).
 */
export function appendKeptStillToSleeve(
  member: MemberSleeveSource,
  dataUrl: string,
  mintId: () => string = () => `sleeve_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
): SkidmarksMemberSleeveEntry[] {
  const url = trimUrl(dataUrl);
  if (!url) return Array.isArray(member.stillSleeve) ? [...member.stillSleeve] : [];

  const avatar = trimUrl(member.avatarImage);
  if (avatar && avatar === url) {
    return Array.isArray(member.stillSleeve) ? [...member.stillSleeve] : [];
  }

  const existing = Array.isArray(member.stillSleeve) ? [...member.stillSleeve] : [];
  if (existing.some((e) => trimUrl(e.dataUrl) === url)) return existing;

  const next: SkidmarksMemberSleeveEntry[] = [
    ...existing,
    { id: mintId(), dataUrl: url, createdAt: Date.now() },
  ];
  if (next.length <= MAX_MEMBER_SLEEVE_STILLS) return next;
  return next.slice(next.length - MAX_MEMBER_SLEEVE_STILLS);
}

/**
 * Builds the plate still written when Stuart picks a sleeve entry onto
 * a plate slot — free apply, no generate-still. `source: "library"` is
 * what Generate plates uses to treat this as already approved (including
 * when the URL is the member's avatar, which Timeline preview would
 * otherwise not count as ready).
 */
export function buildLibraryPlateStill(dataUrl: string, createdAt: number = Date.now()): LibraryPlateStill {
  return {
    dataUrl: dataUrl.trim(),
    source: "library",
    createdAt,
  };
}

/**
 * Whether a URL belongs to this member's sleeve (avatar or a kept
 * still). Used so tests can assert no cross-member bleed.
 */
export function urlIsInMemberSleeve(
  member: MemberSleeveSource | null | undefined,
  dataUrl: string | undefined | null
): boolean {
  const url = trimUrl(dataUrl);
  if (!url || !member) return false;
  return resolveMemberStillSleeve(member).some((e) => e.dataUrl === url);
}

/** Normalize one rehydrated sleeve entry; drops junk. */
export function normalizeMemberSleeveEntry(value: unknown): SkidmarksMemberSleeveEntry | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Partial<SkidmarksMemberSleeveEntry>;
  if (typeof v.id !== "string" || v.id.length === 0) return undefined;
  if (typeof v.dataUrl !== "string" || v.dataUrl.length === 0) return undefined;
  const hasKnownPrefix =
    v.dataUrl.startsWith("data:") ||
    v.dataUrl.startsWith("https://") ||
    v.dataUrl.startsWith("http://") ||
    v.dataUrl.startsWith("/");
  if (!hasKnownPrefix) return undefined;
  if (typeof v.createdAt !== "number") return undefined;
  return { id: v.id, dataUrl: v.dataUrl, createdAt: v.createdAt };
}

export function normalizeMemberStillSleeve(raw: unknown): SkidmarksMemberSleeveEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const entries = raw
    .map(normalizeMemberSleeveEntry)
    .filter((e): e is SkidmarksMemberSleeveEntry => !!e);
  return entries.length > 0 ? entries.slice(0, MAX_MEMBER_SLEEVE_STILLS) : undefined;
}
