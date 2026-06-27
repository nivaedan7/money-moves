"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Line = { name: string; value: number; note?: string };
type Snapshot = {
  snapshot_date: string;
  assets: Line[];
  debts: Line[];
  meera_fund: Line[];
};

type ChartRange = "3M" | "6M" | "1Y" | "2Y" | "All";

const money = (n: number) =>
  (n < 0 ? "−" : "") + "$" + Math.abs(Math.round(n)).toLocaleString("en-AU");

const fmtDate = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "2-digit" });
};

// ─── Classification ───────────────────────────────────────────────────────────

const isSuper = (name: string) => /super|futuresuper|retirement/i.test(name);
const isFamilyLoan = (name: string) => /rethemama|nammah|appah|mama|family/i.test(name);

function deriveNW(snap: Snapshot) {
  const assets = snap.assets || [];
  const debts = snap.debts || [];
  const meera = snap.meera_fund || [];

  const coreAssets = assets.filter((a) => !isSuper(a.name));
  const superItems = assets.filter((a) => isSuper(a.name));
  const coreDebts = debts.filter((d) => !isFamilyLoan(d.name));
  const excludedDebts = debts.filter((d) => isFamilyLoan(d.name));

  const sum = (arr: Line[]) => arr.reduce((s, x) => s + Number(x.value), 0);

  const totalAssets = sum(coreAssets);
  const totalSuper = sum(superItems);
  const totalDebts = sum(coreDebts); // negative
  const totalMeera = sum(meera);
  const netWorth = totalAssets + totalDebts;

  return { coreAssets, superItems, coreDebts, excludedDebts, totalAssets, totalSuper, totalDebts, totalMeera, netWorth };
}

// ─── SVG line chart ───────────────────────────────────────────────────────────

type ChartPoint = { date: string; nw: number; assets: number; debts: number };

