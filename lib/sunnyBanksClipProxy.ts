/**
 * Host allowlist for the Sunny Banks clip proxy
 * (`app/api/skidmarks/sunnybank/clip-proxy/route.ts`).
 *
 * Why the proxy exists: a Sunny Banks episode's clips come from two
 * places. The ones rendered here land on Vercel Blob; the 46 Crash Lab
 * EP02 seed clips live on `skidmarks.aiglitch.app`. The browser will
 * happily *play* a cross-origin MP4 in a `<video>`, but it will not let
 * page JavaScript *read the bytes* without a CORS header — so
 * "Download Episode (.zip)" silently shipped 18 of 64 clips (live QA,
 * 2026-09-18). A server-side fetch has no such restriction.
 *
 * **This is the security-critical half, so it lives on its own and is
 * tested on its own.** A route that fetches whatever URL a query
 * parameter names is an open proxy: point it at an internal address
 * and it will happily read things the caller could never reach. So the
 * rule is an explicit allowlist of the two hosts this app already
 * streams clips from, not a blocklist and not a "looks internal?"
 * heuristic — those fail open on the case nobody thought of.
 *
 * Deliberately strict:
 * - `https:` only. No `http:`, no `file:`, no `data:`, no `blob:`.
 * - Exact hostname match, or an exact suffix match on a dotted
 *   boundary for Vercel Blob's per-store subdomain. `evil-blob
 *   .vercel-storage.com.attacker.test` does not match, and neither
 *   does `notblob.vercel-storage.com`.
 * - No credentials, port, or userinfo in the URL.
 */

/** Crash Lab EP02's host — the same `sourceHost` the seed fixture
 * already points playback at. Kept as a literal rather than imported
 * from the fixture so the allowlist cannot be widened by editing a
 * JSON data file. */
const CRASH_LAB_HOST = "skidmarks.aiglitch.app";

/** Vercel Blob serves each store from its own subdomain, so this one
 * has to match on a suffix — anchored at a dot so it cannot be spoofed
 * by a longer hostname that merely ends with the same characters. */
const VERCEL_BLOB_SUFFIX = ".public.blob.vercel-storage.com";

export const SUNNY_BANKS_CLIP_PROXY_PATH = "/api/skidmarks/sunnybank/clip-proxy";

/**
 * Is this a URL the clip proxy is allowed to fetch? Anything this
 * returns `false` for must be refused by the route — never fetched
 * "just to see", since the fetch itself is the vulnerability.
 */
export function isAllowedSunnyBanksClipUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  // Userinfo can be used to disguise the real host from a careless
  // reader (`https://trusted.example@evil.test/`). `URL` parses that
  // correctly, but there is no legitimate reason for a clip URL to
  // carry credentials, so refuse rather than rely on that.
  if (parsed.username || parsed.password) return false;
  if (parsed.port) return false;

  const host = parsed.hostname.toLowerCase();
  if (host === CRASH_LAB_HOST) return true;
  // `.endsWith` on a dot-anchored suffix, plus a non-empty store label,
  // so `public.blob.vercel-storage.com` itself doesn't match either.
  return host.endsWith(VERCEL_BLOB_SUFFIX) && host.length > VERCEL_BLOB_SUFFIX.length;
}

/** The same-origin URL the browser should fetch instead of the
 * cross-origin one. Same-origin means no CORS rule applies, so the
 * bytes actually reach the page. */
export function buildSunnyBanksClipProxyUrl(rawUrl: string): string {
  return `${SUNNY_BANKS_CLIP_PROXY_PATH}?url=${encodeURIComponent(rawUrl)}`;
}
