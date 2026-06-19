# Money Moves ($MM)

Household finance dashboard — Next.js (App Router) + Supabase. Reads live data from the `money-moves` Supabase project: the four behavioural categories vs budget, a monthly category breakdown, and annual commitments with a "next due" card.

## Run it locally

```bash
cd ~/moneymoves
npm install        # first time only
npm run dev
```

Then open http://localhost:3000

## First-time login (one step)

The app is now behind **Supabase Auth** — you'll see a login screen. Create your single account once, either way:

- **In the app:** click "Sign up", enter email + password. If email confirmation is on, you'll be prompted to confirm.
- **Easiest (no email):** Supabase dashboard → Authentication → Users → **Add user** → tick **Auto Confirm User**. Then sign in.

After that, the Dashboard, Net Worth and Import screens all unlock.

## Screens

- **Dashboard** (`/`) — monthly view, four behavioural categories vs budget, category table.
- **Net Worth** (`/networth`) — assets, debts, Meera's fund from the latest snapshot.
- **Import** (`/import`) — upload a CBA or ING CSV; auto-detected and categorised by the rule engine; review flagged rows, edit categories, then save to Supabase.

## Configuration

`.env.local` is already filled in with the project URL and publishable (anon) key:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

The app reads via the publishable key, but only after login. Row Level Security is ON: `SELECT` is granted to the **authenticated** role on `transactions`, `budgets`, `annual_commitments`, `net_worth_snapshots`, `bank_accounts`, `import_batches`; `INSERT` to authenticated on `transactions` and `import_batches` (for the Import screen). Nothing is readable without a session.

## Data model (Supabase)

- `transactions` — signed `amount` (negative = money out), `category`, `source` (cba/ing/bom), `is_annual_commitment`, `confidence`, `notes`.
- `budgets` — `category`, `monthly_amount`.
- `annual_commitments` — `name`, `category`, `amount`, `due_date`, `frequency`.

## Notes / next steps

- Spend is net of refunds; `Ignore` rows (internal transfers, card payments, reversed/failed debits) are excluded.
- Tolls & Home Utilities can read low if those bills sit on accounts not yet imported.
- Single-user prototype — add **Supabase Auth** and tighten RLS before deploying (Vercel).
- Not yet built: the Import screen, Net Worth view, and write-back. Dashboard is read-only.
