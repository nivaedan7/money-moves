"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Txn = { date: string; amount: number; category: string };
type Goal = { id: string; name: string; target_amount: number; current_amount: number; target_date: string | null; notes: string | null; sort: number };

const money = (n: number) => (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-AU", { maximumFractionDigits: 0 });
const monthName = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleDateString("en-AU", { month: "short", year: "2-digit" }); };
const isIgnore = (c: string) => /^ignore/i.test(c);
const isIncome = (c: string) => /^income/i.test(c);

async function fetchAllTxns(): Promise<Txn[]> {
  const all: Txn[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("transactions").select("date,amount,category").order("date", { ascending: true }).range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as any[]).map((r) => ({ date: r.date, amount: Number(r.amount), category: r.category })));
    if (data.length < 1000) break;
  }
  return all;
}

export default function Outlook() {
  const [txns, setTxns] = useState<Txn[]>([]);
  const [nw, setNw] = useState<number | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", target: "", current: "", date: "" });

  async function loadGoals() {
    const { data } = await supabase.from("goals").select("*").order("sort", { ascending: true });
    setGoals((data as Goal[]) || []);
  }

  useEffect(() => {
    (async () => {
      try {
        const [tx, snap] = await Promise.all([
          fetchAllTxns(),
          supabase.from("net_worth_snapshots").select("assets,debts").order("snapshot_date", { ascending: false }).limit(1),
        ]);
        setTxns(tx);
        const s = (snap.data && snap.data[0]) as any;
        if (s) {
          const sum = (arr: any[]) => (arr || []).reduce((a: number, x: any) => a + Number(x.value), 0);
          setNw(sum(s.assets) + sum(s.debts));
        }
        await loadGoals();
      } catch (e: any) {
        setErr(e?.message || "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const monthly = useMemo(() => {
    const m: Record<string, { income: number; spend: number }> = {};
    for (const t of txns) {
      if (isIgnore(t.category)) continue;
      const k = t.date.slice(0, 7);
      m[k] = m[k] || { income: 0, spend: 0 };
      if (isIncome(t.category)) m[k].income += t.amount;
      else m[k].spend += -t.amount; // amounts negative -> spend positive
    }
    return Object.entries(m)
      .map(([k, v]) => ({ month: k, income: v.income, spend: v.spend, net: v.income - v.spend, rate: v.income > 0 ? (v.income - v.spend) / v.income : null }))
      .sort((a, b) => (a.month < b.month ? -1 : 1));
  }, [txns]);

  const recent = monthly.slice(-9);
  // monthly savings estimate from months that actually have income recorded
  const incomeMonths = monthly.filter((m) => m.income > 1000).slice(-6);
  const avgNet = incomeMonths.length ? incomeMonths.reduce((s, m) => s + m.net, 0) / incomeMonths.length : 0;

  if (loading) return <div className="wrap"><div className="loading">Loading outlook…</div></div>;
  if (err) return <div className="wrap"><div className="err">{err}</div></div>;

  const maxAbs = Math.max(1, ...recent.map((m) => Math.abs(m.net)));
  const W = 620, H = 150, pad = 24, bw = recent.length ? (W - pad * 2) / recent.length : 0;
  const zeroY = H / 2;

  async function addGoal(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.target) return;
    await supabase.from("goals").insert({
      name: form.name, target_amount: Number(form.target), current_amount: Number(form.current || 0),
      target_date: form.date || null, sort: 100,
    });
    setForm({ name: "", target: "", current: "", date: "" });
    loadGoals();
  }

  return (
    <div className="wrap">
      <div className="header"><div className="logo">Out<span>look</span></div></div>
      <p className="sub">Where the household is heading — cashflow trend, net-worth trajectory, and goals.</p>

      {/* Net worth trajectory */}
      <div className="section-title">Net worth trajectory</div>
      <div className="grid stats">
        <div className="card stat"><div className="label">Net worth (latest)</div><div className={"value " + ((nw ?? 0) >= 0 ? "pos" : "neg")}>{nw === null ? "—" : money(nw)}</div></div>
        <div className="card stat"><div className="label">Est. monthly saving</div><div className={"value " + (avgNet >= 0 ? "pos" : "neg")}>{money(Math.round(avgNet))}</div></div>
        <div className="card stat"><div className="label">Projected +12 mo</div><div className="value">{nw === null ? "—" : money(Math.round(nw + avgNet * 12))}</div></div>
        <div className="card stat"><div className="label">Projected +24 mo</div><div className="value">{nw === null ? "—" : money(Math.round(nw + avgNet * 24))}</div></div>
      </div>
      <p className="sub" style={{ marginTop: 8 }}>Projection = latest net worth + estimated monthly saving held flat. Excludes market growth and asset revaluation. Add fresh net-worth snapshots to sharpen the trajectory.</p>

      {/* Cashflow / savings trend */}
      <div className="section-title">Savings &amp; cashflow — last {recent.length} months</div>
      <div className="card">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block" }}>
          <line x1={pad} y1={zeroY} x2={W - pad} y2={zeroY} stroke="var(--line)" />
          {recent.map((m, i) => {
            const h = (Math.abs(m.net) / maxAbs) * (H / 2 - 12);
            const x = pad + i * bw + bw * 0.15;
            const w = bw * 0.7;
            const y = m.net >= 0 ? zeroY - h : zeroY;
            return (
              <g key={m.month}>
                <rect x={x} y={y} width={w} height={h} rx={3} fill={m.net >= 0 ? "var(--green)" : "var(--coral)"} />
                <text x={x + w / 2} y={H - 6} fontSize="9" textAnchor="middle" fill="var(--muted)">{monthName(m.month)}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="card" style={{ padding: 6, marginTop: 12 }}>
        <table>
          <thead><tr><th>Month</th><th className="num">Income</th><th className="num">Spend</th><th className="num">Net</th><th className="num">Savings rate</th></tr></thead>
          <tbody>
            {recent.slice().reverse().map((m) => (
              <tr key={m.month}>
                <td>{monthName(m.month)}</td>
                <td className="num pos">{m.income ? money(m.income) : "—"}</td>
                <td className="num">{money(m.spend)}</td>
                <td className={"num " + (m.net >= 0 ? "pos" : "neg")}>{money(m.net)}</td>
                <td className="num">{m.rate === null ? "—" : Math.round(m.rate * 100) + "%"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="sub" style={{ marginTop: 8 }}>Months without salary credits show “—” for income (statements for that account/month not imported yet). Income = salary + other inflows; spend excludes internal transfers &amp; card payments.</p>

      {/* Goals */}
      <div className="section-title">Goals</div>
      <div className="card">
        {goals.length === 0 && <div style={{ color: "var(--muted)", fontSize: 14 }}>No goals yet — add one below.</div>}
        {goals.map((g) => {
          const pct = g.target_amount > 0 ? Math.min(100, Math.round((Number(g.current_amount) / Number(g.target_amount)) * 100)) : 0;
          return (
            <div key={g.id} style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="nm" style={{ fontWeight: 700 }}>{g.name}</span>
                <span style={{ fontSize: 13 }}>{money(Number(g.current_amount))} / {money(Number(g.target_amount))} ({pct}%){g.target_date ? ` · by ${g.target_date}` : ""}</span>
              </div>
              <div className="bar" style={{ marginTop: 8 }}><i style={{ width: pct + "%", background: "var(--gold)" }} /></div>
              {g.notes && <div className="vs" style={{ marginTop: 4 }}>{g.notes}</div>}
            </div>
          );
        })}
      </div>
      <form className="card" onSubmit={addGoal} style={{ marginTop: 12, display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", gap: 8, alignItems: "center" }}>
        <input className="inp" placeholder="Goal name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="inp" type="number" placeholder="Target $" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} />
        <input className="inp" type="number" placeholder="Current $" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} />
        <input className="inp" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <button className="btn" type="submit">Add</button>
      </form>

      <div className="foot">
        Net-worth projection is intentionally simple (savings rate held flat) — a planning compass, not a forecast. Update goal
        current amounts as balances change, or I can wire Meera’s-fund progress to pull live from the net-worth snapshot.
      </div>
    </div>
  );
}
