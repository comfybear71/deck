import type { BudjuData, BudjuSignal, BudjuSignalType } from "./types";

/**
 * Live pull of Budju's public data — see the README's "Budju node" section
 * for the full writeup. Verified against `comfybear71/budju-xyz`
 * (`src/features/trade/Trade.tsx`, `services/tradeApi.ts`): Budju's own
 * `/trade` page loads its portfolio, prices, and auto-trader state
 * unauthenticated (its own comment literally says "Load data (all
 * public — no wallet needed)"). This module calls the same two endpoints
 * Budju's browser client calls, server-side, and reshapes the result into
 * the existing `BudjuData` shape — no new schema, no wallet, no scraping.
 *
 * Deliberately fails soft: any network hiccup, budju.xyz downtime, or
 * unexpected response shape returns `null` so the caller (the `/api/budju/live`
 * route, in turn `GraphView`) can fall back to the seed snapshot in
 * `data/budju.json` instead of showing broken data.
 */

const BUDJU_ORIGIN = "https://www.budju.xyz";
const BUDJU_TRADE_URL = "https://www.budju.xyz/trade";
const FETCH_TIMEOUT_MS = 8000;

/**
 * How close the current price needs to be to a buy/sell trigger (as a %
 * of current price) before Deck surfaces it as a near-buy/near-sell
 * signal. Budju's own UI (`AutoTraderView.tsx`) has tiered "near/hot/
 * critical" bands off a 0..1 progress value; Deck's glance doesn't need
 * that granularity, so this collapses it to one flat cutoff.
 */
const NEAR_THRESHOLD_PCT = 5;

/**
 * Caps on how many signal cards Deck renders — keeps the detail sheet a
 * glance, not a full monitoring dashboard, even on a broad market dip
 * where a dozen+ coins can be near a buy trigger at once. Split into two
 * pools (rather than one flat cap) so a flood of near-buy signals can't
 * crowd cooldowns out entirely — Stuart wants cooldowns visible as a
 * quiet status, not hidden (see `sortSignals` in `lib/budju.ts`).
 */
const MAX_ACTIONABLE_SIGNALS = 5;
const MAX_COOLDOWN_SIGNALS = 3;

/**
 * Ticker -> CoinGecko id, copied from budju-xyz's own `ASSET_CONFIG`
 * (`src/features/trade/services/tradeApi.ts`) — the exact map Budju's
 * client uses to price its own portfolio via CoinGecko. If Budju starts
 * trading a coin not listed here, that coin just prices at $0 (dropped
 * from the crypto total, no signal) instead of this fetch failing
 * outright — keep this in sync with Budju's `ASSET_CONFIG` if pool totals
 * start drifting from the live app.
 */
const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  XRP: "ripple",
  DOGE: "dogecoin",
  ADA: "cardano",
  SUI: "sui",
  XAUT: "tether-gold",
  AVAX: "avalanche-2",
  DOT: "polkadot",
  LINK: "chainlink",
  POL: "polygon-ecosystem-token",
  HBAR: "hedera-hashgraph",
  UNI: "uniswap",
  NEAR: "near",
  NEO: "neo",
  TRX: "tron",
  BCH: "bitcoin-cash",
  BNB: "binancecoin",
  ENA: "ethena",
  NEXO: "nexo",
  HYPE: "hyperliquid",
  RENDER: "render-token",
  FET: "fetch-ai",
  TAO: "bittensor",
  PEPE: "pepe",
  LUNA: "terra-luna-2",
  LUNC: "terra-luna",
  BONK: "bonk",
  WIF: "dogwifcoin",
  JUP: "jupiter-exchange-solana",
};

interface RawPortfolioAsset {
  code: string;
  balance: number;
}

interface RawPrice {
  usd?: number;
  usd_24h_change?: number;
}

interface RawTierConfig {
  deviation?: number;
  sellDeviation?: number;
}

interface RawTraderState {
  autoTiers?: Record<string, RawTierConfig>;
  autoTierAssignments?: Record<string, number[] | number | string>;
  autoCooldowns?: Record<string, number>;
  autoActive?: { targets?: Record<string, { buy: number; sell: number }> };
}

function roundTo(value: number | undefined, decimals: number): number | undefined {
  if (typeof value !== "number") return undefined;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Same call Budju's browser client makes to its own `/api/proxy` for
 * `/portfolio/` — server-side Swyftx balances, no wallet involved. */
async function fetchBudjuPortfolio(): Promise<RawPortfolioAsset[]> {
  const data = await fetchJson<{ assets?: RawPortfolioAsset[] }>(
    `${BUDJU_ORIGIN}/api/proxy`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: "/portfolio/" }),
    }
  );
  return data.assets ?? [];
}

