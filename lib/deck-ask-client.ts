/**
 * Client-side half of the Ask-Grok bridge: the one place that actually
 * calls `fetch` against `/api/deck/ask`, so `AskGrokPanel` (and any future
 * caller, e.g. a Budju ask panel) stays a thin UI layer over this. Same
 * split as `lib/control-plane.ts` wrapping its own `/api/control-plane/*`
 * calls.
 */

import type { DeckAsk, DeckAskInput } from "./deck-ask";

const ASK_API_URL = "/api/deck/ask";

export interface SubmitAskResult {
  ask: DeckAsk;
  prompt: string;
}

function errorMessageFrom(body: unknown, status: number): string {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof (body as { error?: unknown }).error === "string"
  ) {
    return (body as { error: string }).error;
  }
  return `Ask failed (${status}).`;
}

/**
 * POSTs one Ask-Grok request and returns the stored record plus a
 * ready-to-paste prompt for Grok Bot. Throws an `Error` with a user-facing
 * message on any failure (network, non-2xx, or an unexpected response
 * shape) — callers show `err.message` inline, they don't need to inspect
 * further.
 */
export async function submitAsk(input: DeckAskInput): Promise<SubmitAskResult> {
  let response: Response;
  try {
    response = await fetch(ASK_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error("Network error \u2014 couldn't reach Deck.");
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Empty/non-JSON body — errorMessageFrom below falls back to the status.
  }

  if (!response.ok) {
    throw new Error(errorMessageFrom(body, response.status));
  }

  const { ask, prompt } = (body ?? {}) as Partial<SubmitAskResult>;
  if (!ask || typeof prompt !== "string") {
    throw new Error("Unexpected response from Deck.");
  }

  return { ask, prompt };
}
