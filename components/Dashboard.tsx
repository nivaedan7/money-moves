"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, Transaction, Budget, AnnualCommitment } from "@/lib/supabaseClient";

const BEHAVIOURAL = ["Groceries", "Eating Out", "Tolls", "Home Utilities"];

const money = (n: number) =>
  (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-AU", { month: "long", year: "numeric" });
};

async function fetchAllTransactions(): Promise<Transaction[]> {
  const all: Transaction[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id,date,description,amount,category,source,is_annual_commitment,balance,confidence,notes,raw_description")
      .order("date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as Transaction[]));
    if (data.length < pageSize) break;
  }
  return all.map((t) => ({ ...t, amount: Number(t.amount) }));
}

export default function Dashboard() {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Record<string, number>>({});
  const [commitments, setCommitments] = useState<AnnualCommitment[]>([]);
  const [month, setMonth] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [tx, b, c] = await Promise.all([
          fetchAllTransactions(),
          supabase.from("budgets").select("category,monthly_amount"),
          supabase.from("annual_commitments").select("*").order("due_date", { ascending: true }),
        ]);
        if (b.error) throw b.error;
        if (c.error) throw c.error;
        setTxns(tx);
        const bm: Record<string, number> = {};
        (b.data as Budget[]).forEach((x) => (bm[x.category] = Number(x.monthly_amount)));
        setBudgets(bm);
        setCommitments((c.data as AnnualCommitment[]) || []);
        const months = Array.from(new Set(tx.map((t) => t.date.slice(0, 7)))).sort();
        setMonth(months[months.length - 1] || "");
      } catch (e: any) {
        setErr(e?.message || "Failed to load data");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const months = useMemo(
    () => Array.from(new Set(txns.map((t) => t.date.slice(0, 7)))).sort().reverse(),
    [txns]
  );

  const monthTxns = useMemo(() => txns.filter((t) => t.date.slice(0, 7) === month), [txns, month]);

  const byCategory = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of monthTxns) {
      if (t.category === "Ignore") continue;
      m[t.category] = (m[t.category] || 0) + t.amount;
    }
    return m; // signed: negative = net spend, positive = net inflow
  }, [monthTxns]);

  const income = useMemo(
    () => monthTxns.filter((t) => t.category === "Income").reduce((s, t) => s + t.amount, 0),
    [monthTxns]
  );
  const spend = useMemo(
    () =>
      -monthTxns
        .filter((t) => t.category !== "Income" && t.category !== "Ignore")
        .reduce((s, t) => s + t.amount, 0),
    [monthTxns]
  );
  const net = income - spend;
  const savings = income > 0 ? Math.round((net / income) * 100) : null;

  const spendForCat = (cat: string) => Math.max(0, -(byCategory[cat] || 0));

  const nextDue = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return [...commitments]
      .filter((c) => c.due_date && c.due_date >= today)
      .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))[0];
  }, [commitments]);

  if (loading) return <div className="wrap"><div className="loading">Loading your money moves…</div></div>;
  if (err)
    return (
      <div className="wrap">
        <div className="err">Couldn’t load data: {err}<br />Check NEXT_PUBLIC_SUPABASE_URL / ANON_KEY in .env.local.</div>
      </div>
    );

  const otherCats = Object.keys(byCategory)
    .filter((c) => !BEHAVIOURAL.includes(c) && c !== "Income")
    .sort((a, b) => byCategory[a] - byCategory[b]);

  return (
    <div className="wrap">
      <div className="header">
        <div className="logo">$<span>MM</span> Money Moves</div>
      </div>
      <p className="sub">Household finance for Nivae &amp; Diya — low-friction monthly review.</p>

      <div className="controls">
        <label htmlFor="m" style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>Month</label>
        <select id="m" value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => (
            <option key={m} value={m}>{monthLabel(m)}</option>
          ))}
        </select>
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{monthTxns.length} transactions</span>
      </div>

      {/* Stat cards */}
      <div className="grid stats">
        <div className="card stat"><div className="label">Net position</div><div className={"value " + (net >= 0 ? "pos" : "neg")}>{money(net)}</div></div>
        <div className="card stat"><div className="label">Total income</div><div className="value pos">{money(income)}</div></div>
        <div className="card stat"><div className="label">Total spend</div><div className="value">{money(spend)}</div></div>
        <div className="card stat"><div className="label">Savings rate</div><div className="value">{savings === null ? "—" : savings + "%"}</div></div>
      </div>

      {/* Behavioural strip */}
      <div className="section-title">Behavioural categories</div>
      <div className="grid beh">
        {BEHAVIOURAL.map((cat) => {
          const s = spendForCat(cat);
          const budget = budgets[cat] || 0;
          const pct = budget > 0 ? Math.min(100, Math.round((s / budget) * 100)) : 0;
          const over = budget > 0 && s > budget;
          return (
            <div className="card" key={cat}>
              <div className="cat">{cat}</div>
              <div className="amt">{money(s)}</div>
              <div className="vs">{budget > 0 ? `of ${money(budget)} budget` : "no budget set"}</div>
              <div className="bar"><i style={{ width: pct + "%", background: over ? "var(--coral)" : "var(--green)" }} /></div>
              {budget > 0 && <span className={"badge " + (over ? "over" : "ok")}>{over ? `↑ ${money(s - budget)} over` : "✓ on track"}</span>}
            </div>
          );
        })}
      </div>

      {/* All categories */}
      <div className="section-title">All categories — {monthLabel(month || "")}</div>
      <div className="card" style={{ padding: 6 }}>
        <table>
          <thead><tr><th>Category</th><th className="num">Budget</th><th className="num">Spend</th></tr></thead>
          <tbody>
            {otherCats.map((c) => {
              const s = Math.max(0, -(byCategory[c] || 0));
              const inflow = byCategory[c] > 0 ? byCategory[c] : 0;
              return (
                <tr key={c}>
                  <td>{c}</td>
                  <td className="num">{budgets[c] ? money(budgets[c]) : "—"}</td>
                  <td className="num">{inflow > 0 ? <span className="pos">+{money(inflow)}</span> : money(s)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Annual commitments */}
      <div className="section-title">Annual commitments</div>
      {nextDue && (
        <div className="card next-due" style={{ marginBottom: 12 }}>
          <div className="meta" style={{ color: "var(--navy)", fontWeight: 700 }}>NEXT DUE</div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            <span className="nm">{nextDue.name}</span>
            <span style={{ fontWeight: 800 }}>{money(Number(nextDue.amount))}</span>
          </div>
          <div className="meta">{nextDue.due_date} · {nextDue.frequency}</div>
        </div>
      )}
      <div className="card">
        {commitments.map((c) => (
          <div className="commit" key={c.id}>
            <div>
              <div className="nm">{c.name}</div>
              <div className="meta">{c.category} · {c.frequency}{c.due_date ? ` · next ${c.due_date}` : ""}</div>
            </div>
            <div style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{money(Number(c.amount))}</div>
          </div>
        ))}
      </div>

      <div className="foot">
        Reading live from Supabase (project <code>money-moves</code>). Spend is net of refunds; internal transfers, card
        payments and reversed/failed debits are excluded as “Ignore”. Tolls &amp; Home Utilities may read low if those
        bills sit on accounts not yet imported. Single-user prototype — add Supabase Auth before deploying.
      </div>
    </div>
  );
}