function NWChart({ points }: { points: ChartPoint[] }) {
  const W = 620, H = 200;
  const PAD = { left: 68, right: 16, top: 20, bottom: 36 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const allVals = points.flatMap((p) => [p.nw, p.assets, p.debts]);
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const range = maxV - minV || 1;

  const toX = (i: number) => PAD.left + (points.length > 1 ? (i / (points.length - 1)) * cW : cW / 2);
  const toY = (v: number) => PAD.top + cH - ((v - minV) / range) * cH;

  const line = (getter: (p: ChartPoint) => number) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(getter(p)).toFixed(1)}`).join(" ");

  // Y-axis: 4 ticks
  const ticks = [0, 1, 2, 3].map((i) => minV + (range * i) / 3);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block" }}>
      {/* Grid + Y labels */}
      {ticks.map((v, i) => {
        const y = toY(v);
        return (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y}
              stroke="var(--line)" strokeWidth={i === 0 ? 1 : 0.5} />
            <text x={PAD.left - 6} y={y + 4} fontSize={9} textAnchor="end" fill="var(--muted)">
              {Math.abs(v) >= 1000000
                ? `${v < 0 ? "−" : ""}$${Math.round(Math.abs(v) / 1000)}k`
                : `${v < 0 ? "−" : ""}$${Math.round(Math.abs(v) / 1000)}k`}
            </text>
          </g>
        );
      })}

      {/* Zero line if in range */}
      {minV < 0 && maxV > 0 && (
        <line x1={PAD.left} x2={W - PAD.right} y1={toY(0)} y2={toY(0)}
          stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
      )}

      {/* Series: debts (coral), assets (green), net worth (navy) */}
      {points.length > 1 && (
        <>
          <path d={line((p) => p.debts)} fill="none" stroke="var(--coral)" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.7} />
          <path d={line((p) => p.assets)} fill="none" stroke="var(--green)" strokeWidth={1.5} opacity={0.8} />
          <path d={line((p) => p.nw)} fill="none" stroke="var(--gold)" strokeWidth={2.5} />
        </>
      )}

      {/* Dots + date labels */}
      {points.map((p, i) => (
        <g key={p.date}>
          <circle cx={toX(i)} cy={toY(p.assets)} r={3} fill="var(--green)" />
          <circle cx={toX(i)} cy={toY(p.debts)} r={3} fill="var(--coral)" />
          <circle cx={toX(i)} cy={toY(p.nw)} r={4} fill="var(--gold)" stroke="#fff" strokeWidth={1.5} />
          <text x={toX(i)} y={H - 4} fontSize={9} textAnchor="middle" fill="var(--muted)">
            {fmtDate(p.date)}
          </text>
        </g>
      ))}

      {/* Legend */}
      <g transform={`translate(${PAD.left + 4}, ${PAD.top - 4})`}>
        <circle cx={0} cy={0} r={4} fill="var(--gold)" />
        <text x={8} y={4} fontSize={9} fill="var(--navy)" fontWeight={700}>Net worth</text>
        <circle cx={70} cy={0} r={4} fill="var(--green)" />
        <text x={78} y={4} fontSize={9} fill="var(--navy)">Assets</text>
        <circle cx={118} cy={0} r={4} fill="var(--coral)" />
        <text x={126} y={4} fontSize={9} fill="var(--navy)">Debts</text>
      </g>
    </svg>
  );
}

// ─── Building-history placeholder ────────────────────────────────────────────

function BuildingHistory({ count }: { count: number }) {
  return (
    <div style={{
      border: "1.5px dashed var(--line)",
      borderRadius: 12,
      padding: "28px 20px",
      textAlign: "center",
      color: "var(--muted)",
      marginBottom: 20,
    }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>📈</div>
      <div style={{ fontWeight: 700, color: "var(--navy)", marginBottom: 6 }}>Building history</div>
      <div style={{ fontSize: 13 }}>
        {count === 0
          ? "No snapshots yet. History will start accumulating from the next import or review."
          : `${count} snapshot${count === 1 ? "" : "s"} so far — need at least 3 to draw a meaningful line.`}
      </div>
      <div style={{ fontSize: 12, marginTop: 8 }}>
        Snapshots are added automatically on import / review completion (Step 7).
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NetWorth() {
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [chartRange, setChartRange] = useState<ChartRange>("All");

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from("net_worth_snapshots")
          .select("snapshot_date,assets,debts,meera_fund")
          .order("snapshot_date", { ascending: true });
        if (error) throw error;
        // Filter out zero/template snapshots (where all values are 0)
        const valid = ((data || []) as Snapshot[]).filter((s) => {
          const sum = (arr: Line[]) => (arr || []).reduce((t, x) => t + Math.abs(Number(x.value)), 0);
          return sum(s.assets) + sum(s.debts) + sum(s.meera_fund) > 0;
        });
        setSnaps(valid);
      } catch (e: any) {
        setErr(e?.message || "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const latest = snaps[snaps.length - 1] ?? null;
  const derived = useMemo(() => (latest ? deriveNW(latest) : null), [latest]);

  // Chart data — all non-zero snapshots
  const chartPoints = useMemo((): ChartPoint[] =>
    snaps.map((s) => {
      const d = deriveNW(s);
      return { date: s.snapshot_date, nw: d.netWorth, assets: d.totalAssets, debts: d.totalDebts };
    }), [snaps]);

  // Apply range filter
  const filteredPoints = useMemo(() => {
    if (chartRange === "All") return chartPoints;
    const days = { "3M": 90, "6M": 180, "1Y": 365, "2Y": 730 }[chartRange];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutStr = cutoff.toISOString().slice(0, 10);
    return chartPoints.filter((p) => p.date >= cutStr);
  }, [chartPoints, chartRange]);

  if (loading) return <div className="wrap"><div className="loading">Loading net worth…</div></div>;
  if (err) return <div className="wrap"><div className="err">Couldn't load: {err}</div></div>;
  if (!latest || !derived) return <div className="wrap"><div className="loading">No net-worth snapshot yet. Import a statement to get started.</div></div>;

  const ageDays = Math.round((Date.now() - new Date(latest.snapshot_date).getTime()) / 86400000);

  const RANGES: ChartRange[] = ["3M", "6M", "1Y", "2Y", "All"];

  return (
    <div className="wrap">
      <div className="header"><div className="logo">Net <span>Worth</span></div></div>
      <p className="sub">Snapshot as at {latest.snapshot_date}. Superannuation is shown separately and is not included in the net worth total.</p>

      {ageDays > 60 && (
        <div className="card stale" style={{ marginBottom: 18 }}>
          ⚠ This snapshot is {ageDays} days old. Upload a new statement to refresh it.
        </div>
      )}

      {/* Headline cards */}
      <div className="grid stats">
        <div className="card stat">
          <div className="label">Net worth</div>
          <div className={"value " + (derived.netWorth >= 0 ? "pos" : "neg")}>{money(derived.netWorth)}</div>
        </div>
        <div className="card stat">
          <div className="label">Core assets</div>
          <div className="value pos">{money(derived.totalAssets)}</div>
        </div>
        <div className="card stat">
          <div className="label">Debts (excl. family)</div>
          <div className="value neg">{money(derived.totalDebts)}</div>
        </div>
        <div className="card stat">
          <div className="label">Superannuation</div>
          <div className="value" style={{ color: "var(--muted)" }}>{money(derived.totalSuper)}</div>
          <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>excluded from net worth total</div>
        </div>
      </div>

      {/* Net worth over time */}
      <div className="section-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>Net worth over time</span>
        <div style={{ display: "flex", gap: 4 }}>
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setChartRange(r)}
              style={{
                padding: "3px 9px", fontSize: 11, fontWeight: 700,
                border: "1px solid var(--line)", borderRadius: 6, cursor: "pointer",
                background: chartRange === r ? "var(--gold)" : "var(--card)",
                color: chartRange === r ? "#fff" : "var(--muted)",
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {filteredPoints.length < 3 ? (
        <BuildingHistory count={filteredPoints.length} />
      ) : (
        <div className="card" style={{ padding: "16px 8px 8px" }}>
          <NWChart points={filteredPoints} />
        </div>
      )}

      {/* Assets */}
      <div className="section-title">Assets</div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <tbody>
            {derived.coreAssets.map((a) => (
              <tr key={a.name}>
                <td>{a.name}</td>
                <td className="num pos">{money(Number(a.value))}</td>
              </tr>
            ))}
            <tr style={{ borderTop: "2px solid var(--line)", background: "#f5faf7" }}>
              <td style={{ fontWeight: 700 }}>Total assets</td>
              <td className="num pos" style={{ fontWeight: 800 }}>{money(derived.totalAssets)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Super — informational */}
      {derived.superItems.length > 0 && (
        <>
          <div className="section-title" style={{ color: "var(--muted)" }}>
            Superannuation <span style={{ fontWeight: 400, fontSize: 12 }}>— informational, excluded from net worth</span>
          </div>
          <div className="card" style={{ padding: 0, opacity: 0.75 }}>
            <table>
              <tbody>
                {derived.superItems.map((a) => (
                  <tr key={a.name}>
                    <td>{a.name}</td>
                    <td className="num" style={{ color: "var(--muted)" }}>{money(Number(a.value))}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ fontWeight: 600, color: "var(--muted)" }}>Total super</td>
                  <td className="num" style={{ fontWeight: 700, color: "var(--muted)" }}>{money(derived.totalSuper)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Debts — included in NW */}
      <div className="section-title">Debts</div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <tbody>
            {derived.coreDebts.map((d) => (
              <tr key={d.name}>
                <td>
                  {d.name}
                  {d.note && <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 8 }}>{d.note}</span>}
                </td>
                <td className="num neg">{money(Number(d.value))}</td>
              </tr>
            ))}
            <tr style={{ borderTop: "2px solid var(--line)", background: "#fdf2ef" }}>
              <td style={{ fontWeight: 700 }}>Total debts</td>
              <td className="num neg" style={{ fontWeight: 800 }}>{money(derived.totalDebts)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Excluded debts — informational */}
      {derived.excludedDebts.length > 0 && (
        <>
          <div className="section-title" style={{ color: "var(--muted)" }}>
            Family loans <span style={{ fontWeight: 400, fontSize: 12 }}>— excluded from net worth calculation</span>
          </div>
          <div className="card" style={{ padding: 0, opacity: 0.65 }}>
            <table>
              <tbody>
                {derived.excludedDebts.map((d) => (
                  <tr key={d.name}>
                    <td>{d.name}</td>
                    <td className="num" style={{ color: "var(--muted)" }}>{money(Number(d.value))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Meera's fund */}
      <div className="section-title">Meera's fund</div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <tbody>
            {(latest.meera_fund || []).map((m) => (
              <tr key={m.name}>
                <td>{m.name}</td>
                <td className="num">{money(Number(m.value))}</td>
              </tr>
            ))}
            <tr style={{ borderTop: "2px solid var(--line)", background: "#fffbf2" }}>
              <td style={{ fontWeight: 700 }}>Total Meera's fund</td>
              <td className="num" style={{ fontWeight: 800 }}>{money(derived.totalMeera)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="foot">
        Net worth = core assets (excl. super) − mortgage − HELP debts. Family loans are excluded from the net worth
        calculation but shown above for completeness. Superannuation is real wealth but inaccessible until preservation
        age — it is tracked separately and does not inflate the headline figure. The history chart accumulates over time;
        a snapshot is written automatically on each import or review cycle.
      </div>
    </div>
  );
}
