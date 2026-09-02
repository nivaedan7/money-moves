"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// ─── Types ────────────────────────────────────────────────────────────────────

type Txn  = { date: string; amount: number; category: string };
type Line = { name: string; value: number };
type Snap = { snapshot_date: string; assets: Line[]; debts: Line[] };
type Goal = { id: string; name: string; target_amount: number; current_amount: number; target_date: string | null; notes: string | null; sort: number };

const money = (n: number) =>
  (n < 0 ? "−" : "") + "$" + Math.abs(Math.round(n)).toLocaleString("en-AU");

const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-AU", { month: "short", year: "2-digit" });
};

// ─── Data fetchers ────────────────────────────────────────────────────────────

async function fetchAllTxns(): Promise<Txn[]> {
  const all: Txn[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("transactions")
      .select("date,amount,category")
      .order("date", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as any[]).map((r) => ({ date: r.date, amount: Number(r.amount), category: r.category })));
    if (data.length < 1000) break;
  }
  return all;
}

// ─── Asset classification (mirror of NetWorth page) ───────────────────────────

const isSuper      = (name: string) => /super|futuresuper|retirement/i.test(name);
const isFamilyLoan = (name: string) => /rethemama|nammah|appah|mama|family/i.test(name);

function coreAssetTotal(snap: Snap): number {
  return (snap.assets || [])
    .filter((a) => !isSuper(a.name))
    .reduce((s, a) => s + Number(a.value), 0);
}

// ─── Projection maths ─────────────────────────────────────────────────────────

type GrowthData = {
  valid: true;
  monthlyRate: number;
  intervals: number;
  currentAssets: number;
  snapUsed: Snap[];
} | {
  valid: false;
  reason: string;
  snapCount: number;
};

function computeGrowth(snaps: Snap[]): GrowthData {
  // Filter out zero/template snapshots
  const valid = snaps
    .filter((s) => coreAssetTotal(s) > 0)
    .sort((a, b) => (a.snapshot_date < b.snapshot_date ? -1 : 1));

  if (valid.length < 2) {
    return { valid: false, reason: "Need at least 2 snapshots with data.", snapCount: valid.length };
  }

  // Per-interval monthly-equivalent growth, keeping only intervals >= 60 days.
  // A short window (e.g. an 11-day gap) wildly over/under-states the annual rate
  // — that is exactly what made Outlook project -5.5%/yr off an 11-day interval.
  const intervals: { rate: number; days: number }[] = [];
  for (let i = 1; i < valid.length; i++) {
    const prev = valid[i - 1];
    const curr = valid[i];
    const a1 = coreAssetTotal(prev);
    const a2 = coreAssetTotal(curr);
    if (a1 <= 0) continue;
    const days =
      (new Date(curr.snapshot_date).getTime() - new Date(prev.snapshot_date).getTime()) / 86_400_000;
    if (days < 60) continue;
    intervals.push({ rate: Math.pow(a2 / a1, 30 / days) - 1, days });
  }

  if (intervals.length < 2) {
    return {
      valid: false,
      reason: "Need at least two snapshots 60+ days apart to project a trend.",
      snapCount: valid.length,
    };
  }

  // Trailing 3 qualifying intervals, weighted by their length in days.
  const trailing = intervals.slice(-3);
  const totalDays = trailing.reduce((s, x) => s + x.days, 0);
  const monthlyRate = trailing.reduce((s, x) => s + x.rate * x.days, 0) / totalDays;

  return {
    valid: true,
    monthlyRate,
    intervals: trailing.length,
    currentAssets: coreAssetTotal(valid[valid.length - 1]),
    snapUsed: valid,
  };
}

function projectMonths(start: number, rate: number, months: number): number[] {
  const pts: number[] = [start];
  for (let i = 1; i <= months; i++) pts.push(pts[i - 1] * (1 + rate));
  return pts;
}

// ─── Projection chart ─────────────────────────────────────────────────────────

type ProjectionChartProps = {
  start: number;
  rate: number;
  months: number;
  labelEvery: number;   // label every N months
  labelFmt: (n: number) => string;
};

