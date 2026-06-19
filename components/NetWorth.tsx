"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Line = { name: string; value: number };
type Snapshot = { snapshot_date: string; assets: Line[]; debts: Line[]; meera_fund: Line[] };

const money = (n: number) =>
  (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-AU", { maximumFractionDigits: 0 });

export default function NetWorth() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from("net_worth_snapshots")
          .select("snapshot_date,assets,debts,meera_fund")
          .order("snapshot_date", { ascending: false })
          .limit(1);
        if (error) throw error;
        setSnap((data && data[0]) as Snapshot);
      } catch (e: any) {
        setErr(e?.message || "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="wrap"><div className="loading">Loading net worth…</div></div>;
  if (err) return <div className="wrap"><div className="err">Couldn’t load: {err}</div></div>;
  if (!snap) return <div className="wrap"><div className="loading">No net-worth snapshot yet.</div></div>;

  const sum = (arr: Line[]) => (arr || []).reduce((s, x) => s + Number(x.value), 0);
  const assets = sum(snap.assets);
  const debts = sum(snap.debts); // negative
  const meera = sum(snap.meera_fund);
  const netWorth = assets + debts;

  const ageDays = Math.round((Date.now() - new Date(snap.snapshot_date).getTime()) / 86400000);

  return (
    <div className="wrap">
      <div className="header"><div className="logo">Net <span>Worth</span></div></div>
      <p className="sub">Snapshot as at {snap.snapshot_date}.</p>

      {ageDays > 60 && (
        <div className="card stale" style={{ marginBottom: 18 }}>
          ⚠ This snapshot is {ageDays} days old. Send current balances and I’ll add a fresh snapshot so this reflects today.
        </div>
      )}

      <div className="grid stats">
        <div className="card stat"><div className="label">Net worth</div><div className={"value " + (netWorth >= 0 ? "pos" : "neg")}>{money(netWorth)}</div></div>
        <div className="card stat"><div className="label">Total assets</div><div className="value pos">{money(assets)}</div></div>
        <div className="card stat"><div className="label">Total debts</div><div className="value neg">{money(debts)}</div></div>
        <div className="card stat"><div className="label">Meera’s fund</div><div className="value">{money(meera)}</div></div>
      </div>

      <div className="section-title">Assets</div>
      <div className="card"><table><tbody>
        {snap.assets.map((a) => (
          <tr key={a.name}><td>{a.name}</td><td className="num pos">{money(Number(a.value))}</td></tr>
        ))}
        <tr><td style={{ fontWeight: 700 }}>Total</td><td className="num" style={{ fontWeight: 800 }}>{money(assets)}</td></tr>
      </tbody></table></div>

      <div className="section-title">Debts</div>
      <div className="card"><table><tbody>
        {snap.debts.map((d) => (
          <tr key={d.name}><td>{d.name}</td><td className="num neg">{money(Number(d.value))}</td></tr>
        ))}
        <tr><td style={{ fontWeight: 700 }}>Total</td><td className="num neg" style={{ fontWeight: 800 }}>{money(debts)}</td></tr>
      </tbody></table></div>
      <p className="sub" style={{ marginTop: 8 }}>The Rethemama and NAmmah + Appah loans are family loans, not institutional debt.</p>

      <div className="section-title">Meera’s fund</div>
      <div className="card"><table><tbody>
        {snap.meera_fund.map((m) => (
          <tr key={m.name}><td>{m.name}</td><td className="num">{money(Number(m.value))}</td></tr>
        ))}
        <tr><td style={{ fontWeight: 700 }}>Total</td><td className="num" style={{ fontWeight: 800 }}>{money(meera)}</td></tr>
      </tbody></table></div>

      <div className="foot">
        Net worth = assets − debts (Meera’s fund tracked separately, as in the $MM design). Reading live from Supabase
        <code> net_worth_snapshots</code>. Add a new dated snapshot to track growth over time.
      </div>
    </div>
  );
}
