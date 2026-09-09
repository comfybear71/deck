/**
 * Server-side half of the v0 control-plane stub. Backs the
 * `/api/control-plane/*` routes with an in-memory store.
 *
 * This is intentionally not durable: module-level state lives for the life
 * of a warm serverless instance and resets on cold start / redeploy. That's
 * fine for a stub whose job is to prove the shape of the API — a future
 * real control plane (Skidmarks / aiglitch-api) replaces this file with a
 * real datastore behind the same routes.
 */

import type { DialMode, Suit } from "./types";
import { DIAL_MODES, SUIT_ORDER } from "./constants";
import { evaluate, type CheckResult, type SpendEvent } from "./control-plane";

function defaultServerModes(): Record<Suit, DialMode> {
  const seeded = {} as Record<Suit, DialMode>;
  for (const suit of SUIT_ORDER) seeded[suit] = "full";
  return seeded;
}

const serverModes: Record<Suit, DialMode> = defaultServerModes();
const serverSpendLog: SpendEvent[] = [];
const SPEND_LOG_LIMIT = 200;

export function isValidSuit(value: unknown): value is Suit {
  return typeof value === "string" && (SUIT_ORDER as string[]).includes(value);
}

export function isValidMode(value: unknown): value is DialMode {
  return typeof value === "string" && (DIAL_MODES as string[]).includes(value);
}

export function getServerModes(): Record<Suit, DialMode> {
  return { ...serverModes };
}

export function setServerMode(lane: Suit, mode: DialMode): void {
  serverModes[lane] = mode;
}

export function checkServer(lane: Suit): CheckResult {
  return evaluate(serverModes[lane]);
}

export function recordServerSpend(event: SpendEvent): { count: number } {
  serverSpendLog.push(event);
  if (serverSpendLog.length > SPEND_LOG_LIMIT) {
    serverSpendLog.splice(0, serverSpendLog.length - SPEND_LOG_LIMIT);
  }
  return { count: serverSpendLog.length };
}

export function getServerSpendLog(limit = 50): SpendEvent[] {
  return serverSpendLog.slice(-limit);
}
