# The Tab — French Deck

A glanceable, single-card cost scoreboard. The goal is to understand monthly
burn in under two seconds — not a finance admin panel, no sidebar, no
multi-page nav.

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS, at the repo root.
- No backend, no auth, no live billing APIs. Everything is seed data.

## What's here

- `data/meters.json` — seed cost meters (id, name, suit, amount, currency,
  cadence, mode, notes, optional alert).
- `lib/` — types + pure helpers (lane/burn sums, money formatting, glow
  intensity vs. the leash goal).
- `hooks/useDialModes.ts` — per-lane **Full / Slow / Pause** dial state,
  persisted to `localStorage`. **UI-only in v0** — see the stub comment next
  to `dialAffectsBurn` in `lib/meters.ts` for where a future control-plane
  `setMode(suit, mode)` call would plug in to actually pause/throttle a
  lane's live integrations.
- `hooks/useTabView.ts` — whether The Tab is shown as the compact chip or
  the full expanded card, persisted to `localStorage`. Defaults to the chip.
- `components/` — `TabWidget` (switches between chip/card), `TabChip` (the
  default collapsed pill), `TabCard` (the full expanded screen), `BigBurn`
  (big number + glow halo), `AlertsStrip`, `SuitLane` (one of the four
  suits), `DialControl`, `BottomSheet` (tap a suit to see its individual
  meters).

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
