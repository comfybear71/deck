import { NextResponse } from "next/server";
import { isLegacyTestFolder, type LegacyEpisodeSource, type LegacyStory } from "@/lib/skidmarksLegacyImport";

/**
 * GET /api/skidmarks/legacy-episodes: reads the episodes saved in the old
 * Skidmarks app (Crash Lab) so Deck can import them. Read-only GETs to
 * `skidmarks.aiglitch.app`; never POSTs, never writes anything back, and
 * spends nothing. The mapping into Deck's nine-beat episodes happens on
 * the client in `lib/skidmarksLegacyImport.ts`.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BASE = "https://skidmarks.aiglitch.app/api/crash";

interface ListEntry {
  label?: string;
  folderName?: string;
  savedAt?: string;
  styleId?: string;
}

async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status} from old Skidmarks app`);
  return res.json();
}

export async function GET() {
  let list: ListEntry[];
  try {
    const body = (await getJson(`${BASE}/episodes`, 20_000)) as { episodes?: ListEntry[] };
    list = Array.isArray(body.episodes) ? body.episodes : [];
  } catch (err) {
    return NextResponse.json(
      { error: `Couldn't reach the old Skidmarks app: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }

  const wanted = list.filter(
    (e): e is ListEntry & { folderName: string } =>
      typeof e.folderName === "string" && e.folderName.length > 0 && !isLegacyTestFolder(e.folderName)
  );

  const episodes: LegacyEpisodeSource[] = await Promise.all(
    wanted.map(async (e) => {
      const url = `${BASE}/story?styleId=${encodeURIComponent(e.styleId || "skidmarks")}&folderName=${encodeURIComponent(e.folderName)}`;
      try {
        const body = (await getJson(url, 45_000)) as { story?: LegacyStory };
        return { folderName: e.folderName, label: e.label, savedAt: e.savedAt, story: body.story ?? null };
      } catch {
        return { folderName: e.folderName, label: e.label, savedAt: e.savedAt, story: null };
      }
    })
  );

  return NextResponse.json({ episodes });
}
