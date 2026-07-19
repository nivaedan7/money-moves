# MoneyMoves — Engineering Handoff

Everything a fresh Claude Code session (or any developer) needs to take over this project.

**Last updated:** July 2026, after the Steps 1–12 rebuild (commit `b1a8fa9`).
**Local path:** `~/moneymoves` · **Live:** https://money-moves-three.vercel.app · **Repo:** `github.com/nivaedan7/money-moves`

---

## 1. What this is

MoneyMoves ($MM) is a household finance app for Nivae and Diya (daughter Meera, DOB 22 Nov 2022). It replaces a complex Google Sheet with a low-friction monthly workflow: **import bank statements → auto-categorise → review exceptions → see where the money goes**.

Design philosophy — **behavioural focus**: only four categories genuinely change behaviour (Groceries, Eating Out, Tolls, Home Utilities). Everything else is tracked for completeness but deliberately de-emphasised in the UI. Fixed/structural costs (mortgage, insurance, childcare) are collapsed by default because you can't spend your way out of them month to month.

**Name:** the user is **Nivae** (legal: Nivaedan Anandaganeshan). Not "Naveen" — that was an error in an old doc.

**Tone Nivae wants:** direct, specific, intellectually equal, no cheerleading, surface tradeoffs honestly. He is time-poor. Lead with the answer, not the preamble.

---

## 2. Stack & accounts

| Piece | Detail |
|---|---|
| Framework | Next.js 14.2.35 (App Router) + TypeScript 5.5.4, React 18.3.1 |
| Styling | Plain CSS (`app/globals.css`), no Tailwind. "Golden Hour" palette |
| DB | Supabase, project ref **`weoaakhlcllcjfzupjsj`** ("money-moves"), ap-southeast-2, Postgres 17 |
| Auth | Supabase Auth (email/password), single user |
| Hosting | **Vercel — live**, auto-deploys on push to `main` |
| Repo | GitHub `nivaedan7/money-moves` |
| Deps | Only `@supabase/supabase-js` 2.45.4 — no chart library, no UI kit, no date library |
| Notion | Workspace page "money moves." id `361b872d-d37a-814e-b72f-f9e9f0f5da2a` |

**No chart library by design.** Every chart in the app is hand-rolled inline SVG. If you add a chart, follow the existing pattern (see §6) rather than pulling in Recharts — the bundle stays tiny and the styling stays consistent.

---

## 3. Repo structure

```
moneymoves/
  app/
    layout.tsx            # wraps everything in <AuthGate>
    globals.css           # all styling + palette CSS variables
    page.tsx              # /          Dashboard
    salary/page.tsx       # /salary
    outlook/page.tsx      # /outlook
    networth/page.tsx     # /networth
    meera/page.tsx        # /meera     Meera's Fund
    bills/page.tsx        # /bills     Bills & Commitments
    import/page.tsx       # /import
    review/page.tsx       # /review
    settings/page.tsx     # /settings  budgets + CSV export
  components/             # one client component per screen
    AuthGate.tsx     (44)   session gate + nav + sign out
    Login.tsx        (49)   email/password sign-in + sign-up
    Dashboard.tsx   (651)   monthly view — the main screen
    MeeraFund.tsx   (508)   fund projection by target age
    Outlook.tsx     (505)   assets-only forward projection
    BillsAndCommitments.tsx (393)
    NetWorth.tsx    (391)   assets/debts/super/Meera from snapshots
    SalaryTracker.tsx (376) fortnightly income + ATO tax estimate
    Settings.tsx    (240)   budgets CRUD + CSV export
    ReviewQueue.tsx (231)   flagged txns: recategorise, rules, one-off flag
    ImportStatement.tsx (214)
  lib/
    supabaseClient.ts (47)  client + TS types (URL/key fallback baked in)
    netWorthSnapshot.ts(99) auto-snapshot writer — see §7
    rules.ts          (80)  static rule engine + categoriseWith()
    csv.ts            (77)  CBA/ING CSV parser + format auto-detect
    categories.ts     (25)  the 21 category strings
  .env.local              # gitignored
  CLAUDE.md               # short repo guide for Claude Code
  HANDOFF.md              # this file
```

