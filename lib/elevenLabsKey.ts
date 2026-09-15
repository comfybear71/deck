/**
 * Shared ElevenLabs API key resolution — originally lived only inside
 * `app/api/skidmarks/transcribe/route.ts` (the speech-to-text path);
 * pulled out here (2026-09-15) so `app/api/skidmarks/sunnybank/
 * generate-speak-beat/route.ts` (real text-to-speech, for Sunny Banks
 * dialogue lines) can share the exact same "which env var, in what
 * order" logic rather than re-guessing it. Same key, same account,
 * both directions of the same ElevenLabs API.
 */

/** Candidate env var names for Stuart's existing ElevenLabs API key, in
 * priority order. `ELEVENLABS_API_KEY` is the standard name ElevenLabs'
 * own SDKs/docs use, and the one Stuart confirmed he set on this
 * project; `ELEVEN_LABS_API_KEY` is the one plausible manual-naming
 * variant worth checking for free. Not an open-ended guess list — if
 * neither is set, `resolveElevenLabsApiKey` says so honestly (naming
 * both) rather than silently trying more names. */
export const ELEVENLABS_API_KEY_ENV_CANDIDATES = ["ELEVENLABS_API_KEY", "ELEVEN_LABS_API_KEY"] as const;

/** Looks up Stuart's already-configured ElevenLabs key under whichever
 * of `ELEVENLABS_API_KEY_ENV_CANDIDATES` is actually set, and reports
 * which name matched — so a caller that finds nothing can name exactly
 * what it checked instead of a bare "not configured". Returns `null`,
 * never throws, if none match. */
export function resolveElevenLabsApiKey(): { key: string; envVarName: string } | null {
  for (const envVarName of ELEVENLABS_API_KEY_ENV_CANDIDATES) {
    const key = process.env[envVarName];
    if (key) return { key, envVarName };
  }
  return null;
}
