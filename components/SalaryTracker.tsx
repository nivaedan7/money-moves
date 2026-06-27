"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// Salary credits: positive Verve transactions into ING.
// NVerve prefix (or "nivaedan" in older records) = Nivae.
// DVerve prefix (or "diya" in older records)     = Diya.
// "Verve Family Doctors" (CBA expense) is excluded by amount > 0 + name filter.

type Pay = { date: string; person: "Diya" | "Nivae"; amount: number; desc: string };

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-AU");
const money2 = (n: number) => "$" + n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const monthFull = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-AU", { month: "long", year: "numeric" });
};
const monthShort = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-AU", { month: "short" });
};
const fmtDate = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
};

function classify(desc: string): "Diya" | "Nivae" | null {
  const d = desc.toLowerCase();
  if (d.startsWith("dverve") || d.includes("diya")) return "Diya";
  if (d.startsWith("nverve") || d.includes("nivaedan") || d.includes("nverve")) return "Nivae";
  return null;
}

// ─── ATO 2024-25 resident individual tax + Medicare levy ──────────────────────
// Brackets: https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents

function calcTax(income: number): { incomeTax: number; lito: number; medicare: number; total: number } {
  // Marginal rates
  let tax = 0;
  if (income <= 18200) {
    tax = 0;
  } else if (income <= 45000) {
    tax = (income - 18200) * 0.19;
  } else if (income <= 120000) {
    tax = 5092 + (income - 45000) * 0.325;
  } else if (income <= 180000) {
    tax = 29467 + (income - 120000) * 0.37;
  } else {
    tax = 51667 + (income - 180000) * 0.45;
  }

  // LITO: max $700, phased out 5c/$1 from $37,500→$45,000, then 1.5c/$1 to $66,667
  let lito = 0;
  if (income <= 37500) {
    lito = 700;
  } else if (income <= 45000) {
    lito = 700 - (income - 37500) * 0.05;
  } else if (income <= 66667) {
    lito = 325 - (income - 45000) * 0.015;
  }
  const incomeTax = Math.max(0, tax - lito);

  // Medicare levy: 2% (shade-in applies below $26,000 — irrelevant at these income levels)
  const medicare = income >= 26000 ? income * 0.02 : 0;

  return { incomeTax, lito: Math.round(lito), medicare, total: incomeTax + medicare };
}

// ─── Colour helpers ───────────────────────────────────────────────────────────

function cellBg(amount: number, avg: number): string {
  if (amount === 0 || avg === 0) return "transparent";
  const ratio = amount / avg;
  if (ratio >= 1.5) return "#fff3cd"; // very high (bonus / double-up)
  if (ratio >= 1.08) return "#fffbe8"; // slightly above
  if (ratio <= 0.5) return "#fdf0ec"; // very low (partial)
  if (ratio <= 0.92) return "#fdf5f2"; // slightly below
  return "transparent";
}

