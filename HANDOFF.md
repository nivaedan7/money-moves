# MoneyMoves — Engineering Handoff

Everything a fresh Claude Code session (or any developer) needs to take over this project. Last updated June 2026 by the Cowork build session.

---

## 1. What this is

MoneyMoves ($MM) is a household finance app for Nivae and Diya (daughter Meera). It replaces a complex Google Sheet with a low-friction monthly workflow: import bank statements → auto-categorise → review exceptions → see where the money goes. Design philosophy (the original `MoneyMoves_Handoff.docx` is the source of truth for product intent): **behavioural focus** — only four categories genuinely change behaviour (Groceries, Eating Out, Tolls, Home Utilities); everything else is tracked for completeness. Tone for Nivae: direct, systems-oriented, long-game, no hedging.

**Name:** the user is **Nivae** (legal: Nivaedan Anandaganeshan). Not "Naveen" — that was an error in an old doc.

---

## 2. Stack & accounts

| Piece | Detail |
|---|---|
| Framework | Next.js 14.2.35 (App Router) + TypeScript, React 18 |
| Styling | Plain CSS (`app/globals.css`), no Tailwind build step. "Golden Hour" palette (navy/gold/coral/sand/peach/green) |
| DB | Supabase, project ref **`weoaakhlcllcjfzupjsj`** ("money-moves"), region ap-southeast-2, Postgres 17 |
| Auth | Supabase Auth (email/password), single user |
| Hosting | Vercel — **pending** (repo created, not yet deployed) |
| Repo | GitHub `nivaedan7/money-moves` (push not yet completed at time of writing) |
| Automation | Cowork scheduled task (monthly report) — see §9 |
| Notion | Workspace page "money moves." id `361b872d-d37a-814e-b72f-f9e9f0f5da2a` |
| Local path | `~/moneymoves` |

---

## 3. Repo structure

```
moneymoves/
  app/
    layout.tsx           # wraps everything in <AuthGate>; nav lives in AuthGate
    page.tsx             # Dashboard route (/)
    globals.css          # all styling + palette CSS variables
    salary/page.tsx      # /salary
    outlook/page.tsx     # /outlook
    networth/page.tsx    # /networth
    import/page.tsx      # /import
    review/page.tsx      # /review
  components/
    AuthGate.tsx         # session gate + nav + sign out (client)
    Login.tsx            # email/password sign-in + sign-up
    Dashboard.tsx        # monthly view, 4 behavioural cats, category table
    SalaryTracker.tsx    # fortnightly Verve income + run-rate forecast
    Outlook.tsx          # net-worth trajectory, cashflow trend, goals
    NetWorth.tsx         # assets/debts/Meera fund from latest snapshot
    ImportStatement.tsx  # CSV upload -> categorise -> dedupe -> save
    ReviewQueue.tsx      # flagged txns: recategorise + "save as rule"
  lib/
    supabaseClient.ts    # supabase client + TS types (URL/key fallback baked in)
    categories.ts        # the 21 category strings (20 official + NEEDS_REVIEW)
    rules.ts             # static rule engine + categoriseWith(dbRules,...)
    csv.ts               # CBA/ING CSV parser + format auto-detect
  .env.local             # NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY (gitignored)
  HANDOFF.md             # this file
  README.md
  CLAUDE.md
```

Data flow: client components query Supabase directly via the publishable key (RLS-gated). No server components fetch data yet; no API routes. Aggregation (monthly totals, savings rate, projections) happens client-side.

---

## 4. Run & deploy

```bash
cd ~/moneymoves
npm install
npm run dev        # http://localhost:3000
npm run build      # production build (use to verify before deploy)
```

**Deploy (pending):** push to `github.com/nivaedan7/money-moves`, then import on vercel.com → Deploy. No env vars required on Vercel — `lib/supabaseClient.ts` falls back to the public URL + publishable key if env vars are absent. Every push then auto-deploys.

**First login:** Supabase → Authentication → Users → Add user (tick Auto Confirm), or sign up in-app.

---

## 5. Config & secrets

