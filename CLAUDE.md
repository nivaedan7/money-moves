# CLAUDE.md

Guidance for Claude Code working in this repo. **Read `HANDOFF.md` first — it is the full engineering handoff (schema, data state, the maths, tech debt, roadmap).**

## Project

**MoneyMoves ($MM)** — household finance app for Nivae & Diya (daughter Meera). Next.js 14 (App Router) + TypeScript + Supabase. Low-friction monthly workflow: import statements → auto-categorise → review → see spend. Behavioural focus: four categories matter most (Groceries, Eating Out, Tolls, Home Utilities); fixed costs are collapsed by default.

Live at https://money-moves-three.vercel.app — pushes to `main` auto-deploy.

The user is **Nivae** (not "Naveen"). Communicate directly, no hedging, surface tradeoffs. He's time-poor — lead with the answer.

## Commands

```bash
npm run dev        # dev server at http://localhost:3000
npm run build      # production build
npm run lint
npx tsc --noEmit   # type-check — run before every commit; it's the only automated check
```

**Pushing:** the git CLI fails here with "Device not configured". Commit from the CLI, then **push via GitHub Desktop**.

## Architecture

App Router. Client components query Supabase directly via the publishable key (RLS-gated); aggregation is client-side in `useMemo`. No API routes, no server fetches.

- `app/` — routes: `/` (Dashboard), `/salary`, `/outlook`, `/networth`, `/meera`, `/bills`, `/import`, `/review`, `/settings`. `layout.tsx` wraps all in `components/AuthGate.tsx` (auth gate + nav).
- `components/` — one client component per screen.
- `lib/` — `supabaseClient.ts` (client + types), `categories.ts` (the 21 labels), `rules.ts` (rule engine + `categoriseWith`), `csv.ts` (CBA/ING parser), `netWorthSnapshot.ts` (auto-snapshot writer).

**Only dependency is `@supabase/supabase-js`.** No chart library — every chart is hand-rolled inline SVG. Follow the existing pattern (`SpendChart`, `NWChart`, `ProjectionChart`, `FundChart`) rather than adding one.

## Supabase

Project ref **`weoaakhlcllcjfzupjsj`**. Tables: `transactions` (signed `amount`, `is_one_off`, `dedup_key` trigger + partial unique index), `import_batches`, `budgets`, `annual_commitments`, `net_worth_snapshots` (jsonb), `bank_accounts`, `merchant_rules` (DB-backed, read before static), `goals`. RLS ON — `SELECT`/`INSERT`/`UPDATE` for the `authenticated` role. Use the Supabase MCP for migrations; never put the service-role key in client code.

## Conventions

- Amounts are signed: **negative = money out**, positive = in. Categories `Ignore` and `Income` are **always excluded from spend** — every aggregation must filter both.
- Currency: `toLocaleString("en-AU")` with the **Unicode minus `−` (U+2212)**, not a hyphen. `money()` is currently defined per-component — match the local variant.
- Colours: use the Golden Hour CSS variables (`--navy`, `--gold`, `--coral`, `--green`, `--sand`, `--peach`, `--card`, `--ink`, `--muted`, `--line`). Never hardcode hex.
- Categorisation order: DB `merchant_rules` (priority asc) → static `lib/rules.ts` → `NEEDS_REVIEW`. Ignore rules fire first.
- **Snapshot filtering:** one `net_worth_snapshots` row (2026-05-23) is an all-zero template. Any page reading snapshots must filter it with `sum(abs(values)) > 0` or growth maths breaks.
- Database is append-only — never destroy historical data; prefer additive migrations and reconcile against source statements.
- Insufficient-data states get a named placeholder component (`BuildingHistory`, `NeedMoreData`, `DobGate`), not a broken chart.

## Current state

Category taxonomy is **clean** — all 2,247 rows use the canonical 21 labels. Do not re-fix the legacy-label issue described in older docs; it's resolved.

Top outstanding chore: **110 transactions in the review queue** (down from 171 after a July 2026 backlog pass; the rest are local merchants only Nivae recognises). The Review Queue UI groups flagged rows by merchant with bulk "Apply to N" + "Save rule & apply" actions. Biggest code debt: `money()` duplicated across 8 components.

## Needs the user's approval

External accounts, credentials, money movement, publishing/deploying, anything irreversible.
