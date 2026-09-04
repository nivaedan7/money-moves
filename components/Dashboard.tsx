"use client";

import { useEffect, useMemo, useState } from "react";
import MonthStatus from "./MonthStatus";
import { supabase, Transaction, Budget } from "@/lib/supabaseClient";

const BEHAVIOURAL = ["Groceries", "Eating Out", "Shopping"];

// Categories where spending more is structurally neutral (fixed costs, not habits)
const FIXED_CATS = new Set([
  "Rent / Mortgage", "Home Utilities", "Insurance", "Giving",
  "Investment Property Costs", "Work Expenses", "Meera Childcare", "Subscriptions",
]);

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const money = (n: number) =>
  (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-AU", { month: "long", year: "numeric" });
};

const shortMonthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return MONTH_NAMES[m - 1] + " " + String(y).slice(2);
};

function prevMonthKey(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, "0")}`;
}

function trailingMonthKeys(endYm: string, n: number): string[] {
  const months: string[] = [];
  let [y, m] = endYm.split("-").map(Number);
  for (let i = 0; i < n; i++) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m--;
    if (m === 0) { m = 12; y--; }
  }
  return months.reverse();
}

async function fetchAllTransactions(): Promise<Transaction[]> {
  const all: Transaction[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id,date,description,amount,category,source,is_annual_commitment,is_one_off,balance,confidence,notes,raw_description")
      .order("date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as Transaction[]));
    if (data.length < pageSize) break;
  }
  return all.map((t) => ({ ...t, amount: Number(t.amount) }));
}

// ─── Inline spend chart ───────────────────────────────────────────────────────

type ChartBar = { month: string; spend: number };

function SpendChart({ data, budget }: { data: ChartBar[]; budget: number }) {
  const W = 620, H = 130;
  const PAD = { left: 52, right: 16, top: 16, bottom: 26 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const maxVal = Math.max(1, ...data.map((d) => d.spend), budget);
  const bw = data.length > 0 ? chartW / data.length : 0;

  const budgetY = budget > 0 ? PAD.top + chartH - (budget / maxVal) * chartH : null;

  // Y-axis ticks
  const tickVals = [0, maxVal * 0.5, maxVal].map(Math.round);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block" }}>
      {/* Y-axis ticks */}
      {tickVals.map((v) => {
        const ty = PAD.top + chartH - (v / maxVal) * chartH;
        return (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={ty} y2={ty} stroke="var(--line)" strokeWidth={1} />
            <text x={PAD.left - 4} y={ty + 4} fontSize={9} textAnchor="end" fill="var(--muted)">
              {v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`}
            </text>
          </g>
        );
      })}

      {/* Budget reference line */}
      {budgetY !== null && (
        <>
          <line x1={PAD.left} x2={W - PAD.right} y1={budgetY} y2={budgetY}
            stroke="var(--coral)" strokeDasharray="4 3" strokeWidth={1.5} />
          <text x={W - PAD.right - 2} y={budgetY - 4} fontSize={9} textAnchor="end" fill="var(--coral)" fontWeight={600}>
            budget
          </text>
        </>
      )}

      {/* Bars */}
      {data.map((d, i) => {
        const barH = Math.max(2, (d.spend / maxVal) * chartH);
        const x = PAD.left + i * bw + bw * 0.12;
        const w = bw * 0.76;
        const over = budget > 0 && d.spend > budget;
        return (
          <g key={d.month}>
            <rect
              x={x} y={PAD.top + chartH - barH}
              width={w} height={barH}
              rx={3}
              fill={over ? "var(--coral)" : "var(--gold)"}
              opacity={0.85}
            />
            <text x={x + w / 2} y={H - 4} fontSize={9} textAnchor="middle" fill="var(--muted)">
              {shortMonthLabel(d.month)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── One-offs callout band ────────────────────────────────────────────────────

function OneOffsBand({
  txns,
  spend,
  income,
  avg12,
}: {
  txns: Transaction[];
  spend: number;
  income: number;
  avg12: Record<string, number>;
}) {
  const oneOffs = txns.filter((t) => t.is_one_off && t.category !== "Ignore");
  if (oneOffs.length === 0) return null;

  const spendOneOffs = oneOffs.filter((t) => t.amount < 0).sort((a, b) => a.amount - b.amount);
  const incomeOneOffs = oneOffs.filter((t) => t.amount > 0).sort((a, b) => b.amount - a.amount);

  const oneOffSpendTotal = spendOneOffs.reduce((s, t) => s + Math.abs(t.amount), 0);
  const oneOffIncomeTotal = incomeOneOffs.reduce((s, t) => s + t.amount, 0);

  // Normal spend = this month's spend minus the one-offs
  const normalSpend = spend - oneOffSpendTotal;
  // Rough "expected" spend from avg12 across all non-Income/Ignore categories
  const expectedSpend = Object.values(avg12).reduce((s, v) => s + v, 0);
  const spendAboveTrend = expectedSpend > 0 && normalSpend > expectedSpend * 1.05;
  const spendBelowTrend = expectedSpend > 0 && normalSpend < expectedSpend * 0.95;

  // Normal income = this month minus one-off income
  const normalIncome = income - oneOffIncomeTotal;
  const avgIncome = avg12["Income"] ?? 0;
  const incomeAboveTrend = avgIncome > 0 && normalIncome > avgIncome * 1.05;

  return (
    <div style={{
      background: "linear-gradient(135deg, #fff8ec 0%, #fff3de 100%)",
      border: "1.5px solid var(--gold)",
      borderRadius: 12,
      padding: "14px 18px",
      marginBottom: 20,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 16 }}>★</span>
        <span style={{ fontWeight: 800, fontSize: 13.5, color: "var(--navy)", textTransform: "uppercase", letterSpacing: ".5px" }}>
          Large one-offs this month
        </span>
      </div>

      {spendOneOffs.length > 0 && (
        <div style={{ marginBottom: incomeOneOffs.length > 0 ? 12 : 0 }}>
          {spendOneOffs.map((t) => (
            <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
              <span style={{ fontSize: 13.5, color: "var(--ink)" }}>
                <span style={{ color: "var(--gold)", marginRight: 6 }}>◆</span>
                {t.description || "—"}
                <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 6 }}>{t.date}</span>
              </span>
              <span style={{ fontWeight: 700, fontSize: 13.5, color: "var(--coral)", whiteSpace: "nowrap", marginLeft: 16 }}>
                {money(Math.abs(t.amount))}
              </span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, paddingTop: 6, borderTop: "1px dashed var(--line)" }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--navy)" }}>
              Total one-off spend
            </span>
            <span style={{ fontWeight: 800, fontSize: 13.5, color: "var(--coral)" }}>{money(oneOffSpendTotal)}</span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6, fontStyle: "italic" }}>
            {spendAboveTrend
              ? `Underlying spend is ${money(normalSpend)} — above your usual baseline even before the one-offs.`
              : spendBelowTrend
              ? `Underlying spend is ${money(normalSpend)} — the one-offs explain this month's elevated total.`
              : `Strip these out and spend is roughly on track at ${money(normalSpend)}.`}
          </div>
        </div>
      )}

      {incomeOneOffs.length > 0 && (
        <div style={{ marginTop: spendOneOffs.length > 0 ? 10 : 0, paddingTop: spendOneOffs.length > 0 ? 10 : 0, borderTop: spendOneOffs.length > 0 ? "1px solid var(--line)" : "none" }}>
          {incomeOneOffs.map((t) => (
            <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
              <span style={{ fontSize: 13.5, color: "var(--ink)" }}>
                <span style={{ color: "var(--green)", marginRight: 6 }}>◆</span>
                {t.description || "—"}
                <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 6 }}>{t.date}</span>
              </span>
              <span style={{ fontWeight: 700, fontSize: 13.5, color: "var(--green)", whiteSpace: "nowrap", marginLeft: 16 }}>
                +{money(t.amount)}
              </span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, paddingTop: 6, borderTop: "1px dashed var(--line)" }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--navy)" }}>
              Total one-off income
            </span>
            <span style={{ fontWeight: 800, fontSize: 13.5, color: "var(--green)" }}>+{money(oneOffIncomeTotal)}</span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6, fontStyle: "italic" }}>
            {incomeAboveTrend
              ? `Underlying income is ${money(normalIncome)} — already a strong month without the one-off.`
              : `Underlying income is ${money(normalIncome)} — treat this as your run-rate, not the one-off total.`}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

type ChartRange = 3 | 6 | 12 | 24;

export default function Dashboard() {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Record<string, number>>({});
  const [month, setMonth] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [chartRange, setChartRange] = useState<ChartRange>(6);
  const [fixedExpanded, setFixedExpanded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [tx, b] = await Promise.all([
          fetchAllTransactions(),
          supabase.from("budgets").select("category,monthly_amount"),
        ]);
        if (b.error) throw b.error;
        setTxns(tx);
        const bm: Record<string, number> = {};
        (b.data as Budget[]).forEach((x) => (bm[x.category] = Number(x.monthly_amount)));
        setBudgets(bm);
        // Always open on the current calendar month, so a missing month reads as
        // a gap rather than silently showing the last month that had data.
        setMonth(new Date().toISOString().slice(0, 7));
      } catch (e: any) {
        setErr(e?.message || "Failed to load data");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Last 24 calendar months, newest first — regardless of data — so a month
  // that was never imported still appears in the dropdown as a gap.
  const months = useMemo(
    () => trailingMonthKeys(new Date().toISOString().slice(0, 7), 24).slice().reverse(),
    []
  );

  const monthTxns = useMemo(() => txns.filter((t) => t.date.slice(0, 7) === month), [txns, month]);

  const byCategory = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of monthTxns) {
      if (t.category === "Ignore") continue;
      m[t.category] = (m[t.category] || 0) + t.amount;
    }
    return m;
  }, [monthTxns]);

  // cat → month → positive spend amount (expenses only, Ignore/Income excluded)
  const monthlySpend = useMemo(() => {
    const result: Record<string, Record<string, number>> = {};
    for (const t of txns) {
      if (t.category === "Ignore" || t.category === "Income" || t.category === "Big One-Offs") continue;
      if (t.amount >= 0) continue; // skip inflows for spend history
      const mo = t.date.slice(0, 7);
      if (!result[t.category]) result[t.category] = {};
      result[t.category][mo] = (result[t.category][mo] || 0) + Math.abs(t.amount);
    }
    return result;
  }, [txns]);

  const prevMonth = useMemo(() => (month ? prevMonthKey(month) : ""), [month]);

  // 12-month average: trailing 12 months ending at prevMonth
  const avg12 = useMemo(() => {
    if (!prevMonth) return {};
    const trailing = trailingMonthKeys(prevMonth, 12);
    const result: Record<string, number> = {};
    for (const [cat, byMo] of Object.entries(monthlySpend)) {
      const vals = trailing.map((mo) => byMo[mo] || 0);
      const nonZero = vals.filter((v) => v > 0);
      result[cat] = nonZero.length > 0 ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length : 0;
    }
    return result;
  }, [monthlySpend, prevMonth]);

  // Chart history for expanded category
  const chartData = useMemo((): ChartBar[] => {
    if (!expandedCat || !month) return [];
    const byMo = monthlySpend[expandedCat] || {};
    return trailingMonthKeys(month, chartRange).map((mo) => ({
      month: mo,
      spend: byMo[mo] || 0,
    }));
  }, [expandedCat, chartRange, monthlySpend, month]);

  const income = useMemo(
    () => monthTxns.filter((t) => t.category === "Income").reduce((s, t) => s + t.amount, 0),
    [monthTxns]
  );
  // Headline spend excludes Big One-Offs — a $72k car purchase isn't behavioural
  // spend and shouldn't swamp the month. One-offs surface in their own callout.
  const spend = useMemo(
    () => -monthTxns.filter((t) => t.category !== "Income" && t.category !== "Ignore" && t.category !== "Big One-Offs").reduce((s, t) => s + t.amount, 0),
    [monthTxns]
  );
  const net = income - spend;
  const savings = income > 0 ? Math.round((net / income) * 100) : null;

  const spendForCat = (cat: string) => Math.max(0, -(byCategory[cat] || 0));

  function toggleExpand(cat: string) {
    if (expandedCat === cat) {
      setExpandedCat(null);
    } else {
      setExpandedCat(cat);
      setChartRange(6);
    }
  }

  if (loading) return <div className="wrap"><div className="loading">Loading your money moves…</div></div>;
  if (err) return <div className="wrap"><div className="err">Couldn't load data: {err}</div></div>;

  // All non-behavioural spend categories present this month
  const allOtherCats = Object.keys(byCategory)
    .filter((c) => !BEHAVIOURAL.includes(c) && c !== "Income" && c !== "Ignore");

  // Sort by 12-month average descending; fall back to this-month spend when no history
  const byAvgDesc = (a: string, b: string) =>
    (avg12[b] || spendForCat(b)) - (avg12[a] || spendForCat(a));

  const variableCats = allOtherCats
    .filter((c) => !FIXED_CATS.has(c))
    .sort(byAvgDesc);

  const fixedCatsActive = allOtherCats
    .filter((c) => FIXED_CATS.has(c))
    .sort(byAvgDesc);

  const fixedThisMonth = fixedCatsActive.reduce((s, c) => s + spendForCat(c), 0);

  const monthPicker = (
    <div className="controls">
      <label htmlFor="m" style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>Month</label>
      <select id="m" value={month} onChange={(e) => { setMonth(e.target.value); setExpandedCat(null); }}>
        {months.map((m) => (
          <option key={m} value={m}>{monthLabel(m)}</option>
        ))}
      </select>
      <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{monthTxns.length} transactions</span>
    </div>
  );

  // A month with no data shows the status band and nothing else — no empty
  // stat cards or table implying "$0 spent" when the truth is "not imported".
  if (monthTxns.length === 0) {
    return (
      <div className="wrap">
        <div className="header"><div className="logo">$<span>MM</span> Money Moves</div></div>
        <p className="sub">Household finance for Nivae &amp; Diya — low-friction monthly review.</p>
        {monthPicker}
        <MonthStatus month={month} />
      </div>
    );
  }

  return (
    <div className="wrap">
      <div className="header">
        <div className="logo">$<span>MM</span> Money Moves</div>
      </div>
      <p className="sub">Household finance for Nivae &amp; Diya — low-friction monthly review.</p>

      {monthPicker}

      <MonthStatus month={month} />

      {/* Stat cards */}
      <div className="grid stats">
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

      {/* Step 4 — Big one-offs callout */}
      <OneOffsBand txns={monthTxns} spend={spend} income={income} avg12={avg12} />

      {/* All categories — enhanced table */}
      <div className="section-title">All categories{month ? ` — ${monthLabel(month)}` : ""}</div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th className="num">This month</th>
              <th className="num">Last month</th>
              <th className="num">12-mo avg</th>
              <th className="num">Budget</th>
              <th style={{ textAlign: "center", width: 52 }}>Trend</th>
            </tr>
          </thead>
          <tbody>
            {variableCats.map((cat) => {
              const thisSpend = Math.max(0, -(byCategory[cat] || 0));
              const inflow = (byCategory[cat] || 0) > 0 ? byCategory[cat] : 0;
              const lastSpend = monthlySpend[cat]?.[prevMonth] || 0;
              const avgSpend = avg12[cat] || 0;
              const budget = budgets[cat] || 0;
              const isFixed = FIXED_CATS.has(cat);
              const expanded = expandedCat === cat;

              // Trend: compare this month vs 12-mo avg
              let trendArrow: string | null = null;
              let trendColor = "var(--muted)";
              if (avgSpend > 0 && thisSpend > 0) {
                const pctDiff = (thisSpend - avgSpend) / avgSpend;
                if (Math.abs(pctDiff) >= 0.05) {
                  trendArrow = pctDiff > 0 ? "↑" : "↓";
                  if (!isFixed) {
                    trendColor = pctDiff > 0 ? "var(--coral)" : "var(--green)";
                  }
                }
              }

              return (
                <>
                  <tr
                    key={cat}
                    onClick={() => toggleExpand(cat)}
                    style={{
                      cursor: "pointer",
                      background: expanded ? "#fffbf2" : undefined,
                      borderBottom: expanded ? "none" : undefined,
                    }}
                  >
                    <td style={{ fontWeight: 600 }}>
                      {cat}
                      {cat === "NEEDS_REVIEW" && (
                        <span className="pill low" style={{ marginLeft: 8, fontSize: 10 }}>needs review</span>
                      )}
                    </td>
                    <td className="num">
                      {inflow > 0
                        ? <span className="pos">+{money(inflow)}</span>
                        : <span style={{ fontWeight: 700 }}>{money(thisSpend)}</span>}
                    </td>
                    <td className="num" style={{ color: "var(--muted)" }}>
                      {lastSpend > 0 ? money(lastSpend) : "—"}
                    </td>
                    <td className="num" style={{ color: "var(--muted)" }}>
                      {avgSpend > 0 ? money(avgSpend) : "—"}
                    </td>
                    <td className="num" style={{ color: "var(--muted)" }}>
                      {budget > 0 ? money(budget) : "—"}
                    </td>
                    <td style={{ textAlign: "center", fontSize: 16, fontWeight: 700, color: trendColor }}>
                      {trendArrow ?? <span style={{ color: "var(--line)", fontSize: 12 }}>–</span>}
                    </td>
                  </tr>
                  {expanded && (
                    <tr key={cat + "_chart"} style={{ background: "#fffbf2" }}>
                      <td colSpan={6} style={{ padding: "12px 16px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--navy)", textTransform: "uppercase", letterSpacing: ".4px" }}>
                            {cat} — {chartRange === 12 ? "1Y" : chartRange === 24 ? "2Y" : `${chartRange}M`} spend history
                          </span>
                          <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                            {([3, 6, 12, 24] as ChartRange[]).map((r) => (
                              <button
                                key={r}
                                onClick={(e) => { e.stopPropagation(); setChartRange(r); }}
                                style={{
                                  padding: "3px 9px", fontSize: 12, fontWeight: 700,
                                  border: "1px solid var(--line)", borderRadius: 6, cursor: "pointer",
                                  background: chartRange === r ? "var(--gold)" : "var(--card)",
                                  color: chartRange === r ? "#fff" : "var(--muted)",
                                }}
                              >
                                {r === 12 ? "1Y" : r === 24 ? "2Y" : `${r}M`}
                              </button>
                            ))}
                          </div>
                        </div>
                        <SpendChart data={chartData} budget={budget} />
                        {avgSpend > 0 && (
                          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
                            12-month average: <b style={{ color: "var(--navy)" }}>{money(avgSpend)}/mo</b>
                            {budget > 0 && <> · Budget: <b style={{ color: "var(--navy)" }}>{money(budget)}/mo</b></>}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              );
            })}

            {/* ── Fixed costs group ──────────────────────────────────────── */}
            {fixedCatsActive.length > 0 && (
              <>
                <tr
                  onClick={() => { setFixedExpanded((x) => !x); setExpandedCat(null); }}
                  style={{ cursor: "pointer", background: "var(--sand, #f5f0e8)", borderTop: "2px solid var(--line)" }}
                >
                  <td style={{ fontWeight: 700, color: "var(--navy)", fontSize: 12, textTransform: "uppercase", letterSpacing: ".4px" }}>
                    <span style={{ marginRight: 6 }}>{fixedExpanded ? "▾" : "▸"}</span>
                    Fixed costs
                    <span style={{ fontWeight: 400, color: "var(--muted)", marginLeft: 6, fontSize: 11 }}>
                      {fixedCatsActive.length} {fixedCatsActive.length === 1 ? "category" : "categories"}
                    </span>
                  </td>
                  <td className="num" style={{ fontWeight: 700 }}>{money(fixedThisMonth)}</td>
                  <td className="num" style={{ color: "var(--muted)" }}>
                    {fixedCatsActive.reduce((s, c) => s + (monthlySpend[c]?.[prevMonth] || 0), 0) > 0
                      ? money(fixedCatsActive.reduce((s, c) => s + (monthlySpend[c]?.[prevMonth] || 0), 0))
                      : "—"}
                  </td>
                  <td className="num" style={{ color: "var(--muted)" }}>
                    {fixedCatsActive.reduce((s, c) => s + (avg12[c] || 0), 0) > 0
                      ? money(fixedCatsActive.reduce((s, c) => s + (avg12[c] || 0), 0))
                      : "—"}
                  </td>
                  <td className="num" style={{ color: "var(--muted)" }}>
                    {fixedCatsActive.reduce((s, c) => s + (budgets[c] || 0), 0) > 0
                      ? money(fixedCatsActive.reduce((s, c) => s + (budgets[c] || 0), 0))
                      : "—"}
                  </td>
                  <td />
                </tr>

                {fixedExpanded && fixedCatsActive.map((cat) => {
                  const thisSpend = spendForCat(cat);
                  const inflow = (byCategory[cat] || 0) > 0 ? byCategory[cat] : 0;
                  const lastSpend = monthlySpend[cat]?.[prevMonth] || 0;
                  const avgSpend = avg12[cat] || 0;
                  const budget = budgets[cat] || 0;
                  const expanded = expandedCat === cat;

                  return (
                    <>
                      <tr
                        key={cat}
                        onClick={() => toggleExpand(cat)}
                        style={{
                          cursor: "pointer",
                          background: expanded ? "#fffbf2" : "#faf8f4",
                          borderBottom: expanded ? "none" : undefined,
                        }}
                      >
                        <td style={{ fontWeight: 600, paddingLeft: 28, color: "var(--ink)" }}>{cat}</td>
                        <td className="num">
                          {inflow > 0
                            ? <span className="pos">+{money(inflow)}</span>
                            : <span style={{ fontWeight: 700 }}>{money(thisSpend)}</span>}
                        </td>
                        <td className="num" style={{ color: "var(--muted)" }}>
                          {lastSpend > 0 ? money(lastSpend) : "—"}
                        </td>
                        <td className="num" style={{ color: "var(--muted)" }}>
                          {avgSpend > 0 ? money(avgSpend) : "—"}
                        </td>
                        <td className="num" style={{ color: "var(--muted)" }}>
                          {budget > 0 ? money(budget) : "—"}
                        </td>
                        <td style={{ textAlign: "center", color: "var(--muted)", fontSize: 12 }}>–</td>
                      </tr>
                      {expanded && (
                        <tr key={cat + "_chart"} style={{ background: "#fffbf2" }}>
                          <td colSpan={6} style={{ padding: "12px 16px 16px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--navy)", textTransform: "uppercase", letterSpacing: ".4px" }}>
                                {cat} — {chartRange === 12 ? "1Y" : chartRange === 24 ? "2Y" : `${chartRange}M`} spend history
                              </span>
                              <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                                {([3, 6, 12, 24] as ChartRange[]).map((r) => (
                                  <button
                                    key={r}
                                    onClick={(e) => { e.stopPropagation(); setChartRange(r); }}
                                    style={{
                                      padding: "3px 9px", fontSize: 12, fontWeight: 700,
                                      border: "1px solid var(--line)", borderRadius: 6, cursor: "pointer",
                                      background: chartRange === r ? "var(--gold)" : "var(--card)",
                                      color: chartRange === r ? "#fff" : "var(--muted)",
                                    }}
                                  >
                                    {r === 12 ? "1Y" : r === 24 ? "2Y" : `${r}M`}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <SpendChart data={chartData} budget={budget} />
                            {avgSpend > 0 && (
                              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
                                12-month average: <b style={{ color: "var(--navy)" }}>{money(avgSpend)}/mo</b>
                                {budget > 0 && <> · Budget: <b style={{ color: "var(--navy)" }}>{money(budget)}/mo</b></>}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </>
            )}
          </tbody>
        </table>
      </div>

      <div className="foot">
        Spend is net of refunds. Internal transfers, card payments, and reversed debits are excluded (categorised as
        Ignore). Trend arrows compare this month against the trailing 12-month average — red ↑ means spending above
        your usual rate for that category; green ↓ means below. Fixed-cost categories (rent, insurance, subscriptions)
        show neutral arrows regardless of direction. Click any category row to expand its spend history.
      </div>
    </div>
  );
}
