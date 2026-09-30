/**
 * Server only: one zip of saved clips, streamed straight to the download
 * (2026-09-30). Shared by Sunnybank's act zip
 * (`app/api/skidmarks/sunnybank/clips-zip`) and the Shorts episode zip
 * (`app/api/skidmarks/adult-shorts/clips-zip`), so both fetch, time out,
 * size-check and list missing clips the same way. Built one clip at a
 * time, so neither the phone nor the function holds every video at once.
 *
 * The entries' URLs must already be checked against Deck's own clip
 * hosts by the caller's planner. Reads only; nothing is saved.
 */
import { storeZipStream } from "./zipDownload";

const PER_CLIP_TIMEOUT_MS = 60_000;
/** Biggest single clip read into function memory. */
const MAX_CLIP_BYTES = 200 * 1024 * 1024;

/** A form POST (`request` = JSON, what iPhone Safari sends) or a JSON body. */
export async function readZipRequest(request: Request): Promise<unknown> {
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

/** A plain-text page for a request that can't be zipped. */
export function zipPlainError(message: string, status: number): Response {
  return new Response(`${message}\n\nGo back to Deck and try again.`, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/** The zip itself: the entries in order, plus `missing.txt` when any clip can't be fetched. */
export function clipsZipResponse(zipName: string, entries: readonly { name: string; url: string }[]): Response {
  const failures: string[] = [];
  const stream = storeZipStream(
    entries.map((e) => e.name),
    async (index) => {
      const entry = entries[index];
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
      "Content-Disposition": `attachment; filename="${zipName}"`,
      "Cache-Control": "no-store",
    },
  });
}
