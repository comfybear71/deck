import { planSunnyBanksClipsZip } from "@/lib/sunnyBanksClipsZip";
import { storeZipStream } from "@/lib/zipDownload";

/**
 * POST /api/skidmarks/sunnybank/clips-zip — one zip of an act's Done
 * clips (2026-09-30), for the zip icon beside each act in CLIPS.
 *
 * Takes the episode, the act and its Done clips' saved URLs (a form
 * field `request`, JSON, so iPhone Safari downloads the answer itself),
 * and streams back a zip with readable names in line order
 * (`ep01-act-ii-01-shazza.mp4`). Built here, one clip at a time, so the
 * phone never loads the videos into memory.
 *
 * Only Deck's own clip hosts are ever fetched (`isAllowedSunnyBanksClipUrl`,
 * the same allowlist as the clip proxy). Reads only; nothing is saved.
 * A clip that can't be fetched is left out and listed in `missing.txt`.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const PER_CLIP_TIMEOUT_MS = 60_000;
/** Biggest single clip read into function memory. */
const MAX_CLIP_BYTES = 200 * 1024 * 1024;

async function readRequest(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) return await request.json();
    const form = await request.formData();
    const raw = form.get("request");
    return typeof raw === "string" ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function plainError(message: string, status: number): Response {
  return new Response(`${message}\n\nGo back to Deck and try again.`, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function POST(request: Request) {
  const plan = planSunnyBanksClipsZip(await readRequest(request));
  if (!plan.ok) return plainError(plan.error, 400);

  const failures: string[] = [];
  const stream = storeZipStream(
    plan.entries.map((e) => e.name),
    async (index) => {
      const entry = plan.entries[index];
      try {
        const res = await fetch(entry.url, { redirect: "follow", signal: AbortSignal.timeout(PER_CLIP_TIMEOUT_MS) });
        if (!res.ok) {
          failures.push(`${entry.name}: the clip host answered ${res.status}`);
          return null;
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length === 0 || bytes.length > MAX_CLIP_BYTES) {
          failures.push(`${entry.name}: empty or too big`);
          return null;
        }
        return bytes;
      } catch (err) {
        failures.push(`${entry.name}: ${err instanceof Error && err.name === "TimeoutError" ? "timed out" : "could not be fetched"}`);
        return null;
      }
    },
    (missing) =>
      missing.length === 0
        ? []
        : [
            {
              name: "missing.txt",
              data: new TextEncoder().encode(
                `${missing.length} clip${missing.length === 1 ? "" : "s"} couldn't be added:\n${failures.join("\n")}\n`,
              ),
            },
          ],
  );

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${plan.zipName}"`,
      "Cache-Control": "no-store",
    },
  });
}
