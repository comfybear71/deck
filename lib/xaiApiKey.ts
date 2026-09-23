/**
 * Shared xAI API key resolution for plate stills, Grok Imagine video,
 * and Sunny Banks plating. Manual A/B team switch (Stuart, 2026-09-24):
 * keep two team keys on Vercel and flip which one is live by changing
 * `XAI_API_KEY_SLOT` then redeploying — no auto-failover, no silent
 * spend on the backup.
 *
 * - Slot A (default): `XAI_API_KEY` (existing name, unchanged)
 * - Slot B: `XAI_API_KEY_B`
 * - Switch: `XAI_API_KEY_SLOT` = `A` | `B` (case-insensitive; anything
 *   else / unset → A)
 */

export const XAI_API_KEY_ENV_VAR = "XAI_API_KEY";
export const XAI_API_KEY_B_ENV_VAR = "XAI_API_KEY_B";
export const XAI_API_KEY_SLOT_ENV_VAR = "XAI_API_KEY_SLOT";

export type XaiApiKeySlot = "A" | "B";

/** Partial env map — `process.env` or a test stub. Avoids requiring
 * `NODE_ENV` the way `NodeJS.ProcessEnv` does (that broke `next build`
 * typecheck on the unit tests in #171). */
export type XaiEnv = Record<string, string | undefined>;

/** Which team slot is selected. Unset / empty / junk → A so today's
 * single-key Vercel setup keeps working with no env change. */
export function resolveXaiApiKeySlot(env: XaiEnv = process.env): XaiApiKeySlot {
  const raw = (env[XAI_API_KEY_SLOT_ENV_VAR] ?? "").trim().toUpperCase();
  return raw === "B" ? "B" : "A";
}

/**
 * Returns the active team key and which env var it came from, or null
 * when that slot's key is missing. Never falls through to the other
 * slot — flipping is deliberate via `XAI_API_KEY_SLOT` + redeploy.
 */
export function resolveXaiApiKey(
  env: XaiEnv = process.env
): { key: string; envVarName: string; slot: XaiApiKeySlot } | null {
  const slot = resolveXaiApiKeySlot(env);
  const envVarName = slot === "B" ? XAI_API_KEY_B_ENV_VAR : XAI_API_KEY_ENV_VAR;
  const key = env[envVarName];
  if (!key) return null;
  return { key, envVarName, slot };
}

/** Plain-language missing-key copy for 501 responses — names the active
 * slot and both env vars so a flip to B without setting KEY_B is obvious. */
export function missingXaiApiKeyMessage(purpose: string, env: XaiEnv = process.env): string {
  const slot = resolveXaiApiKeySlot(env);
  const active = slot === "B" ? XAI_API_KEY_B_ENV_VAR : XAI_API_KEY_ENV_VAR;
  return (
    `${active} is not set on the server (XAI_API_KEY_SLOT=${slot}) — ${purpose} is unavailable here. ` +
    `Slot A uses ${XAI_API_KEY_ENV_VAR}; slot B uses ${XAI_API_KEY_B_ENV_VAR}. Flip with ${XAI_API_KEY_SLOT_ENV_VAR}=A|B, ` +
    "then redeploy — Vercel only applies env changes to new deployments."
  );
}