/** Same call Budju's browser client makes to its own `/api/proxy` for
 * `/prices/` — CoinGecko, proxied server-side to dodge CORS. */
async function fetchBudjuPrices(
  ids: string[]
): Promise<Record<string, RawPrice>> {
  if (ids.length === 0) return {};
  return fetchJson<Record<string, RawPrice>>(`${BUDJU_ORIGIN}/api/proxy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: "/prices/", body: { ids: ids.join(",") } }),
  });
}

/** Budju's own `/api/state` — explicitly commented "public" in
 * `tradeApi.ts`'s `fetchTraderState()`: tier config, coin assignments,
 * cooldowns, and live buy/sell targets. */
async function fetchBudjuState(): Promise<RawTraderState> {
  return fetchJson<RawTraderState>(`${BUDJU_ORIGIN}/api/state`);
}

interface SignalCandidate {
  asset: string;
  tierNum: number;
  type: BudjuSignalType;
  nearestPct: number;
  buyBelow: number;
  sellAbove: number;
  current: number;
}

function buildSignals(
  state: RawTraderState,
  priceByCode: Record<string, number>,
  changeByCode: Record<string, number>,
  balanceByCode: Record<string, number>,
  now: number
): BudjuSignal[] {
  const tiers = state.autoTiers ?? {};
  const assignments = state.autoTierAssignments ?? {};
  const cooldowns = state.autoCooldowns ?? {};
  const liveTargets = state.autoActive?.targets ?? {};

  // Per coin, keep only the tier whose trigger is closest to firing — a
  // coin monitored across T1/T2/T3 shouldn't produce three near-identical
  // chips for the same asset.
  const bestByCoin = new Map<string, SignalCandidate>();

  for (const [asset, rawTiers] of Object.entries(assignments)) {
    const price = priceByCode[asset];
    if (!price || price <= 0) continue;

    const tierNums: number[] = Array.isArray(rawTiers)
      ? rawTiers
      : [Number(String(rawTiers).replace("tier", ""))].filter(
          (n) => n >= 1 && n <= 3
        );

    for (const tierNum of tierNums) {
      const tierKey = `tier${tierNum}`;
      const tierCfg = tiers[tierKey] ?? {};
      const dev = Number(tierCfg.deviation) || 0;
      const sellDev = Number(tierCfg.sellDeviation) || dev * 2;
      const compoundKey = `${asset}:${tierNum}`;
      const live = liveTargets[compoundKey] ?? liveTargets[asset];

      const buyBelow = live?.buy ?? (dev > 0 ? price * (1 - dev / 100) : 0);
      const sellAbove =
        live?.sell ?? (sellDev > 0 ? price * (1 + sellDev / 100) : 0);
      if (buyBelow <= 0 || sellAbove <= 0) continue;

      const cooldownUntil = cooldowns[compoundKey] ?? cooldowns[asset];
      const inCooldown =
        typeof cooldownUntil === "number" && now < cooldownUntil;

      const pctToBuy = ((price - buyBelow) / price) * 100;
      const pctToSell = ((sellAbove - price) / price) * 100;
      const nearestSide: "buy" | "sell" =
        pctToBuy <= pctToSell ? "buy" : "sell";
      const nearestPct = Math.max(
        0,
        nearestSide === "buy" ? pctToBuy : pctToSell
      );

      let type: BudjuSignalType | null = null;
      if (inCooldown) {
        type = "cooldown";
      } else if (nearestPct <= NEAR_THRESHOLD_PCT) {
        type = nearestSide === "buy" ? "near-buy" : "near-sell";
      }
      // Neither near a trigger nor cooling down — Budju's own UI would
      // badge this "LIVE"/monitoring, a state Deck's glance doesn't model.
      if (!type) continue;

      const existing = bestByCoin.get(asset);
      if (!existing || nearestPct < existing.nearestPct) {
        bestByCoin.set(asset, {
          asset,
          tierNum,
          type,
          nearestPct,
          buyBelow,
          sellAbove,
          current: price,
        });
      }
    }
  }

  const byProximity = (a: SignalCandidate, b: SignalCandidate) =>
    a.nearestPct - b.nearestPct;

  const actionable = Array.from(bestByCoin.values())
    .filter((c) => c.type !== "cooldown")
    .sort(byProximity)
    .slice(0, MAX_ACTIONABLE_SIGNALS);
  const cooldownCandidates = Array.from(bestByCoin.values())
    .filter((c) => c.type === "cooldown")
    .sort(byProximity)
    .slice(0, MAX_COOLDOWN_SIGNALS);

  // Actionable (near-buy/near-sell) ahead of cooldowns — mirrors
  // `sortSignals` in lib/budju.ts.
  const candidates = [...actionable, ...cooldownCandidates];

  return candidates.map((c) => {
    const signal: BudjuSignal = {
      id: `${c.asset.toLowerCase()}-${c.type}`,
      asset: c.asset,
      type: c.type,
      tier: `T${c.tierNum}`,
      qty: roundTo(balanceByCode[c.asset], 2),
      price: c.current,
      changePct: changeByCode[c.asset] ?? 0,
      buyBelow: c.buyBelow,
      current: c.current,
      sellAbove: c.sellAbove,
    };
    if (c.type === "near-buy") {
      signal.toBuyPct = Math.round(c.nearestPct * 10) / 10;
    }
    return signal;
  });
}

/**
 * Pure transform: raw portfolio + prices + trader state -> `BudjuData`.
 * Kept separate from the network calls in `fetchLiveBudjuData` so the
 * shaping logic (pool total, split, signals) is easy to follow — and,
 * later, easy to unit test — without touching the network.
 */
export function buildBudjuData(
  assets: RawPortfolioAsset[],
  prices: Record<string, RawPrice>,
  state: RawTraderState,
  now = Date.now()
): BudjuData {
  let cryptoUSD = 0;
  let usdcUSD = 0;
  let assetCount = 0;
  const priceByCode: Record<string, number> = {};
  const changeByCode: Record<string, number> = {};
  const balanceByCode: Record<string, number> = {};

  for (const asset of assets) {
    const { code, balance } = asset;
    if (!balance || balance <= 0) continue;
    balanceByCode[code] = balance;

    if (code === "USDC") {
      usdcUSD += balance;
      continue;
    }
    // Dust AUD/USD cash balances aren't part of the crypto/USDC split Budju
    // itself shows — skip them rather than inventing a third slice.
    if (code === "USD" || code === "AUD") continue;

    const cgId = COINGECKO_IDS[code];
    const price = cgId ? prices[cgId]?.usd ?? 0 : 0;
    if (cgId) {
      priceByCode[code] = price;
      changeByCode[code] = prices[cgId]?.usd_24h_change ?? 0;
    }
    const usdValue = balance * price;
    if (usdValue > 0) {
      cryptoUSD += usdValue;
      assetCount += 1;
    }
  }

  const totalUSD = cryptoUSD + usdcUSD;
  const cryptoPct = totalUSD > 0 ? Math.round((cryptoUSD / totalUSD) * 100) : 0;
  const usdcPct = totalUSD > 0 ? 100 - cryptoPct : 0;

  return {
    url: BUDJU_TRADE_URL,
    updatedAt: new Date(now).toISOString(),
    pool: {
      totalUSD: Math.round(totalUSD),
      assetCount,
      hasCash: usdcUSD > 0,
    },
    split: {
      cryptoPct,
      cryptoUSD: Math.round(cryptoUSD),
      usdcPct,
      usdcUSD: Math.round(usdcUSD),
    },
    signals: buildSignals(state, priceByCode, changeByCode, balanceByCode, now),
  };
}

/**
 * Fetches Budju's public portfolio + prices + trader state and returns a
 * fresh `BudjuData` snapshot, or `null` if anything along the way fails.
 * Callers (the `/api/budju/live` route) should fall back to the seed
 * snapshot in `data/budju.json` on `null`, never surface an error state
 * for what's meant to be a glance.
 */
export async function fetchLiveBudjuData(): Promise<BudjuData | null> {
  try {
    const assets = await fetchBudjuPortfolio();
    const ids = Array.from(
      new Set(
        assets
          .map((a) => COINGECKO_IDS[a.code])
          .filter((id): id is string => Boolean(id))
      )
    );
    const [prices, state] = await Promise.all([
      fetchBudjuPrices(ids),
      fetchBudjuState(),
    ]);
    return buildBudjuData(assets, prices, state);
  } catch (err) {
    console.warn(
      "[budju-live] live fetch failed, caller should fall back to seed data:",
      err
    );
    return null;
  }
}
