# The Tab — French Deck

A glanceable, single-card cost scoreboard. The goal is to understand monthly
burn in under two seconds — not a finance admin panel, no sidebar, no
multi-page nav.

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS, at the repo root.
- No auth, no live billing APIs. Cost data is still all seed data — the
  only backend is the small `/api/control-plane/*` stub described below,
  which exists to make the dials bite, not to bill anything.

## What's here

- `data/meters.json` — seed cost meters (id, name, suit, amount, currency,
  cadence, mode, notes, optional alert).
- `lib/` — types + pure helpers (lane/burn sums, money formatting, glow
  intensity vs. the leash goal).
- `lib/control-plane.ts` / `lib/control-plane-server.ts` — the v0
  control-plane stub. See "Control plane (v0 stub)" below.
- `app/api/control-plane/` — App Router routes (`mode`, `check`, `report`)
  that back the stub's server side.
- `hooks/useDialModes.ts` — per-lane **Full / Slow / Pause** dial state.
  Calls straight into `lib/control-plane.ts`'s `setMode`, so the dial and
  the plane share one source of truth (`localStorage`, mirrored to the
  server stub). Dials actually gate things now — see below.
- `hooks/useTabView.ts` — whether The Tab is shown as the compact chip or
  the full expanded card, persisted to `localStorage`. Defaults to the chip.
- `components/` — `TabWidget` (switches between chip/card), `TabChip` (the
  default collapsed pill), `TabCard` (the full expanded screen), `BigBurn`
  (big number + glow halo), `AlertsStrip`, `SuitLane` (one of the four
  suits), `DialControl`, `BottomSheet` (tap a suit to see its individual
  meters), `ControlPlaneDemo` (the "Simulate spend" panel, expanded-view
  only).

## Control plane (v0 stub)

Stuart wants Full / Slow / Pause to mean something, not just look like a
toggle. This app now ships a **thin local control-plane stub** — not a
separate service, just enough to make the dials bite and to give a future
project (Skidmarks, or `aiglitch-api`) an obvious shape to call into.

- `check(lane)` \u2192 `{ allowed, mode, reason?, maxConcurrent?, delayMs? }`.
  **Pause** denies (`allowed: false`). **Slow** allows but returns a
  throttle hint (`maxConcurrent: 1`, `delayMs: 1200`). **Full** allows
  outright. Synchronous and local — reads the same store a dial just wrote,
  so it works instantly, even offline.
- `report(lane, amount?, meta?)` records a spend event. It's a
  client-persisted log in `localStorage` (`the-tab:spend-log`, capped at the
  last 100 events) plus a best-effort POST to `/api/control-plane/report`,
  which appends to an in-memory server-side log
  (`lib/control-plane-server.ts`). The server mirror is fire-and-forget —
  the UI never blocks on it, and it resets on redeploy/cold start, which is
  expected for a stub.
- `setMode(lane, mode)` persists the dial position to `localStorage`
  (`the-tab:dial-modes` — the same key `useDialModes` reads) and
  best-effort mirrors it to `/api/control-plane/mode`. The suit dials call
  this directly, so the UI and the plane can't drift apart.
- **`ControlPlaneDemo`** — an expandable "Control-plane demo" section at the
  bottom of the expanded `TabCard` (not shown in chip mode). Each suit has a
  "Simulate spend" button that runs the real `check` \u2192 `report` round
  trip and shows **allowed** / **throttled** / **denied**, so the leash is
  felt on a phone without plugging in a real spend source yet.

### How a future project calls this

`Skidmarks` / `aiglitch-api` isn't wired to this stub — that's explicitly
out of scope here. When it is, the intended integration is: before an
expensive call, hit `GET /api/control-plane/check?lane=<diamonds|spades|hearts|clubs>`
and honor `allowed`/`delayMs`/`maxConcurrent`; after it, `POST
/api/control-plane/report` with `{ lane, amount, meta }`. Both routes are
plain JSON over HTTP with no auth in v0 (same-origin, no secrets) — a real
control plane will very likely be its **own service**, not nested inside
this app; these routes exist so the request/response shape is proven out
first.

## Chip mode

The Tab loads as a small floating chip by default — a glanceable pill
showing the estimated burn, four tiny suit dots (lit up if that lane has
spend, pulsing if hot), and an ambient glow that scales with spend against
the leash goal, same as the full card. Tap the chip to expand into the full
`TabCard`; tap the circular chevron in its top-right corner (or press Esc)
to collapse back to the chip. The choice is persisted to `localStorage`
(`the-tab:view-mode`), defaulting to the chip on first load.

## The four lanes

- ♦ **Models** — xAI API, Claude (sub + usage), Cursor Pro, DeepSeek,
  SuperGrok
- ♠ **Infra** — Vercel, Neon, Resend, ImprovMX, MongoDB
- ♥ **Make** — Comfy, ElevenLabs, Suno, Siray, Odds API
- ♣ **Life** — iCloud+, X Premium, Meta/Facebook (est.)

The big number sums every USD-denominated, active meter. Claude's AUD usage
meter is shown as a separate subline and is never silently converted.
Closed (DigitalOcean) and TBD (MongoDB) meters are listed in their lane's
sheet but excluded from totals. The soft monthly leash goal is **$400 USD**
(`LEASH_GOAL_USD` in `lib/constants.ts`) — the ambient glow behind the big
number scales with spend against that goal.

## Local dev

```bash
npm install
npm run dev
```

## Deploy notes

- Branch: `master`.
- Vercel should auto-detect Next.js now that `next`, `react`, and
  `react-dom` are real `dependencies` in the root `package.json` (this repo
  previously had no app at the root, which is why the build failed with
  "No Next.js version detected").
- Intended domain: `deck.aiglitch.app`.
- No environment variables are required for v0 — it's all static seed data.