function ProjectionChart({ start, rate, months, labelEvery, labelFmt }: ProjectionChartProps) {
  const W = 620, H = 170;
  const PAD = { left: 72, right: 16, top: 16, bottom: 28 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const pts = projectMonths(start, rate, months);
  const minV = Math.min(...pts);
  const maxV = Math.max(...pts);
  const range = maxV - minV || 1;

  const toX = (i: number) => PAD.left + (i / months) * cW;
  const toY = (v: number) => PAD.top + cH - ((v - minV) / range) * cH;

  const pathD = pts.map((v, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(v).toFixed(1)}`).join(" ");

  // Fill path under the line
  const fillD = `${pathD} L ${toX(months).toFixed(1)} ${toY(minV).toFixed(1)} L ${toX(0).toFixed(1)} ${toY(minV).toFixed(1)} Z`;

  // Tick values: 4 evenly spaced
  const ticks = [0, 1, 2, 3].map((i) => minV + (range * i) / 3);

  // X labels
  const xLabels: { i: number; label: string }[] = [];
  for (let i = 0; i <= months; i += labelEvery) xLabels.push({ i, label: labelFmt(i) });

  const fmt = (v: number) =>
    v >= 1_000_000
      ? `$${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}M`
      : `$${Math.round(v / 1000)}k`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block" }}>
      {/* Grid */}
      {ticks.map((v, i) => {
        const y = toY(v);
        return (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="var(--line)" strokeWidth={0.75} />
            <text x={PAD.left - 6} y={y + 4} fontSize={9} textAnchor="end" fill="var(--muted)">{fmt(v)}</text>
          </g>
        );
      })}

      {/* Fill */}
      <path d={fillD} fill="var(--gold)" opacity={0.12} />

      {/* Line */}
      <path d={pathD} fill="none" stroke="var(--gold)" strokeWidth={2.5} />

      {/* Start dot */}
      <circle cx={toX(0)} cy={toY(pts[0])} r={4} fill="var(--navy)" />

      {/* End dot + value label */}
      <circle cx={toX(months)} cy={toY(pts[months])} r={5} fill="var(--gold)" stroke="#fff" strokeWidth={1.5} />
      <text x={toX(months) - 4} y={toY(pts[months]) - 9} fontSize={10} textAnchor="end" fill="var(--gold)" fontWeight={700}>
        {fmt(pts[months])}
      </text>

      {/* X axis labels */}
      {xLabels.map(({ i, label }) => (
        <text key={i} x={toX(i)} y={H - 6} fontSize={9} textAnchor="middle" fill="var(--muted)">{label}</text>
      ))}
    </svg>
  );
}

// ─── Not enough data ──────────────────────────────────────────────────────────

function NeedMoreData({ snapCount }: { snapCount: number }) {
  return (
    <div style={{
      border: "1.5px dashed var(--line)",
      borderRadius: 12,
      padding: "28px 20px",
      textAlign: "center",
      color: "var(--muted)",
      marginBottom: 20,
    }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>🔭</div>
      <div style={{ fontWeight: 700, color: "var(--navy)", marginBottom: 6 }}>Need ~3 months of snapshot data to project</div>
      <div style={{ fontSize: 13 }}>
        {snapCount === 0
          ? "No snapshots yet. Import a statement to write the first one."
          : snapCount === 1
          ? "1 snapshot recorded. Import next month's statement to start building the trend."
          : `${snapCount} snapshots so far. A few more months will give the projection enough signal.`}
      </div>
      <div style={{ fontSize: 12, marginTop: 8 }}>
        Snapshots are written automatically on each import / review completion (Step 7).
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Outlook() {
  const [txns,    setTxns]    = useState<Txn[]>([]);
  const [snaps,   setSnaps]   = useState<Snap[]>([]);
  const [goals,   setGoals]   = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState<string | null>(null);
  const [form,    setForm]    = useState({ name: "", target: "", current: "", date: "" });

  async function loadGoals() {
    const { data } = await supabase.from("goals").select("*").order("sort", { ascending: true });
    setGoals((data as Goal[]) || []);
  }

  useEffect(() => {
    (async () => {
      try {
        const [tx, snapRes] = await Promise.all([
          fetchAllTxns(),
          supabase
            .from("net_worth_snapshots")
            .select("snapshot_date,assets,debts")
            .order("snapshot_date", { ascending: true }),
        ]);
        if (snapRes.error) throw snapRes.error;
        setTxns(tx);
        setSnaps((snapRes.data || []) as Snap[]);
        await loadGoals();
      } catch (e: any) {
        setErr(e?.message || "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Cashflow monthly table ────────────────────────────────────────────────
  const monthly = useMemo(() => {
    const m: Record<string, { income: number; spend: number }> = {};
    for (const t of txns) {
      if (/^ignore/i.test(t.category)) continue;
      const k = t.date.slice(0, 7);
      m[k] = m[k] || { income: 0, spend: 0 };
      if (/^income/i.test(t.category)) m[k].income += t.amount;
      else m[k].spend += -t.amount;
    }
    return Object.entries(m)
      .map(([k, v]) => ({
        month: k,
        income: v.income,
        spend: v.spend,
        net: v.income - v.spend,
        rate: v.income > 1000 ? (v.income - v.spend) / v.income : null,
      }))
      .sort((a, b) => (a.month < b.month ? -1 : 1));
  }, [txns]);

  const recent = monthly.slice(-9);

  // ── Growth computation ────────────────────────────────────────────────────
  const growth = useMemo(() => computeGrowth(snaps), [snaps]);

  const annualRate    = growth.valid ? Math.pow(1 + growth.monthlyRate, 12) - 1 : 0;
  const currentAssets = growth.valid ? growth.currentAssets : 0;

  async function addGoal(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.target) return;
    await supabase.from("goals").insert({
      name: form.name,
      target_amount: Number(form.target),
      current_amount: Number(form.current || 0),
      target_date: form.date || null,
      sort: 100,
    });
    setForm({ name: "", target: "", current: "", date: "" });
    loadGoals();
  }

  if (loading) return <div className="wrap"><div className="loading">Loading outlook…</div></div>;
  if (err)     return <div className="wrap"><div className="err">{err}</div></div>;

  // X-axis label helpers
  const today = new Date();
  const addMonths = (n: number) => {
    const d = new Date(today);
    d.setMonth(d.getMonth() + n);
    return d;
  };
  const shortDate = (d: Date) => d.toLocaleDateString("en-AU", { month: "short", year: "2-digit" });

  return (
    <div className="wrap">
      <div className="header"><div className="logo">Out<span>look</span></div></div>
      <p className="sub">Asset trajectory and goals — projecting core assets forward at observed growth rate.</p>

      {/* ── Headline cards ──────────────────────────────────────────────────── */}
      <div className="grid stats">
        <div className="card stat">
          <div className="label">Core assets (now)</div>
          <div className="value pos">{growth.valid ? money(growth.currentAssets) : "—"}</div>
        </div>
        <div className="card stat">
          <div className="label">Monthly growth rate</div>
          <div className="value" style={{ color: growth.valid && growth.monthlyRate >= 0 ? "var(--green)" : "var(--coral)" }}>
            {growth.valid ? (growth.monthlyRate * 100).toFixed(2) + "%" : "—"}
          </div>
          <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
            {growth.valid ? `trailing ${growth.intervals}-interval avg` : "not enough data"}
          </div>
        </div>
        <div className="card stat">
          <div className="label">Annual rate (implied)</div>
          <div className="value" style={{ color: "var(--navy)" }}>
            {growth.valid ? (annualRate * 100).toFixed(1) + "%" : "—"}
          </div>
        </div>
        <div className="card stat">
          <div className="label">Assets in 5 years</div>
          <div className="value">
            {growth.valid
              ? money(currentAssets * Math.pow(1 + growth.monthlyRate, 60))
              : "—"}
          </div>
        </div>
      </div>

      {/* ── Projection charts ───────────────────────────────────────────────── */}
      <div className="section-title">Asset projection</div>

      {!growth.valid || growth.intervals < 3 ? (
        <>
          {!growth.valid
            ? <NeedMoreData snapCount={growth.snapCount} />
            : (
              <div className="card" style={{ marginBottom: 16, background: "#fffbf2", borderLeft: "3px solid var(--gold)", padding: "14px 18px" }}>
                <b style={{ color: "var(--navy)" }}>Early estimate</b> — only {growth.intervals} interval{growth.intervals === 1 ? "" : "s"} of data.
                The projection will stabilise once 3+ months of snapshots accumulate.
              </div>
            )
          }
          {growth.valid && (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--navy)", margin: "0 0 6px" }}>1-year view</div>
              <div className="card" style={{ padding: "16px 8px 8px" }}>
                <ProjectionChart
                  start={currentAssets}
                  rate={growth.monthlyRate}
                  months={12}
                  labelEvery={2}
                  labelFmt={(n) => shortDate(addMonths(n))}
                />
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--navy)", margin: "0 0 6px" }}>1-year</div>
          <div className="card" style={{ padding: "16px 8px 8px", marginBottom: 14 }}>
            <ProjectionChart
              start={currentAssets}
              rate={growth.monthlyRate}
              months={12}
              labelEvery={2}
              labelFmt={(n) => shortDate(addMonths(n))}
            />
          </div>

          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--navy)", margin: "0 0 6px" }}>5-year</div>
          <div className="card" style={{ padding: "16px 8px 8px", marginBottom: 14 }}>
            <ProjectionChart
              start={currentAssets}
              rate={growth.monthlyRate}
              months={60}
              labelEvery={12}
              labelFmt={(n) => addMonths(n).getFullYear().toString()}
            />
          </div>

          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--navy)", margin: "0 0 6px" }}>10-year</div>
          <div className="card" style={{ padding: "16px 8px 8px", marginBottom: 14 }}>
            <ProjectionChart
              start={currentAssets}
              rate={growth.monthlyRate}
              months={120}
              labelEvery={12}
              labelFmt={(n) => addMonths(n).getFullYear().toString()}
            />
          </div>
        </>
      )}

      <p className="sub" style={{ marginTop: -8 }}>
        Projection uses trailing {growth.valid ? growth.intervals : "—"}-interval average asset growth from net worth snapshots.
        Excludes superannuation. Debts not modelled — assets move independently of debt repayment schedule.
        Rate will shift as more snapshots accumulate; treat short-term as directional only.
      </p>

      {/* ── Cashflow table ──────────────────────────────────────────────────── */}
      <div className="section-title">Monthly cashflow — last {recent.length} months</div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">Income</th>
              <th className="num">Spend</th>
              <th className="num">Net</th>
              <th className="num">Rate</th>
            </tr>
          </thead>
          <tbody>
            {recent.slice().reverse().map((m) => (
              <tr key={m.month}>
                <td>{monthLabel(m.month)}</td>
                <td className="num pos">{m.income > 0 ? money(m.income) : <span style={{ color: "var(--line)" }}>—</span>}</td>
                <td className="num">{money(m.spend)}</td>
                <td className={"num " + (m.net >= 0 ? "pos" : "neg")}>{money(m.net)}</td>
                <td className="num" style={{ color: "var(--muted)" }}>{m.rate === null ? "—" : Math.round(m.rate * 100) + "%"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="sub" style={{ marginTop: 6 }}>
        Months showing "—" for income have no salary credits recorded — statements for that account or period have not been imported yet.
      </p>

      {/* ── Goals ───────────────────────────────────────────────────────────── */}
      <div className="section-title">Goals</div>
      <div className="card">
        {goals.length === 0 && <div style={{ color: "var(--muted)", fontSize: 14 }}>No goals yet — add one below.</div>}
        {goals.map((g) => {
          const pct = g.target_amount > 0
            ? Math.min(100, Math.round((Number(g.current_amount) / Number(g.target_amount)) * 100))
            : 0;
          return (
            <div key={g.id} style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontWeight: 700 }}>{g.name}</span>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>
                  {money(Number(g.current_amount))} / {money(Number(g.target_amount))} ({pct}%)
                  {g.target_date ? ` · by ${g.target_date}` : ""}
                </span>
              </div>
              <div className="bar" style={{ marginTop: 8 }}>
                <i style={{ width: pct + "%", background: "var(--gold)" }} />
              </div>
              {g.notes && <div className="vs" style={{ marginTop: 4 }}>{g.notes}</div>}
            </div>
          );
        })}
      </div>

      <form
        className="card"
        onSubmit={addGoal}
        style={{ marginTop: 12, display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", gap: 8, alignItems: "center" }}
      >
        <input className="inp" placeholder="Goal name"  value={form.name}    onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="inp" type="number" placeholder="Target $"  value={form.target}  onChange={(e) => setForm({ ...form, target: e.target.value })} />
        <input className="inp" type="number" placeholder="Current $" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} />
        <input className="inp" type="date"   value={form.date}    onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <button className="btn" type="submit">Add</button>
      </form>

      <div className="foot">
        Projection applies compound growth at the observed monthly asset rate — it is not a savings-contribution
        model. Large one-off purchases or income events (flaggable in Review) will shift the rate; they should be
        treated as outliers rather than a new baseline. Debt repayment is excluded deliberately: it is near-
        deterministic and adds noise rather than signal to a forward-looking asset view.
      </div>
    </div>
  );
}
