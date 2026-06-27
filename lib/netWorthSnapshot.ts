import { supabase } from "./supabaseClient";

// Snapshot writer — call after import or review completion.
//
// Idempotency: one snapshot per calendar month. If a snapshot already exists
// in the current month, it is overwritten. If not, a new one is inserted dated
// to today.
//
// Values: carry forward from the most recent snapshot. If `closingBalance` is
// provided and the source is "ing", the best-matching ING asset line is updated
// (main account heuristic: balance > $50k). CBA is a transaction account, not
// tracked as an asset, so its balance is ignored. BOM updates the Meera fund.

type Line = { name: string; value: number; note?: string };
type Snapshot = {
  id?: string;
  snapshot_date: string;
  assets: Line[];
  debts: Line[];
  meera_fund: Line[];
};

export type SnapshotResult =
  | { written: false; reason: string }
  | { written: true; isUpdate: boolean; snapshot_date: string };

export async function writeMonthlySnapshot(opts?: {
  source?: "cba" | "ing" | "bom";
  closingBalance?: number | null;
}): Promise<SnapshotResult> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const monthStart = today.slice(0, 7) + "-01";        // YYYY-MM-01
  const monthEnd   = today.slice(0, 7) + "-31";        // YYYY-MM-31 (safe upper bound)

  // 1. Check for existing snapshot this month
  const { data: existing, error: existErr } = await supabase
    .from("net_worth_snapshots")
    .select("id,snapshot_date,assets,debts,meera_fund")
    .gte("snapshot_date", monthStart)
    .lte("snapshot_date", monthEnd)
    .order("snapshot_date", { ascending: false })
    .limit(1);
  if (existErr) return { written: false, reason: existErr.message };

  const existingSnap = existing?.[0] as Snapshot | undefined;

  // 2. Fetch the most recent snapshot to use as the value base
  const { data: latestData, error: latestErr } = await supabase
    .from("net_worth_snapshots")
    .select("snapshot_date,assets,debts,meera_fund")
    .order("snapshot_date", { ascending: false })
    .limit(1);
  if (latestErr) return { written: false, reason: latestErr.message };

  const base = (latestData?.[0] as Snapshot | undefined) ?? existingSnap;
  if (!base) return { written: false, reason: "No existing snapshot to carry forward — add one manually first." };

  // 3. Deep copy the base values
  let assets: Line[]    = JSON.parse(JSON.stringify(base.assets    || []));
  let debts: Line[]     = JSON.parse(JSON.stringify(base.debts     || []));
  let meera: Line[]     = JSON.parse(JSON.stringify(base.meera_fund || []));

  // 4. Apply closing-balance hint when available
  if (opts?.closingBalance != null && opts.closingBalance > 0) {
    const bal = opts.closingBalance;

    if (opts.source === "ing") {
      // Heuristic: >$50k → main ING everyday account; ≤$50k → try goal saver or small account
      const ingMain   = assets.find((a) => /everyday.*main|main.*everyday/i.test(a.name));
      const ingGoal   = assets.find((a) => /goal.?saver/i.test(a.name));
      const ingSmall  = assets.find((a) => /everyday.*small|small.*everyday/i.test(a.name));
      if (bal > 50_000 && ingMain)  { ingMain.value = bal; }
      else if (bal < 10_000 && ingGoal && Math.abs(ingGoal.value - bal) < 5000) { ingGoal.value = bal; }
      else if (bal < 10_000 && ingSmall) { ingSmall.value = bal; }
    }

    if (opts.source === "bom") {
      const bom = meera.find((m) => /bom/i.test(m.name));
      if (bom) bom.value = bal;
    }
    // CBA is the transaction account — not tracked as an asset; skip.
  }

  // 5. Write or update
  if (existingSnap?.id) {
    const { error } = await supabase
      .from("net_worth_snapshots")
      .update({ assets, debts, meera_fund: meera })
      .eq("id", existingSnap.id);
    if (error) return { written: false, reason: error.message };
    return { written: true, isUpdate: true, snapshot_date: existingSnap.snapshot_date };
  } else {
    const { error } = await supabase
      .from("net_worth_snapshots")
      .insert({ snapshot_date: today, assets, debts, meera_fund: meera });
    if (error) return { written: false, reason: error.message };
    return { written: true, isUpdate: false, snapshot_date: today };
  }
}