- **Public, already in code** (`lib/supabaseClient.ts` + `.env.local`): Supabase URL `https://weoaakhlcllcjfzupjsj.supabase.co` and the **publishable** key `sb_publishable_lfKI1pU8RKJSVOxRo3hv0g_CDON3CSX`. Safe to ship — protected by RLS + auth.
- **NOT in the repo** (needed for admin tasks): a Supabase **access token** or DB password for running migrations from Claude Code. Get it from Supabase dashboard (Account → Access Tokens) and use the Supabase CLI (`supabase link --project-ref weoaakhlcllcjfzupjsj`) or the Supabase MCP. The service-role key must never go in client code.
- **Anthropic API key**: only needed if you move AI categorisation or the monthly report in-house (currently neither — see §9).

---

## 6. Supabase schema

All tables have RLS ON. Policy pattern: `SELECT` to `authenticated` on every table; `INSERT` to `authenticated` on `transactions`, `import_batches`, `goals`, `merchant_rules`; `UPDATE` to `authenticated` on `transactions`, `merchant_rules`, `goals`.

- **transactions** — `id uuid pk`, `date`, `description`, `raw_description`, `amount numeric` (**signed: negative = money out, positive = in**), `balance`, `category`, `confidence numeric`, `source` (check: `cba|ing|bom`), `import_id fk→import_batches`, `is_annual_commitment bool`, `notes`, `dedup_key`, `created_at`.
  - **Trigger** `trg_dedup` (fn `set_dedup_key`): sets `dedup_key = md5(source|date|amount|description|balance)` on insert if null.
  - **Partial unique index** `uq_tx_dedup` on `dedup_key WHERE balance IS NOT NULL` — blocks re-importing the same CSV row, but allows legacy null-balance repeats.
- **import_batches** — `id`, `source`, `filename`, `transaction_count`, `date_range_start/end`, `created_at`. Transactions link via `import_id`.
- **budgets** — `category` (unique), `monthly_amount`, `updated_at`.
- **annual_commitments** — `name`, `category`, `amount`, `due_date`, `frequency` (check: `annual|quarterly|biannual`), `notes`, `is_paid`, `paid_date`.
- **net_worth_snapshots** — `snapshot_date`, `assets jsonb`, `debts jsonb`, `meera_fund jsonb` (each a `[{name,value}]` array; debts negative).
- **bank_accounts** — `display_name` (unique), `bank_source`, `current_balance`, `balance_date`.
- **merchant_rules** — `pattern` (regex source, applied case-insensitive), `category`, `confidence`, `rule_name`, `priority int` (lower = first), `active bool`. **The categorisation feedback loop**: the Review Queue inserts here; the Import screen reads here first.
- **goals** — `name`, `kind`, `target_amount`, `current_amount`, `target_date`, `notes`, `sort`.

---

## 7. Data state (as of this handoff)

- **transactions: 2,245** — `cba` 1,139 (Oct 2025–May 2026), `ing` 917 (Jan 2025–May 2026), `bom` 189 (May 2023–May 2026).
- This is two lineages: (a) **the Cowork import** — 7 CBA credit-card statements + 2 ING Orange Everyday PDFs (1,011 rows), reconciled to the cent; (b) **Nivae's earlier app imports** — the main ING account, a BOM file, and an earlier CBA CSV.
- import_batches 12 · budgets 32 · annual_commitments 9 · net_worth_snapshots 2 · bank_accounts 5 · merchant_rules 21 · goals 2.
- **⚠ Category taxonomy inconsistency (known debt):** the earlier import used labels like `Income / payment received`, `Rent / mortgage`, `Eating out`; the Cowork import used the canonical `Income`, `Rent / Mortgage`, `Eating Out`. The Dashboard treats these as separate categories for older months. A normalisation migration (map legacy → canonical) is the recommended first cleanup. The official 21 labels are in `lib/categories.ts`.

---

## 8. Categorisation

Order: **DB merchant_rules (by priority asc) → static rules in `lib/rules.ts` → `NEEDS_REVIEW`**. Ignore-first (internal transfers, card payments, reversed/failed debits, intl fees), then Income, then merchant categories. `categoriseWith(dbRules, desc, amount, source)` is the entry point used by the Import screen; `categorise(...)` is the static fallback. Confidence: high ≥0.9, med ≥0.7, low <0.8 flags for review. Anything <0.8 or `NEEDS_REVIEW` shows up in `/review`.

