"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// ─── Types ────────────────────────────────────────────────────────────────────

type Line = { name: string; value: number };
type Snap = { snapshot_date: string; meera_fund: Line[] };

const money = (n: number) =>
  (n < 0 ? "−" : "") + "$" + Math.abs(Math.round(n)).toLocaleString("en-AU");

const moneyK = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${n < 0 ? "−" : ""}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${n < 0 ? "−" : ""}$${(abs / 1_000).toFixed(1)}k`;
  return money(n);
};

// ─── Fund helpers ─────────────────────────────────────────────────────────────

const fundTotal = (snap: Snap) =>
  (snap.meera_fund || []).reduce((s, x) => s + Number(x.value), 0);

// ─── Growth model ─────────────────────────────────────────────────────────────
//
// From snapshot pairs, compute:
//   r = monthly rate of fund change (compound, includes contributions + returns)
//   c = implied average monthly contribution
//     = avg_monthly_delta − avg_opening_balance × r
//
// The projection then uses the standard FV-with-contributions formula:
//   F(n) = F0 × (1+r)^n + C × [(1+r)^n − 1] / r

type GrowthModel =
  | { ok: false; reason: string; snapCount: number }
  | { ok: true; monthlyRate: number; monthlyContrib: number; intervals: number; currentTotal: number };

function buildModel(snaps: Snap[]): GrowthModel {
  const valid = snaps
    .filter((s) => fundTotal(s) > 0)
    .sort((a, b) => (a.snapshot_date < b.snapshot_date ? -1 : 1));

  if (valid.length < 2)
    return { ok: false, reason: "Need at least 2 snapshots with Meera fund data.", snapCount: valid.length };

  const rates: number[]   = [];
  const contribs: number[] = [];

  for (let i = 1; i < valid.length; i++) {
    const prev = valid[i - 1];
    const curr = valid[i];
    const f0 = fundTotal(prev);
    const f1 = fundTotal(curr);
    if (f0 <= 0) continue;
    const days = (new Date(curr.snapshot_date).getTime() - new Date(prev.snapshot_date).getTime()) / 86_400_000;
    if (days < 1) continue;
    const months = days / 30;

    // Monthly compound rate for the full observed movement
    const r = Math.pow(f1 / f0, 1 / months) - 1;
    rates.push(r);

    // Implied monthly contribution: net delta per month minus organic growth
    const organic    = f0 * (Math.pow(1 + r, months) - 1);
    const netDelta   = f1 - f0;
    const implied_c  = (netDelta - organic) / months;
    contribs.push(implied_c);
  }

  if (rates.length === 0)
    return { ok: false, reason: "Could not compute growth from snapshots.", snapCount: valid.length };

  const trailing    = Math.min(3, rates.length);
  const avgRate     = rates.slice(-trailing).reduce((s, r) => s + r, 0) / trailing;
  const avgContrib  = contribs.slice(-trailing).reduce((s, c) => s + c, 0) / trailing;

  return {
    ok: true,
    monthlyRate:   avgRate,
    monthlyContrib: Math.max(0, avgContrib), // can't be negative (no planned withdrawals)
    intervals:     trailing,
    currentTotal:  fundTotal(valid[valid.length - 1]),
  };
}

// FV with regular contributions: F(n) = F0(1+r)^n + C[(1+r)^n - 1]/r
function project(f0: number, r: number, c: number, months: number): number {
  if (months <= 0) return f0;
  const growth = Math.pow(1 + r, months);
  if (Math.abs(r) < 1e-9) return f0 + c * months;
  return f0 * growth + c * (growth - 1) / r;
}

// ─── Projection chart ─────────────────────────────────────────────────────────

function FundChart({ f0, r, c, targetMonths, ageMarkers }: {
  f0: number; r: number; c: number; targetMonths: number;
  ageMarkers: { months: number; age: number }[];
}) {
  const W = 620, H = 180;
  const PAD = { left: 72, right: 24, top: 20, bottom: 32 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  // Generate yearly datapoints
  const points: { m: number; v: number }[] = [];
  const step = Math.max(1, Math.round(targetMonths / 60)); // ~60 points max
  for (let m = 0; m <= targetMonths; m += step) points.push({ m, v: project(f0, r, c, m) });
  if (points[points.length - 1].m !== targetMonths)
    points.push({ m: targetMonths, v: project(f0, r, c, targetMonths) });

  const vals = points.map((p) => p.v);
  const minV = Math.min(...vals, f0);
  const maxV = Math.max(...vals);
  const range = maxV - minV || 1;

  const toX = (m: number) => PAD.left + (m / targetMonths) * cW;
  const toY = (v: number) => PAD.top + cH - ((v - minV) / range) * cH;

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.m).toFixed(1)} ${toY(p.v).toFixed(1)}`).join(" ");
  const fillD = `${pathD} L ${toX(targetMonths)} ${toY(minV)} L ${toX(0)} ${toY(minV)} Z`;

  const ticks = [0, 1, 2, 3].map((i) => minV + (range * i) / 3);

  // X-axis: yearly labels
  const yearLabels: { m: number; label: string }[] = [];
  const today = new Date();
  for (let m = 0; m <= targetMonths; m += 12) {
    const d = new Date(today);
    d.setMonth(d.getMonth() + m);
    yearLabels.push({ m, label: String(d.getFullYear()).slice(2) });
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block" }}>
      {/* Grid */}
      {ticks.map((v, i) => {
        const y = toY(v);
        return (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="var(--line)" strokeWidth={0.75} />
            <text x={PAD.left - 6} y={y + 4} fontSize={9} textAnchor="end" fill="var(--muted)">{moneyK(v)}</text>
          </g>
        );
      })}

      {/* Age marker lines */}
      {ageMarkers.map(({ months, age }) => {
        if (months <= 0 || months > targetMonths) return null;
        const x = toX(months);
        return (
          <g key={age}>
            <line x1={x} x2={x} y1={PAD.top} y2={PAD.top + cH} stroke="var(--muted)" strokeDasharray="3 3" strokeWidth={1} />
            <text x={x + 3} y={PAD.top + 11} fontSize={9} fill="var(--muted)">age {age}</text>
          </g>
        );
      })}

      {/* Fill + line */}
      <path d={fillD} fill="var(--gold)" opacity={0.1} />
      <path d={pathD} fill="none" stroke="var(--gold)" strokeWidth={2.5} />

      {/* Start dot */}
      <circle cx={toX(0)} cy={toY(f0)} r={4} fill="var(--navy)" />
      <text x={toX(0) + 6} y={toY(f0) - 6} fontSize={9} fill="var(--navy)" fontWeight={700}>{moneyK(f0)}</text>

      {/* End dot */}
      <circle cx={toX(targetMonths)} cy={toY(project(f0, r, c, targetMonths))} r={5} fill="var(--gold)" stroke="#fff" strokeWidth={1.5} />
      <text x={toX(targetMonths) - 4} y={toY(project(f0, r, c, targetMonths)) - 9} fontSize={10} textAnchor="end" fill="var(--gold)" fontWeight={700}>
        {moneyK(project(f0, r, c, targetMonths))}
      </text>

      {/* X labels */}
      {yearLabels.map(({ m, label }) => (
        <text key={m} x={toX(m)} y={H - 6} fontSize={9} textAnchor="middle" fill="var(--muted)">{label}</text>
      ))}
    </svg>
  );
}

