# CLAUDE.md

Guidance for Claude Code working in this repo. **Read `HANDOFF.md` first — it is the full engineering handoff (schema, data state, automation, tech debt, roadmap).**

## Project

**MoneyMoves ($MM)** — household finance app for Nivae & Diya. Next.js 14 (App Router) + TypeScript + Supabase. Low-friction monthly workflow: import statements → auto-categorise → review → see spend. Behavioural focus: four categories matter most (Groceries, Eating Out, Tolls, Home Utilities).

The user is **Nivae** (not "Naveen"). Communicate directly, no hedging, surface tradeoffs.

## Commands

```bash
npm run dev        # dev server at http://localhost:3000
npm run build      # production build (run before deploy)
npm run lint
npx tsc --noEmit   # type-check
```

## Architecture

App Router. Client components query Supabase directly via the publishable key (RLS-gated); aggregation is client-side. No API routes / server fetches yet.

- `app/` — routes: `/` (Dashboard), `/salary`, `/outlook`, `/networth`, `/import`, `/review`. `layout.tsx` wraps all in `components/AuthGate.tsx` (auth gate + nav).
- `components/` — one client component per screen.
- `lib/` — `supabaseClient.ts` (client + types, public URL/key fallback baked in), `categories.ts` (the 21 labels), `rules.ts` (rule engine + `categoriseWith`), `csv.ts` (CBA/ING parser).

## Supabase

Project ref **`weoaakhlcllcjfzupjsj`**. Tables: `transactions` (signed `amount`, `dedup_key` trigger + partial unique index), `import_batches`, `budgets`, `annual_commitments`, `net_worth_snapshots` (jsonb), `bank_accounts`, `merchant_rules` (DB-backed rules, read before static), `goals`. RLS ON — `SELECT`/`INSERT`/`UPDATE` for the `authenticated` role. For migrations use the Supabase CLI (`supabase link --project-ref weoaakhlcllcjfzupjsj`) or MCP; never put the service-role key in client code.

## Conventions

- Amounts are signed: **negative = money out**, positive = in. Category `Ignore` (internal transfers, card payments, reversed/failed debits, intl fees) and `Income` are excluded from spend.
- Categorisation order: DB `merchant_rules` (priority asc) → static `lib/rules.ts` → `NEEDS_REVIEW`. Ignore rules fire first.
- Database is append-only — never destroy historical data; prefer additive migrations and reconcile against source statements.
- Known debt: legacy category labels (`Eating out`) differ from canonical (`Eating Out`) — see HANDOFF.md §7/§10.

## Needs the user's approval

External accounts, credentials, money movement, publishing/deploying, anything irreversible.