**CSV parsing (`lib/csv.ts`):** ING detected by a header containing `Credit,Debit`; CBA by a leading date with no header. ING `amount = credit>0 ? +credit : -debit`; CBA amount is already signed. Dates normalised to `YYYY-MM-DD`.

**Salary detection (`SalaryTracker.tsx`):** positive credits where description matches `verve` (excluding "Verve Family Doctors"). Diya = description contains `diya`; Nivae = contains `nivaedan` or `nverve`. Predicted annual = avg per fortnight × 26; tax set-aside estimated at 40% (Nivae's own budget-sheet assumption, not a marginal calc).

---

## 9. Monthly automation (currently a Cowork scheduled task)

A scheduled task (`moneymoves-monthly-report`, cron `0 7 4 * *`, Melbourne local) runs on the 4th of each month and: reads Supabase → writes a board-style `Monthly_Report_YYYY_MM.md` to the *Money Moves* folder → posts a summary subpage under the Notion "money moves." page → emits `Rule_Improvements_YYYY_MM.md` (advisory, for the Review Queue) → pings Nivae with net position + #1 action + review-queue count. The task prompt lives at `~/Claude/Scheduled/moneymoves-monthly-report/SKILL.md`.

**Important for a Claude Code move:** this automation lives in **Cowork**, not the app/repo. It will keep running independently. If you want it self-hosted (GitHub Action or Supabase cron), you'd re-home it and supply an Anthropic API key — it's the one piece that uses an LLM at runtime. The deterministic pipeline (import, rules, dedupe, dashboards) is entirely in the app and needs no AI.

---

## 10. Known issues & tech debt (priority order)

1. **Category normalisation** — merge legacy labels into the canonical 21 (see §7). Highest leverage; affects historical Dashboard accuracy.
2. **Vercel deploy** not yet done; GitHub push pending (auth/token step).
3. **Net-worth is one real snapshot** (May 2025) + a stale-flagged baseline. Outlook projection assumes savings rate held flat, no market growth. Add dated snapshots over time.
4. **Meera goal current value is static** — could be wired to pull live from the latest net_worth_snapshot `meera_fund`.
5. **PDF statements** aren't parsed in-app (CSV-first by design). The Cowork session parsed PDFs with Python; the app only ingests CSV. Plan: export CSV from NetBank/ING.
6. **Single-user auth, permissive RLS** (`USING (true)` for the authenticated role). Fine for one household; tighten if multi-user.
7. **Mounted-FS git locks** — the initial `.git` was created in a sandbox over a mounted FS and left orphaned `.git/*.lock` files; the clean fix is `rm -rf .git && git init` on the Mac (in the deploy steps).

---

## 11. Roadmap (the "Financial Operating System" vision)

- **Phase 0 (done):** schema, rule engine, Dashboard, Net Worth, Import, Auth, data loaded.
- **Phase 1 (done):** dedupe, DB-backed merchant_rules, Review Queue, Salary tracker, Outlook.
- **Phase 2 (done):** monthly executive report + Notion + rule improvements (Cowork scheduled task).
- **Phase 3 (in progress):** GitHub + Vercel deploy for anywhere-access.
- **Phase 4 (optional):** bank-feed aggregator (e.g. Basiq / Up API) to remove the manual statement upload — cost + security tradeoff. Then category normalisation, live Meera goal, multi-snapshot net-worth history.
- Full spec: see `MoneyMoves_Automation_Plan.md` in the *Money Moves* folder.

---

## 12. Context for an AI assistant

- The original product handoff (`MoneyMoves_Handoff.docx`) defines intent; this file defines the current build. The analysis artifacts (statement inventory, behaviour dashboard, spending analysis, data-quality audit, rule suggestions, automation plan) live in the user's *Money Moves* folder, not the repo.
- Work style Nivae wants: direct, specific, intellectually equal, no cheerleading, surface tradeoffs honestly. Help him find what's missing rather than dictating. Prioritise by commercial/personal leverage.
- Needs his approval before: anything touching external accounts, credentials, money movement, publishing, or irreversible actions.
- The database is the asset; the app is the interface; the monthly report is the decision tool. Append-only — never destroy historical data.
- Verify before asserting: when changing the DB, prefer additive migrations and reconcile sums/counts against source statements.