// ─── Component ────────────────────────────────────────────────────────────────

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
        const rows: Pay[] = (data as any[])
          .filter((r) => !/family doctors/i.test(r.description || ""))
          .flatMap((r) => {
            const person = classify(r.description || "");
            if (!person) return [];
            return [{ date: r.date, amount: Number(r.amount), desc: r.description || "", person }];
          });
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

  const years = useMemo(
    () => Array.from(new Set(pays.map((p) => p.date.slice(0, 4)))).sort().reverse(),
    [pays]
  );
  const yearPays = useMemo(() => pays.filter((p) => p.date.slice(0, 4) === year), [pays, year]);

  // Per-person helpers
  const personPays = (who: Pay["person"]) => yearPays.filter((p) => p.person === who);
  const ytd = (who: Pay["person"]) => personPays(who).reduce((s, p) => s + p.amount, 0);
  const count = (who: Pay["person"]) => personPays(who).length;
  const avgPerPay = (who: Pay["person"]) => { const c = count(who); return c ? ytd(who) / c : 0; };

  // Run-rate: YTD average × 26 fortnights
  const predAnnual = (who: Pay["person"]) => { const c = count(who); return c ? (ytd(who) / c) * 26 : 0; };

  // Tax calculations
  const taxN = useMemo(() => calcTax(predAnnual("Nivae")), [yearPays]);
  const taxD = useMemo(() => calcTax(predAnnual("Diya")), [yearPays]);

  // ── Fortnight table ─────────────────────────────────────────────────────────
  // Group by date; multiple credits on same date for same person are summed.
  const fortnightRows = useMemo(() => {
    const byDate: Record<string, { Diya: number; Nivae: number }> = {};
    for (const p of yearPays) {
      byDate[p.date] = byDate[p.date] || { Diya: 0, Nivae: 0 };
      byDate[p.date][p.person] += p.amount;
    }
    return Object.entries(byDate).sort(([a], [b]) => (a < b ? 1 : -1)); // most recent first
  }, [yearPays]);

  const avgD = avgPerPay("Diya");
  const avgN = avgPerPay("Nivae");

  // ── Monthly summary ─────────────────────────────────────────────────────────
  const monthlyRows = useMemo(() => {
    const m: Record<string, { Diya: number; Nivae: number }> = {};
    for (const p of yearPays) {
      const k = p.date.slice(0, 7);
      m[k] = m[k] || { Diya: 0, Nivae: 0 };
      m[k][p.person] += p.amount;
    }
    return Object.entries(m).sort(([a], [b]) => (a < b ? 1 : -1)); // most recent first
  }, [yearPays]);

  if (loading) return <div className="wrap"><div className="loading">Loading salary…</div></div>;
  if (err) return <div className="wrap"><div className="err">{err}</div></div>;
  if (pays.length === 0) return (
    <div className="wrap">
      <div className="header"><div className="logo">Salary <span>Tracker</span></div></div>
      <div className="card">No Verve salary credits found. Import the ING account that receives salary and they'll appear here.</div>
    </div>
  );

  const totalYtd = ytd("Diya") + ytd("Nivae");
  const predTotal = predAnnual("Diya") + predAnnual("Nivae");
  const takeHome = predAnnual("Diya") - taxD.total + predAnnual("Nivae") - taxN.total;

  return (
    <div className="wrap">
      <div className="header"><div className="logo">Salary <span>Tracker</span></div></div>
      <p className="sub">Actual fortnightly Verve income into ING — run-rate forecast and ATO tax estimate.</p>

      <div className="controls">
        <label htmlFor="y" style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>Year</label>
        <select id="y" value={year} onChange={(e) => setYear(e.target.value)}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{yearPays.length} pays recorded</span>
      </div>

      {/* ── Metrics ─────────────────────────────────────────────────────────── */}
      <div className="section-title">Metrics — {year}</div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th className="num">Diya</th>
              <th className="num">Nivae</th>
              <th className="num">Combined</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ fontWeight: 600 }}>Year-to-date</td>
              <td className="num">{money(ytd("Diya"))}</td>
              <td className="num">{money(ytd("Nivae"))}</td>
              <td className="num" style={{ fontWeight: 700 }}>{money(totalYtd)}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>Pays recorded</td>
              <td className="num">{count("Diya")}</td>
              <td className="num">{count("Nivae")}</td>
              <td className="num" style={{ color: "var(--muted)" }}>{count("Diya") + count("Nivae")} total</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>Avg per fortnight</td>
              <td className="num">{money(avgD)}</td>
              <td className="num">{money(avgN)}</td>
              <td className="num" style={{ color: "var(--muted)" }}>{money(avgD + avgN)}</td>
            </tr>
            <tr style={{ background: "#fffbf2" }}>
              <td style={{ fontWeight: 700 }}>Predicted annual (×26)</td>
              <td className="num" style={{ fontWeight: 700 }}>{money(predAnnual("Diya"))}</td>
              <td className="num" style={{ fontWeight: 700 }}>{money(predAnnual("Nivae"))}</td>
              <td className="num" style={{ fontWeight: 800 }}>{money(predTotal)}</td>
            </tr>
            <tr style={{ background: "#f3faf5" }}>
              <td style={{ fontWeight: 700, color: "var(--green)" }}>Predicted take-home</td>
              <td className="num" style={{ fontWeight: 700, color: "var(--green)" }}>{money(predAnnual("Diya") - taxD.total)}</td>
              <td className="num" style={{ fontWeight: 700, color: "var(--green)" }}>{money(predAnnual("Nivae") - taxN.total)}</td>
              <td className="num" style={{ fontWeight: 800, color: "var(--green)" }}>{money(takeHome)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Tax estimate ─────────────────────────────────────────────────────── */}
      <div className="section-title">Tax estimate — {year} (ATO 2024-25 resident rates)</div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Component</th>
              <th className="num">Diya</th>
              <th className="num">Nivae</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Gross predicted annual</td>
              <td className="num">{money(predAnnual("Diya"))}</td>
              <td className="num">{money(predAnnual("Nivae"))}</td>
            </tr>
            <tr>
              <td>Marginal income tax</td>
              <td className="num" style={{ color: "var(--coral)" }}>{money(calcTax(predAnnual("Diya")).incomeTax + taxD.lito)}</td>
              <td className="num" style={{ color: "var(--coral)" }}>{money(calcTax(predAnnual("Nivae")).incomeTax + taxN.lito)}</td>
            </tr>
            {(taxD.lito > 0 || taxN.lito > 0) && (
              <tr style={{ color: "var(--muted)" }}>
                <td style={{ paddingLeft: 20 }}>Low income tax offset (LITO)</td>
                <td className="num" style={{ color: "var(--green)" }}>{taxD.lito > 0 ? `−${money(taxD.lito)}` : "—"}</td>
                <td className="num" style={{ color: "var(--green)" }}>{taxN.lito > 0 ? `−${money(taxN.lito)}` : "—"}</td>
              </tr>
            )}
            <tr>
              <td>Medicare levy (2%)</td>
              <td className="num" style={{ color: "var(--coral)" }}>{money(taxD.medicare)}</td>
              <td className="num" style={{ color: "var(--coral)" }}>{money(taxN.medicare)}</td>
            </tr>
            <tr style={{ background: "#fdf0ec" }}>
              <td style={{ fontWeight: 700 }}>Total estimated tax</td>
              <td className="num" style={{ fontWeight: 800, color: "var(--coral)" }}>{money(taxD.total)}</td>
              <td className="num" style={{ fontWeight: 800, color: "var(--coral)" }}>{money(taxN.total)}</td>
            </tr>
            <tr>
              <td style={{ color: "var(--muted)", fontSize: 12 }}>Effective rate</td>
              <td className="num" style={{ color: "var(--muted)", fontSize: 12 }}>
                {predAnnual("Diya") > 0 ? Math.round((taxD.total / predAnnual("Diya")) * 100) + "%" : "—"}
              </td>
              <td className="num" style={{ color: "var(--muted)", fontSize: 12 }}>
                {predAnnual("Nivae") > 0 ? Math.round((taxN.total / predAnnual("Nivae")) * 100) + "%" : "—"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="sub" style={{ marginTop: 6 }}>
        Marginal income tax + 2% Medicare levy + LITO only. Does not account for HECS/HELP repayments, salary
        packaging, or the Medicare Levy Surcharge. Check whether private health insurance covers both of you.
        Treat as a ballpark, not a tax return.
      </p>

      {/* ── Fortnight table ──────────────────────────────────────────────────── */}
      <div className="section-title">Fortnightly pays — {year}</div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Pay date</th>
              <th className="num">Diya</th>
              <th className="num">Nivae</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {fortnightRows.map(([date, v]) => {
              const total = v.Diya + v.Nivae;
              return (
                <tr key={date}>
                  <td style={{ whiteSpace: "nowrap", color: "var(--muted)", fontSize: 13 }}>{fmtDate(date)}</td>
                  <td
                    className="num"
                    style={{ background: cellBg(v.Diya, avgD), fontWeight: v.Diya > 0 ? 600 : 400 }}
                  >
                    {v.Diya > 0 ? money2(v.Diya) : <span style={{ color: "var(--line)" }}>—</span>}
                  </td>
                  <td
                    className="num"
                    style={{ background: cellBg(v.Nivae, avgN), fontWeight: v.Nivae > 0 ? 600 : 400 }}
                  >
                    {v.Nivae > 0 ? money2(v.Nivae) : <span style={{ color: "var(--line)" }}>—</span>}
                  </td>
                  <td className="num" style={{ fontWeight: 800 }}>{money2(total)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: "#fffbf2", borderTop: "2px solid var(--line)" }}>
              <td style={{ fontWeight: 700, fontSize: 13 }}>YTD total</td>
              <td className="num" style={{ fontWeight: 700 }}>{money(ytd("Diya"))}</td>
              <td className="num" style={{ fontWeight: 700 }}>{money(ytd("Nivae"))}</td>
              <td className="num" style={{ fontWeight: 800 }}>{money(totalYtd)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="sub" style={{ marginTop: 6 }}>
        Gold tint = above average for that earner · Warm tint = below average · Two entries on one date = same-day pays (e.g. adjustment).
      </p>

      {/* ── Monthly summary ──────────────────────────────────────────────────── */}
      <div className="section-title">Monthly summary — {year}</div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">Diya</th>
              <th className="num">Nivae</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {monthlyRows.map(([k, v]) => (
              <tr key={k}>
                <td>{monthShort(k)}</td>
                <td className="num">{v.Diya > 0 ? money(v.Diya) : <span style={{ color: "var(--line)" }}>—</span>}</td>
                <td className="num">{v.Nivae > 0 ? money(v.Nivae) : <span style={{ color: "var(--line)" }}>—</span>}</td>
                <td className="num" style={{ fontWeight: 700 }}>{money(v.Diya + v.Nivae)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="foot">
        Salary is identified from positive Verve credits into ING — descriptions beginning "NVerve" = Nivae,
        "DVerve" = Diya (legacy formats "NIVAEDAN" and "DIYA SOMAN" are also matched). Predicted annual = YTD average
        per fortnight × 26 pay periods. Tax estimate applies ATO 2024–25 resident marginal rates, the 2% Medicare levy,
        and the Low Income Tax Offset (LITO). No deductions, HECS/HELP repayments, or Medicare Levy Surcharge are
        modelled — treat the effective rate as a sanity check, not a tax return.
      </div>
    </div>
  );
}