**Data flow:** client components query Supabase directly via the publishable key (RLS-gated). No server components fetch data, no API routes. All aggregation (monthly totals, savings rate, growth rates, projections) happens client-side in `useMemo` blocks.

---

## 4. Run & deploy

```bash
cd ~/moneymoves
npm install
npm run dev          # http://localhost:3000
npm run build        # production build
npx tsc --noEmit     # type-check — run this before every commit
```

**Deploy:** push to `main` → Vercel auto-deploys. No env vars needed on Vercel; `lib/supabaseClient.ts` falls back to the public URL + publishable key when env vars are absent.

**Pushing:** the git CLI fails on this machine with *"Device not configured"* (credential helper can't prompt in a non-TTY). **Use GitHub Desktop to push.** Committing from the CLI works fine — it's only the push that needs Desktop.

> **Auth note (July 2026):** the classic PAT `money-moves` is near expiry. Recommended fix is to switch the remote to SSH (`git remote set-url origin git@github.com:nivaedan7/money-moves.git`) so tokens stop expiring. Not yet done.

---

## 5. Config & secrets

- **Public, already in code** (`lib/supabaseClient.ts` + `.env.local`): Supabase URL `https://weoaakhlcllcjfzupjsj.supabase.co` and the **publishable** key `sb_publishable_lfKI1pU8RKJSVOxRo3hv0g_CDON3CSX`. Safe to ship — protected by RLS + auth.
- **NOT in the repo:** Supabase access token / DB password for migrations. Use the Supabase MCP (preferred — it's already wired up) or the CLI (`supabase link --project-ref weoaakhlcllcjfzupjsj`). **The service-role key must never appear in client code.**
- **Meera's DOB** is stored in browser `localStorage` under key `meera_dob`, with `2022-11-22` hardcoded as the default in `MeeraFund.tsx`. Not in the DB — re-entered per browser.

---

## 6. Conventions you must follow

These are load-bearing. Breaking them causes silent wrong numbers, not crashes.

**Amount sign.** Signed: **negative = money out**, positive = in. When displaying spend, flip it (`-amount`) and treat it as positive.

**Spend exclusions.** Categories `Ignore` (internal transfers, card payments, reversed/failed debits, intl fees) and `Income` are **always excluded from spend totals**. Every aggregation must filter both.

**Currency formatting.** `money()` is defined per-component (there is no shared helper — see §11 tech debt). All variants use `toLocaleString("en-AU")` and the **Unicode minus `−` (U+2212)**, not the ASCII hyphen. Match the local convention when editing a component.

**Golden Hour palette** — CSS variables in `globals.css`. Never hardcode hex:
`--navy` (primary text/structure) · `--gold` (accent, primary series) · `--coral` (negative/alert/budget lines) · `--green` (positive) · `--sand` `--peach` (backgrounds) · `--card` `--ink` `--muted` `--line`

**Charts are inline SVG.** The established pattern: compute a viewBox, map values to coordinates, render `<path>`/`<rect>`/`<circle>`, add range toggle buttons (3M/6M/1Y/2Y/All) driven by component state. See `Dashboard.tsx` `SpendChart`, `NetWorth.tsx` `NWChart`, `Outlook.tsx` `ProjectionChart`, `MeeraFund.tsx` `FundChart`.

**Empty states are named components.** When data is insufficient, render a dedicated placeholder rather than a broken chart: `BuildingHistory` (NetWorth, <3 points), `NeedMoreData` (Outlook, <2 snapshots), `DobGate` (MeeraFund). Follow this pattern for new projections.

**Append-only database.** Never destroy historical data. Prefer additive migrations. Reconcile sums/counts against source statements after any bulk change.

---

## 7. Supabase schema

All tables have RLS ON. Policy pattern: `SELECT` to `authenticated` on every table; `INSERT`/`UPDATE` to `authenticated` on the tables the app writes to.

- **transactions** — `id uuid pk`, `date`, `description`, `raw_description`, `amount numeric` (**signed**), `balance`, `category`, `confidence numeric`, `source` (check: `cba|ing|bom`), `import_id fk`, `is_annual_commitment bool`, **`is_one_off bool`**, `notes`, `dedup_key`, `created_at`.
  - **Trigger** `trg_dedup` (fn `set_dedup_key`): sets `dedup_key = md5(source|date|amount|description|balance)` on insert if null.
  - **Partial unique index** `uq_tx_dedup` on `dedup_key WHERE balance IS NOT NULL` — blocks re-importing the same CSV row, allows legacy null-balance repeats.
- **import_batches** — `id`, `source`, `filename`, `transaction_count`, `date_range_start/end`, `created_at`.
- **budgets** — `category` (unique), `monthly_amount`, `updated_at`. Drives the Dashboard budget column + dashed coral lines on spend charts.
- **annual_commitments** — `name`, `category`, `amount`, `due_date`, `frequency` (check: `annual|quarterly|biannual`), `notes`, `is_paid`, `paid_date`.
- **net_worth_snapshots** — `snapshot_date`, `assets jsonb`, `debts jsonb`, `meera_fund jsonb`. Each is a `[{name, value}]` array; **debts stored negative**.
- **bank_accounts** — `display_name` (unique), `bank_source`, `current_balance`, `balance_date`.
- **merchant_rules** — `pattern` (regex source, case-insensitive), `category`, `confidence`, `rule_name`, `priority int` (lower = first), `active bool`. **This is the categorisation feedback loop**: Review Queue writes here, Import reads here first.
- **goals** — `name`, `kind`, `target_amount`, `current_amount`, `target_date`, `notes`, `sort`.

### The snapshot mechanism (`lib/netWorthSnapshot.ts`)

`writeMonthlySnapshot({ source?, closingBalance? })` is the single entry point. It is called from two places: **ImportStatement** after a successful save, and **ReviewQueue** when the last pending item is resolved (guarded by a `useRef` so it fires once per session).

Behaviour:
1. Query for an existing snapshot in the current calendar month (`YYYY-MM-01` … `YYYY-MM-31`).
2. Deep-copy all values forward from the **most recent** snapshot — this is the key design decision. Most balances (CommSec, HELP, mortgage) can't be derived from a statement import, so they carry forward until manually edited.
3. Optionally patch the one account the import can speak to, via balance heuristics:
   - **ING**: `closingBalance > $50k` → main Everyday; `< $10k` → Goal Saver / small account by name match.
   - **BOM**: updates the Meera Fund line.
   - **CBA**: skipped (credit card, balance isn't an asset).
4. If a snapshot exists this month → `UPDATE` by id. Otherwise → `INSERT` dated today.

**Month idempotency is application-level, not a DB constraint** — deliberately, because a unique index would conflict with the existing manually-dated historical snapshots.

---

## 8. Data state (July 2026)

| Table | Rows |
|---|---|
| transactions | **2,247** |
| merchant_rules | 49 |
| budgets | 18 |
| import_batches | 13 |
| annual_commitments | 9 |
| net_worth_snapshots | 4 |
| bank_accounts | 5 |
| goals | 2 |

**By source:** `cba` 1,139 (Oct 2025 – May 2026) · `ing` 919 (Jan 2025 – Jun 2026) · `bom` 189 (May 2023 – May 2026).

**Review queue: 259 transactions** currently flagged (`NEEDS_REVIEW` or confidence < 0.8). 80 are hard `NEEDS_REVIEW`; the rest are low-confidence. This is the biggest outstanding data chore.

**One-offs flagged: 0.** The `is_one_off` mechanism is built and wired end-to-end but Nivae hasn't tagged anything yet, so the Dashboard callout band is hidden. This is expected, not a bug.

**✅ Category taxonomy is now clean.** All 2,247 rows use the canonical 21 labels from `lib/categories.ts`. The legacy/canonical split (`Eating out` vs `Eating Out`) documented in earlier handoffs has been **resolved** — do not re-fix it.

### Snapshot data — read this before touching charts

| Date | Assets | Debts | Meera |
|---|---|---|---|
| 2025-05-31 | $487,342 | −$1,126,526 | $45,527 |
| 2026-05-23 | **$0** | **$0** | **$0** | ← zero template |
| 2026-06-22 | $496,391 | −$1,126,526 | $55,592 |
| 2026-07-03 | $494,424 | −$1,126,526 | $55,592 |

**The 2026-05-23 row is an all-zero template.** Every snapshot-consuming page filters it out with `sum(abs(values)) > 0`. If you write a new page that reads snapshots, **you must replicate this filter** or your growth rate will be garbage.

Also note the **13-month gap** between the 2025 snapshot and the 2026 ones. Growth-rate maths uses trailing intervals, so with only 2 usable recent points the projections are labelled "Early estimate" in the UI. This resolves naturally as monthly snapshots accumulate.

---

## 9. Categorisation & parsing

**Order:** DB `merchant_rules` (priority asc) → static rules in `lib/rules.ts` → `NEEDS_REVIEW`. Ignore-rules fire first, then Income, then merchant categories.

`categoriseWith(dbRules, desc, amount, source)` is the entry point used by Import. `categorise(...)` is the static-only fallback.

**Confidence:** high ≥ 0.9, med ≥ 0.7. Anything **< 0.8 or `NEEDS_REVIEW`** surfaces in `/review`. Manually setting a category in Review sets confidence to 1.

**CSV parsing (`lib/csv.ts`):** ING detected by a header containing `Credit,Debit`; CBA by a leading date with no header row. ING `amount = credit > 0 ? +credit : -debit`; CBA amounts already signed. Dates normalised to `YYYY-MM-DD`.

**Salary detection (`SalaryTracker.tsx`):** positive credits matching `verve`, excluding "Verve Family Doctors". Diya = description contains `diya`; Nivae = contains `nivaedan` or `nverve`.

---

## 10. The maths (so you don't have to reverse-engineer it)

**ATO 2024-25 tax estimate** (`SalaryTracker.tsx`, `calcTax`): marginal brackets 0/19/32.5/37/45% + LITO (max $700, phasing out 5c/$1 from $37,500→$45,000 then 1.5c/$1 →$66,667) + 2% Medicare levy above $26,000. Returns `{ incomeTax, lito, medicare, total }`. This is an estimate, labelled as such in the UI — not tax advice, no HELP repayment component, no offsets beyond LITO.

**Net worth definition** (`NetWorth.tsx`): `NW = core assets − core debts`, where:
- **Super is excluded** from the total and shown separately at 75% opacity (`isSuper()` matches `/super|futuresuper|retirement/i`). Rationale: it's inaccessible for decades, so including it flatters the number and hides the real position.
- **Family loans are excluded** from debts (`isFamilyLoan()` matches `/rethemama|nammah|appah|mama|family/i`), shown at 65% opacity. Rationale: informal, no fixed schedule.
- Debts that count: mortgage + two HELP debts.

**Growth rate from snapshots** (`Outlook.tsx`, `MeeraFund.tsx`): per interval, `r = (a2/a1)^(30/days) − 1`, averaged over the trailing 3 intervals. Monthly rate.

**Forward projection with contributions** (`MeeraFund.tsx`): `F(n) = F₀(1+r)ⁿ + C·[(1+r)ⁿ − 1] / r`.

**Implied contribution decomposition** (`MeeraFund.tsx`): the snapshot delta is split into organic growth and contributions via `C = (f1 − f0 − f0·((1+r)^months − 1)) / months`. The same observed `r` is used for both the decomposition and the forward projection — internally consistent, but note it means a single anomalous snapshot skews both.

**Outlook is assets-only.** There is deliberately no debt paydown model — mortgage amortisation was judged not worth the complexity for the decision the page supports.

---

## 11. Known issues & tech debt (priority order)

1. **259 transactions in the review queue.** Mostly low-confidence rather than uncategorised. Working through these and saving merchant rules as you go is the highest-leverage data task — it compounds, since each rule prevents future flags.
2. **`money()` is duplicated across 8 components** with three different variants (2dp signed, 2dp unsigned, 0dp). Should be one `lib/format.ts` exporting `money`, `moneyRound`, `moneySigned`. Low risk, touches many files.
3. **Snapshot account-matching is heuristic.** The ING `>$50k` / `<$10k` balance thresholds in `netWorthSnapshot.ts` are brittle — they'll misfire if the Everyday account is drawn down below $50k. A proper fix is an `account_id` on import batches, or matching against `bank_accounts.display_name`.
4. **Meera's DOB lives in localStorage**, so it's re-entered per browser and lost on clearing site data. Should move to a settings table or a `households` row.
5. **PDF statements aren't parsed in-app** (CSV-first by design). Export CSV from NetBank/ING.
6. **Single-user auth, permissive RLS** (`USING (true)` for the authenticated role). Fine for one household; tighten before any second user.
7. **Only 3 usable snapshots**, one of them 13 months stale. Outlook and MeeraFund projections stay in "early estimate" mode until ~3 consecutive monthly snapshots accumulate. Nothing to fix — just import monthly.
8. **PAT expiry** — switch the git remote to SSH (see §4).
9. **No tests.** There is no test framework in the repo at all. `npx tsc --noEmit` is the only automated check. The maths in §10 is the obvious first candidate if you add one.

---

## 12. What was built in the Steps 1–12 rebuild (commit `b1a8fa9`)

Context for why the code looks the way it does:

1. Dashboard category table — Monthly Spend / Last Month / 12-Mo Avg / Budget / Trend, with expandable inline spend-history charts
2. Sorted non-behavioural categories by 12-month average descending; fixed/structural categories collapsed into a group at the bottom
3. Removed the annual-commitments panel and the Net Position stat card from the Dashboard (now 3 cards: Income, Spend, Savings Rate)
4. Added `is_one_off` column + Review Queue toggle + Dashboard callout band
5. Rebuilt Salary around the fortnightly table with a real ATO marginal calculation (replaced a flat 40% assumption)
6. Reworked Net Worth — super excluded, family loans excluded, SVG line chart
7. Auto-snapshot on import completion and review-queue drain
8. *(merged into Step 4)*
9. Rebuilt Outlook — assets-only projection from snapshot growth
10. New Meera's Fund page at `/meera`
11. Confirmed Bills page fully covers annual commitments — no change needed
12. Global polish — Unicode minus, grammar, footer copy, capitalisation

**Roadmap from here.** Phases 0–3 are done (schema, rule engine, all screens, deploy). Phase 4 candidates, in Nivae's likely priority order: work down the review queue → accumulate monthly snapshots → bank-feed aggregator (Basiq / Up API) to remove manual CSV upload, which is the single biggest friction reduction left but carries cost + security tradeoffs worth discussing before building.

---

## 13. Working with Nivae

- **Approval required before:** anything touching external accounts, credentials, money movement, publishing/deploying, or irreversible actions.
- He is a GP who builds apps on the side; time-poor. Don't pad. Lead with the answer.
- He will tell you the plan in numbered steps and expects them executed in order without re-litigation. If a step is already done, say so and move on rather than redoing it.
- Surface tradeoffs honestly, including when you think the ask is wrong. Help him find what's missing rather than only executing.
- **The database is the asset; the app is the interface.** When in doubt, protect the data.
