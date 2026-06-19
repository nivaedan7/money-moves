"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// Salary = positive Verve credits into ING. Diya: "DIYA SOMAN D Verve…"; Nivae: "NIVAEDAN … NVerve…".
// "Verve Family Doctors" (a CBA expense) is excluded by the amount>0 + name filter.
const TAX_RATE = 0.4; // Nivae's own set-aside assumption (matches the budget sheet ~40%)

type Pay = { date: string; person: "Diya" | "Nivae" | "Other"; amount: number; desc: string };

const money = (n: number) => "$" + n.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const money2 = (n: number) => "$" + n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthName = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleDateString("en-AU", { month: "short" }); };

function classify(desc: string): Pay["person"] {
  const d = desc.toLowerCase();
  if (d.includes("diya")) return "Diya";
  if (d.includes("nivaedan") || d.includes("nverve")) return "Nivae";
  return "Other";
}

export default function SalaryTracker() {
  const [pays, setPays] = useState<Pay[]>([]);
  const [year, setYear] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from("transactions")
          .select("date,description,amount")
          .gt("amount", 0)
          .ilike("description", "%verve%")
          .order("date", { ascending: true });
        if (error) throw error;
        const rows = (data as any[])
          .filter((r) => !/family doctors/i.test(r.description || ""))
          .map((r) => ({ date: r.date, amount: Number(r.amount), desc: r.description || "", person: classify(r.description || "") }))
          .filter((r) => r.person !== "Other");
        setPays(rows);
        const years = Array.from(new Set(rows.map((r) => r.date.slice(0, 4)))).sort();
        setYear(years[years.length - 1] || "");
      } catch (e: any) {
        setErr(e?.message || "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const years = useMemo(() => Array.from(new Set(pays.map((p) => p.date.slice(0, 4)))).sort().reverse(), [pays]);
  const yearPays = useMemo(() => pays.filter((p) => p.date.slice(0, 4) === year), [pays, year]);

  const ytd = (who: Pay["person"]) => yearPays.filter((p) => p.person === who).reduce((s, p) => s + p.amount, 0);
  const count = (who: Pay["person"]) => yearPays.filter((p) => p.person === who).length;
  const predAnnual = (who: Pay["person"]) => { const c = count(who); return c ? (ytd(who) / c) * 26 : 0; };

  const months = useMemo(() => {
    const m: Record<string, { Diya: number; Nivae: number }> = {};
    for (const p of yearPays) {
      const k = p.date.slice(0, 7);
      m[k] = m[k] || { Diya: 0, Nivae: 0 };
      if (p.person === "Diya") m[k].Diya += p.amount;
      if (p.person === "Nivae") m[k].Nivae += p.amount;
    }
    return Object.entries(m).sort(([a], [b]) => (a < b ? -1 : 1));
  }, [yearPays]);

  if (loading) return <div className="wrap"><div className="loading">Loading salary…</div></div>;
  if (err) return <div className="wrap"><div className="err">{err}</div></div>;
  if (pays.length === 0) return <div className="wrap"><div className="header"><div className="logo">Salary <span>Tracker</span></div></div><div className="card">No Verve salary credits found yet. Import the ING account that receives salary and they’ll appear here.</div></div>;

  const totalYtd = ytd("Diya") + ytd("Nivae");
  const predTotal = predAnnual("Diya") + predAnnual("Nivae");
  const estTax = predTotal * TAX_RATE;

  return (
    <div className="wrap">
      <div className="header"><div className="logo">Salary <span>Tracker</span></div></div>
      <p className="sub">Actual fortnightly Verve income into ING, with a run-rate forecast for the year.</p>

      <div className="controls">
        <label htmlFor="y" style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>Year</label>
        <select id="y" value={year} onChange={(e) => setYear(e.target.value)}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{yearPays.length} pays recorded</span>
      </div>

      <div className="grid stats">
        <div className="card stat"><div className="label">Income YTD</div><div className="value pos">{money(totalYtd)}</div></div>
        <div className="card stat"><div className="label">Predicted annual (run-rate)</div><div className="value">{money(predTotal)}</div></div>
        <div className="card stat"><div className="label">Est. tax set-aside (40%)</div><div className="value neg">{money(estTax)}</div></div>
        <div className="card stat"><div className="label">Est. take-home</div><div className="value">{money(predTotal - estTax)}</div></div>
      </div>

      <div className="section-title">By earner — {year}</div>
      <div className="grid beh" style={{ gridTemplateColumns: "repeat(2,1fr)" }}>
        {(["Diya", "Nivae"] as const).map((who) => (
          <div className="card" key={who}>
            <div className="cat">{who} · Verve</div>
            <div className="amt">{money(ytd(who))}</div>
            <div className="vs">YTD over {count(who)} pays · avg {money(count(who) ? ytd(who) / count(who) : 0)}/fortnight</div>
            <div className="vs" style={{ marginTop: 6 }}>Predicted annual: <b>{money(predAnnual(who))}</b></div>
          </div>
        ))}
      </div>

      <div className="section-title">Monthly — {year}</div>
      <div className="card" style={{ padding: 6 }}>
        <table>
          <thead><tr><th>Month</th><th className="num">Diya</th><th className="num">Nivae</th><th className="num">Total</th></tr></thead>
          <tbody>
            {months.map(([k, v]) => (
              <tr key={k}><td>{monthName(k)}</td><td className="num">{money(v.Diya)}</td><td className="num">{money(v.Nivae)}</td><td className="num" style={{ fontWeight: 700 }}>{money(v.Diya + v.Nivae)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title">Recent pays</div>
      <div className="card" style={{ padding: 6 }}>
        <table>
          <thead><tr><th>Date</th><th>Earner</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {[...yearPays].reverse().slice(0, 14).map((p, i) => (
              <tr key={i}><td>{p.date}</td><td>{p.person}</td><td className="num pos">{money2(p.amount)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="foot">
        Salary is detected from positive Verve credits into ING (Diya = “DIYA SOMAN … Verve”, Nivae = “NIVAEDAN … NVerve”).
        Predicted annual = average per fortnight × 26. Tax set-aside is an estimate at {Math.round(TAX_RATE * 100)}% (your budget-sheet assumption) — not a marginal-rate calculation.
      </div>
    </div>
  );
}
