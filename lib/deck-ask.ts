/**
 * "Ask Grok" bridge: shared types + pure helpers for the thin
 * `POST /api/deck/ask` API that lets a graph node's detail sheet queue a
 * free-text ask (plus a point-in-time status snapshot) for Grok Bot (QA
 * Engineer) without embedding a full Grok Bot iframe. See the README's
 * "Ask Grok (v0 stub)" section.
 *
 * Isomorphic (no `fs`, no server-only APIs) so it can be imported from the
 * server-side store (`lib/deck-ask-server.ts`), the API route, and client
 * components (`AskGrokPanel`, via `lib/deck-ask-client.ts`) alike — same
 * split as `lib/overrides.ts` / `lib/overrides-server.ts`.
 */

export const MAX_ASK_MESSAGE_LENGTH = 500;

/**
 * Whatever a project's current status looks like at ask-time — deliberately
 * loose (`Record<string, unknown>`) so Propfolio, and later Budju or other
 * nodes, can each pass their own shape without a shared schema. Only a few
 * well-known keys (`status`, `statusNote`, `clientCount`, `propertyCount`)
 * are read by `buildGrokPrompt`'s summary line below; anything else is
 * still stored, just not summarized.
 */
export type DeckAskStatusSnapshot = Record<string, unknown>;

/** Shape a caller POSTs to `/api/deck/ask`. */
export interface DeckAskInput {
  project: string;
  message: string;
  statusSnapshot?: DeckAskStatusSnapshot | null;
  /** Client-side queue timestamp (ms epoch); the server also stamps its own `receivedAt`. */
  ts?: number;
}

/** A normalized, stored ask record — what `recordAsk` returns and persists. */
export interface DeckAsk {
  id: string;
  project: string;
  message: string;
  statusSnapshot: DeckAskStatusSnapshot | null;
  ts: number;
  /** Server-side receipt time (ms epoch) — separate from the client's `ts`, used for the prompt's "queued at" line. */
  receivedAt: number;
}

/**
 * Validates + trims a raw POST body into a `DeckAskInput`, or returns an
 * `{ error }` describing the first problem found. Mirrors the shape of
 * `lib/overrides.ts`'s `IngestReceiptInput` validation.
 */
export function normalizeAskInput(
  input: unknown
): DeckAskInput | { error: string } {
  if (!input || typeof input !== "object") {
    return { error: "Body must be a JSON object." };
  }

  const { project, message, statusSnapshot, ts } = input as Partial<DeckAskInput>;

  if (typeof project !== "string" || project.trim().length === 0) {
    return { error: "project is required and must be a non-empty string." };
  }
  if (typeof message !== "string" || message.trim().length === 0) {
    return { error: "message is required and must be a non-empty string." };
  }
  if (message.trim().length > MAX_ASK_MESSAGE_LENGTH) {
    return {
      error: `message must be ${MAX_ASK_MESSAGE_LENGTH} characters or fewer.`,
    };
  }
  if (
    statusSnapshot !== undefined &&
    statusSnapshot !== null &&
    typeof statusSnapshot !== "object"
  ) {
    return { error: "statusSnapshot must be an object when provided." };
  }
  if (ts !== undefined && typeof ts !== "number") {
    return { error: "ts must be a number when provided." };
  }

  return {
    project: project.trim(),
    message: message.trim(),
    statusSnapshot: statusSnapshot ?? null,
    ts: ts ?? Date.now(),
  };
}

/**
 * Best-effort one-line rollup of a status snapshot, for the prompt body.
 * Reads only the well-known keys the Propfolio/Budju node shapes actually
 * set — falls back to raw JSON for an unrecognized shape, and to a plain
 * placeholder when there's no snapshot at all.
 */
function summarizeSnapshot(snapshot: DeckAskStatusSnapshot | null): string {
  if (!snapshot) return "(no status snapshot)";

  const parts: string[] = [];
  if (typeof snapshot.status === "string") {
    parts.push(snapshot.status.toUpperCase());
  }
  if (typeof snapshot.clientCount === "number") {
    parts.push(`${snapshot.clientCount} clients`);
  }
  if (typeof snapshot.propertyCount === "number") {
    parts.push(`${snapshot.propertyCount} properties`);
  }
  if (typeof snapshot.statusNote === "string" && snapshot.statusNote) {
    parts.push(`note: "${snapshot.statusNote}"`);
  }

  return parts.length > 0 ? parts.join(" \u00b7 ") : JSON.stringify(snapshot);
}

/**
 * Builds the copyable prompt Stuart pastes into Grok Bot (QA Engineer) —
 * pure text, no network call. Bundles the project, the ask, and a status
 * snapshot rollup so Grok has the same context Deck did when the ask was
 * queued, without Stuart re-typing it.
 */
export function buildGrokPrompt(ask: DeckAsk): string {
  const queuedAt = new Date(ask.receivedAt).toLocaleString();
  return [
    `Deck ask \u2014 ${ask.project} (queued ${queuedAt})`,
    "",
    ask.message,
    "",
    `Status snapshot: ${summarizeSnapshot(ask.statusSnapshot)}`,
  ].join("\n");
}