// ─── DOB gate ─────────────────────────────────────────────────────────────────

function DobGate({ onSave }: { onSave: (dob: string) => void }) {
  const [val, setVal] = useState("2022-11-22");
  return (
    <div className="card" style={{ textAlign: "center", padding: "28px 20px" }}>
      <div style={{ fontSize: 24, marginBottom: 10 }}>👶</div>
      <div style={{ fontWeight: 700, color: "var(--navy)", marginBottom: 8 }}>Set Meera's date of birth</div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
        Needed to calculate current age and project to target ages.
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
        <input
          type="date"
          className="inp"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          style={{ fontSize: 14 }}
        />
        <button
          className="btn"
          disabled={!val}
          onClick={() => { if (val) { localStorage.setItem("meera_dob", val); onSave(val); } }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

const TARGET_AGES = [18, 21, 25] as const;

export default function MeeraFund() {
  const [snaps,   setSnaps]   = useState<Snap[]>([]);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState<string | null>(null);
  const [dob,     setDob]     = useState<string>("");
  const [targetAge, setTargetAge] = useState<number>(18);
  const [customAge, setCustomAge] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem("meera_dob") || "2022-11-22";
    setDob(stored);
    (async () => {
      try {
        const { data, error } = await supabase
          .from("net_worth_snapshots")
          .select("snapshot_date,meera_fund")
          .order("snapshot_date", { ascending: true });
        if (error) throw error;
        const valid = ((data || []) as Snap[]).filter((s) => fundTotal(s) > 0);
        setSnaps(valid);
      } catch (e: any) {
        setErr(e?.message || "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const model = useMemo(() => buildModel(snaps), [snaps]);
  const latest = snaps[snaps.length - 1] ?? null;

  // Age calculations
  const ageInfo = useMemo(() => {
    if (!dob) return null;
    const birth = new Date(dob);
    const now   = new Date();
    const ageMs = now.getTime() - birth.getTime();
    const ageYears  = ageMs / (365.25 * 24 * 3600 * 1000);
    const ageMonths = ageMs / (30.44 * 24 * 3600 * 1000);
    return { ageYears, ageMonths };
  }, [dob]);

  const effectiveTargetAge = customAge ? parseInt(customAge) || targetAge : targetAge;
  const monthsToTarget = ageInfo
    ? Math.max(0, Math.round((effectiveTargetAge - ageInfo.ageYears) * 12))
    : null;

  const ageMarkers = useMemo(() => {
    if (!ageInfo || monthsToTarget === null || monthsToTarget === 0) return [];
    return [5, 10, 18, 21, 25]
      .filter((a) => a > ageInfo.ageYears && a <= effectiveTargetAge)
      .map((age) => ({ age, months: Math.round((age - ageInfo.ageYears) * 12) }));
  }, [ageInfo, effectiveTargetAge, monthsToTarget]);

  if (loading) return <div className="wrap"><div className="loading">Loading Meera's fund…</div></div>;
  if (err)     return <div className="wrap"><div className="err">Couldn't load: {err}</div></div>;

  const annualRate = model.ok ? (Math.pow(1 + model.monthlyRate, 12) - 1) * 100 : 0;

  return (
    <div className="wrap">
      <div className="header"><div className="logo">Meera's <span>Fund</span></div></div>
      <p className="sub">Dedicated investment fund for Meera — current holdings, observed growth, and age-based projection.</p>

      {/* ── Current holdings ───────────────────────────────────────────────── */}
      {latest ? (
        <>
          <div className="section-title">Current holdings</div>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <tbody>
                {(latest.meera_fund || []).map((line) => (
                  <tr key={line.name}>
                    <td style={{ fontWeight: 600 }}>{line.name}</td>
                    <td className="num pos">{money(Number(line.value))}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: "2px solid var(--line)", background: "#fffbf2" }}>
                  <td style={{ fontWeight: 700 }}>Total fund</td>
                  <td className="num" style={{ fontWeight: 800, color: "var(--gold)" }}>
                    {money(fundTotal(latest))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="sub" style={{ marginTop: 6 }}>As at {latest.snapshot_date}. Updated automatically on each import / review cycle.</p>
        </>
      ) : (
        <div className="card" style={{ color: "var(--muted)" }}>No snapshot yet — import a statement to create the first one.</div>
      )}

      {/* ── Growth model ───────────────────────────────────────────────────── */}
      <div className="section-title">Observed growth</div>
      {model.ok ? (
        <>
          <div className="grid stats">
            <div className="card stat">
              <div className="label">Monthly rate</div>
              <div className="value" style={{ color: model.monthlyRate >= 0 ? "var(--green)" : "var(--coral)" }}>
                {(model.monthlyRate * 100).toFixed(2)}%
              </div>
              <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>trailing {model.intervals}-snapshot avg</div>
            </div>
            <div className="card stat">
              <div className="label">Annual implied</div>
              <div className="value" style={{ color: "var(--navy)" }}>{annualRate.toFixed(1)}%</div>
            </div>
            <div className="card stat">
              <div className="label">Avg monthly contrib.</div>
              <div className="value">{money(model.monthlyContrib)}</div>
              <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>implied from deltas</div>
            </div>
            <div className="card stat">
              <div className="label">Snapshots used</div>
              <div className="value" style={{ color: "var(--muted)" }}>{snaps.length}</div>
            </div>
          </div>
          <p className="sub" style={{ marginTop: 6 }}>
            Monthly rate = observed fund movement (contributions + investment returns combined).
            Implied monthly contribution = monthly delta minus organic growth component.
          </p>
        </>
      ) : (
        <div style={{
          border: "1.5px dashed var(--line)", borderRadius: 12, padding: "24px 20px",
          textAlign: "center", color: "var(--muted)", marginBottom: 20,
        }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>📊</div>
          <div style={{ fontWeight: 700, color: "var(--navy)", marginBottom: 6 }}>Building growth history</div>
          <div style={{ fontSize: 13 }}>{model.reason}</div>
        </div>
      )}

      {/* ── Projection ─────────────────────────────────────────────────────── */}
      <div className="section-title">Age projection</div>

      {!dob ? (
        <DobGate onSave={setDob} />
      ) : !model.ok ? (
        <div className="card" style={{ color: "var(--muted)", fontSize: 13, padding: "18px 20px" }}>
          Need at least 2 months of fund data to project. Come back after the next snapshot is written.
        </div>
      ) : (
        <>
          {/* Age + current age display */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
            {ageInfo && (
              <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>
                Meera is <b style={{ color: "var(--navy)" }}>{ageInfo.ageYears.toFixed(1)} years</b> old
              </span>
            )}
            <span style={{ fontSize: 12, color: "var(--muted)" }}>·</span>
            <button
              className="link"
              style={{ fontSize: 12, color: "var(--muted)" }}
              onClick={() => { localStorage.removeItem("meera_dob"); setDob(""); }}
            >
              Change DOB
            </button>
          </div>

          {/* Target age selector */}
          <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600, marginRight: 4 }}>Target age:</span>
            {TARGET_AGES.map((age) => (
              <button
                key={age}
                onClick={() => { setTargetAge(age); setCustomAge(""); }}
                style={{
                  padding: "5px 14px", fontSize: 13, fontWeight: 700,
                  border: "1.5px solid var(--line)", borderRadius: 8, cursor: "pointer",
                  background: effectiveTargetAge === age && !customAge ? "var(--gold)" : "var(--card)",
                  color:      effectiveTargetAge === age && !customAge ? "#fff" : "var(--muted)",
                }}
              >
                {age}
              </button>
            ))}
            <input
              type="number"
              className="inp"
              placeholder="custom"
              min="5"
              max="30"
              value={customAge}
              onChange={(e) => setCustomAge(e.target.value)}
              style={{ width: 80, padding: "5px 10px", fontSize: 13 }}
            />
          </div>

          {monthsToTarget !== null && monthsToTarget > 0 ? (
            <>
              {/* Summary cards */}
              <div className="grid stats" style={{ marginBottom: 14 }}>
                <div className="card stat">
                  <div className="label">At age {effectiveTargetAge}</div>
                  <div className="value" style={{ color: "var(--gold)", fontSize: "1.5rem" }}>
                    {moneyK(project(model.currentTotal, model.monthlyRate, model.monthlyContrib, monthsToTarget))}
                  </div>
                </div>
                <div className="card stat">
                  <div className="label">Months remaining</div>
                  <div className="value" style={{ color: "var(--navy)" }}>{monthsToTarget}</div>
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                    {Math.floor(monthsToTarget / 12)}y {monthsToTarget % 12}m
                  </div>
                </div>
                <div className="card stat">
                  <div className="label">Total contributions</div>
                  <div className="value">{moneyK(model.monthlyContrib * monthsToTarget)}</div>
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>at {money(model.monthlyContrib)}/mo</div>
                </div>
                <div className="card stat">
                  <div className="label">Investment growth</div>
                  <div className="value pos">
                    {moneyK(
                      project(model.currentTotal, model.monthlyRate, model.monthlyContrib, monthsToTarget)
                      - model.currentTotal
                      - model.monthlyContrib * monthsToTarget
                    )}
                  </div>
                </div>
              </div>

              {/* Chart */}
              <div className="card" style={{ padding: "16px 8px 8px" }}>
                <FundChart
                  f0={model.currentTotal}
                  r={model.monthlyRate}
                  c={model.monthlyContrib}
                  targetMonths={monthsToTarget}
                  ageMarkers={ageMarkers}
                />
              </div>
              <p className="sub" style={{ marginTop: 6 }}>
                Projected using trailing {model.intervals}-interval average rate ({(model.monthlyRate * 100).toFixed(2)}%/mo)
                with {money(model.monthlyContrib)}/month in implied contributions.
                Dashed vertical lines mark age milestones. Past performance is not a guarantee of future returns.
              </p>
            </>
          ) : monthsToTarget === 0 ? (
            <div className="card" style={{ color: "var(--muted)" }}>Meera has already reached age {effectiveTargetAge}.</div>
          ) : null}
        </>
      )}

      {/* ── Snapshot history ────────────────────────────────────────────────── */}
      {snaps.length > 1 && (
        <>
          <div className="section-title">Fund history</div>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="num">Fund total</th>
                  <th className="num">Change</th>
                </tr>
              </thead>
              <tbody>
                {snaps.slice().reverse().map((s, i, arr) => {
                  const total = fundTotal(s);
                  const prev  = i < arr.length - 1 ? fundTotal(arr[i + 1]) : null;
                  const delta = prev !== null ? total - prev : null;
                  return (
                    <tr key={s.snapshot_date}>
                      <td style={{ color: "var(--muted)", fontSize: 13 }}>{s.snapshot_date}</td>
                      <td className="num" style={{ fontWeight: 700 }}>{money(total)}</td>
                      <td className="num" style={{ color: delta === null ? "var(--muted)" : delta >= 0 ? "var(--green)" : "var(--coral)" }}>
                        {delta === null ? "—" : (delta >= 0 ? "+" : "") + money(delta)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="foot">
        Fund balances are sourced from net worth snapshots, updated automatically on each import or review cycle.
        Monthly rate and implied contribution are computed from consecutive snapshot deltas, averaged over the trailing
        period. Projection formula: F(n) = F₀(1+r)ⁿ + C[(1+r)ⁿ−1]/r, where r is the monthly rate and C is the
        monthly contribution. Meera's date of birth is stored in this browser's local storage — re-enter it if you
        use a different browser or clear site data. Past performance is not a reliable indicator of future returns.
      </div>
    </div>
  );
}
