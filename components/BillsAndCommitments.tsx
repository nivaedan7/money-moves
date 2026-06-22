"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { CATEGORIES } from "@/lib/categories";
import type { AnnualCommitment } from "@/lib/supabaseClient";

// ─── Merchant cleaner ────────────────────────────────────────────────────────

const MERCHANT_MAP: [RegExp, string][] = [
  [/netflix/i, "Netflix"],
  [/disney/i, "Disney+"],
  [/foxtel/i, "Foxtel"],
  [/stan\.com|stancomau/i, "Stan"],
  [/spotify|otifyp/i, "Spotify"],
  [/youtube.?premium|youtubepremium/i, "YouTube Premium"],
  [/anthropic|claude\.ai/i, "Claude (Anthropic)"],
  [/amazon.?prime|amznprime/i, "Amazon Prime"],
  [/apple\.?com\/bill|applecom\/bill/i, "Apple"],
  [/aussie.?broadband/i, "Aussie Broadband"],
  [/microsoft.*36/i, "Microsoft 365"],
  [/nintendo/i, "Nintendo"],
  [/zoom\.com|zoom\.us/i, "Zoom"],
  [/strava/i, "Strava"],
  [/google.?one/i, "Google One"],
  [/ring\s*multiplan|ring\.com/i, "Ring"],
];

function cleanMerchant(desc: string): string {
  for (const [re, name] of MERCHANT_MAP) {
    if (re.test(desc)) return name;
  }
  return desc
    .replace(/\s*(pty ltd|p\/l|australia|aust|sydney|melbourne|com\.au|\.com\.au|usa merchant|## usa merchant|limited|ltd)\s*/gi, " ")
    .replace(/\s+/g, " ").trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 40);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const money = (n: number) =>
  "$" + Math.abs(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyRound = (n: number) =>
  "$" + Math.abs(n).toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function addMonths(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

function monthKey(dateStr: string) { return dateStr.slice(0, 7); }

function nextOccurrences(c: AnnualCommitment, months = 13): string[] {
  if (!c.due_date) return [];
  const step = c.frequency === "quarterly" ? 3 : c.frequency === "biannual" ? 6 : 12;
  const dates: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  let d = c.due_date;
  // Rewind if due_date is in the past to find next future date
  while (d < today) d = addMonths(d, step);
  // Collect forward occurrences within the window
  const limit = addMonths(today, months);
  while (d <= limit) {
    dates.push(d);
    d = addMonths(d, step);
  }
  return dates;
}

// ─── Types ───────────────────────────────────────────────────────────────────

type SubTxn = { description: string; amount: number; date: string };
type Sub = { name: string; latestMonthTotal: number; lastDate: string; monthsSeen: number };

function buildSubs(rows: SubTxn[]): Sub[] {
  // Dedup by (cleanedName, date) — keep largest absolute amount
  const byKey = new Map<string, SubTxn>();
  for (const r of rows) {
    const key = cleanMerchant(r.description) + "|" + r.date;
    const ex = byKey.get(key);
    if (!ex || Math.abs(r.amount) > Math.abs(ex.amount)) byKey.set(key, r);
  }

  // Group by (cleanedName, month) → sum
  const byNameMonth = new Map<string, Map<string, number>>();
  const lastDate = new Map<string, string>();
  for (const r of Array.from(byKey.values())) {
    const name = cleanMerchant(r.description);
    const mo = monthKey(r.date);
    if (!byNameMonth.has(name)) byNameMonth.set(name, new Map());
    const mmap = byNameMonth.get(name)!;
    mmap.set(mo, (mmap.get(mo) || 0) + Math.abs(r.amount));
    if (!lastDate.has(name) || r.date > lastDate.get(name)!) lastDate.set(name, r.date);
  }

  // For each merchant, find the most recent month's total
  return Array.from(byNameMonth.entries()).map(([name, mmap]) => {
    const months = Array.from(mmap.keys()).sort();
    const latestMo = months[months.length - 1];
    return {
      name,
      latestMonthTotal: mmap.get(latestMo)!,
      lastDate: lastDate.get(name)!,
      monthsSeen: months.length,
    };
  }).sort((a, b) => b.latestMonthTotal - a.latestMonthTotal);
}

// ─── Empty commitment form ────────────────────────────────────────────────────

const EMPTY_FORM = { name: "", category: "Insurance", amount: "", due_date: "", frequency: "annual", notes: "" };

// ─── Component ───────────────────────────────────────────────────────────────

export default function BillsAndCommitments() {
  const [subs, setSubs] = useState<Sub[]>([]);
  const [commitments, setCommitments] = useState<AnnualCommitment[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const today = new Date();
      const threeMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 3, 1).toISOString().slice(0, 10);
      const [subRes, commitRes] = await Promise.all([
        supabase
          .from("transactions")
          .select("description,amount,date")
          .eq("category", "Subscriptions")
          .gte("date", threeMonthsAgo)
          .order("date", { ascending: false }),
        supabase
          .from("annual_commitments")
          .select("*")
          .order("due_date", { ascending: true }),
      ]);
      if (subRes.error) throw subRes.error;
      if (commitRes.error) throw commitRes.error;
      setSubs(buildSubs((subRes.data || []) as SubTxn[]));
      setCommitments(((commitRes.data || []) as AnnualCommitment[]).map((c) => ({
        ...c,
        amount: Number(c.amount),
      })));
    } catch (e: any) {
      setErr(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function addCommitment(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.amount) return;
    setSaving(true);
    const { error } = await supabase.from("annual_commitments").insert({
      name: form.name,
      category: form.category,
      amount: Number(form.amount),
      due_date: form.due_date || null,
      frequency: form.frequency,
      notes: form.notes || null,
      is_paid: false,
    });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setForm(EMPTY_FORM);
    setShowForm(false);
    await load();
  }

  async function togglePaid(c: AnnualCommitment) {
    const { error } = await supabase
      .from("annual_commitments")
      .update({ is_paid: !c.is_paid, paid_date: !c.is_paid ? new Date().toISOString().slice(0, 10) : null })
      .eq("id", c.id);
    if (error) { setErr(error.message); return; }
    setCommitments((cs) => cs.map((x) => x.id === c.id ? { ...x, is_paid: !c.is_paid } : x));
  }

  async function deleteCommitment(id: string) {
    const { error } = await supabase.from("annual_commitments").delete().eq("id", id);
    if (error) { setErr(error.message); return; }
    setCommitments((cs) => cs.filter((x) => x.id !== id));
  }

  if (loading) return <div className="wrap"><div className="loading">Loading bills…</div></div>;
  if (err) return <div className="wrap"><div className="err">{err}</div></div>;

  const today = new Date().toISOString().slice(0, 10);
  const nextDue = commitments.find((c) => !c.is_paid && c.due_date && c.due_date >= today);
  const subsMonthly = subs.reduce((s, x) => s + x.latestMonthTotal, 0);

  // Build heavy months — next 13 months
  const heavyMonths: { key: string; label: string; total: number; items: { name: string; amount: number }[] }[] = [];
  for (let i = 0; i < 13; i++) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + i);
    const key = d.toISOString().slice(0, 7);
    const label = MONTH_NAMES[d.getMonth()] + " " + d.getFullYear();
    heavyMonths.push({ key, label, total: 0, items: [] });
  }
  for (const c of commitments) {
    if (c.is_paid) continue;
    for (const occ of nextOccurrences(c, 13)) {
      const k = monthKey(occ);
      const slot = heavyMonths.find((m) => m.key === k);
      if (slot) { slot.total += c.amount; slot.items.push({ name: c.name, amount: c.amount }); }
    }
  }
  const maxHeavy = Math.max(1, ...heavyMonths.map((m) => m.total));

  return (
    <div className="wrap">
      <div className="header"><div className="logo">Bills &amp; <span>Commitments</span></div></div>
      <p className="sub">Monthly subscriptions from your transactions, plus annual and irregular commitments.</p>

      {/* ── Monthly Subscriptions ────────────────────────────────────────── */}
      <div className="section-title">Monthly subscriptions — last 3 months</div>
      <div className="card" style={{ padding: 6 }}>
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th className="num">Latest month</th>
              <th className="num">Last charged</th>
              <th className="num">Months seen</th>
            </tr>
          </thead>
          <tbody>
            {subs.map((s) => (
              <tr key={s.name}>
                <td style={{ fontWeight: 600 }}>{s.name}</td>
                <td className="num">{money(s.latestMonthTotal)}</td>
                <td className="num" style={{ color: "var(--muted)" }}>{s.lastDate}</td>
                <td className="num">
                  <span className={"pill " + (s.monthsSeen >= 2 ? "high" : "med")}>
                    {s.monthsSeen >= 2 ? `${s.monthsSeen}× monthly` : "1× (annual?)"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: "10px 12px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <span style={{ color: "var(--muted)" }}>Estimated monthly total</span>
          <span style={{ fontWeight: 800, color: "var(--navy)" }}>{money(subsMonthly)}</span>
        </div>
      </div>
      <p className="sub" style={{ marginTop: 8 }}>
        Grouped by merchant. "Latest month" is the total for the most recent month that merchant was charged.
        Annual subscriptions show as 1×.
      </p>

      {/* ── Annual Commitments ───────────────────────────────────────────── */}
      <div className="section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Annual &amp; irregular commitments</span>
        <button className="link" style={{ fontSize: 13, fontWeight: 700 }} onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ Add"}
        </button>
      </div>

      {nextDue && (
        <div className="card next-due" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--navy)", letterSpacing: ".5px", textTransform: "uppercase" }}>Next due</div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            <span style={{ fontWeight: 700 }}>{nextDue.name}</span>
            <span style={{ fontWeight: 800 }}>{money(nextDue.amount)}</span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--navy)", opacity: 0.7, marginTop: 2 }}>
            {nextDue.due_date} · {nextDue.frequency}
          </div>
        </div>
      )}

      {showForm && (
        <form className="card" onSubmit={addCommitment} style={{ marginBottom: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
            <input className="inp" placeholder="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="inp" type="number" placeholder="Amount $" required min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <input className="inp" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            <select className="inp" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
              <option value="annual">Annual</option>
              <option value="quarterly">Quarterly</option>
              <option value="biannual">Biannual</option>
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 8 }}>
            <input className="inp" placeholder="Notes (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <select className="inp" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.filter((c) => c !== "NEEDS_REVIEW" && c !== "Ignore" && c !== "Income").map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button className="btn" type="submit" disabled={saving} style={{ whiteSpace: "nowrap" }}>
              {saving ? "Saving…" : "Add commitment"}
            </button>
          </div>
        </form>
      )}

      <div className="card" style={{ padding: 0 }}>
        {commitments.length === 0 ? (
          <div style={{ padding: "20px 18px", color: "var(--muted)", fontSize: 14 }}>No commitments yet — add one above.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th className="num">Amount</th>
                <th>Due</th>
                <th>Freq</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {commitments.map((c) => (
                <tr key={c.id} style={{ opacity: c.is_paid ? 0.45 : 1 }}>
                  <td>
                    <span style={{ fontWeight: 600, textDecoration: c.is_paid ? "line-through" : "none" }}>{c.name}</span>
                    {c.notes && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{c.notes}</div>}
                  </td>
                  <td style={{ fontSize: 12.5, color: "var(--muted)" }}>{c.category}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{money(c.amount)}</td>
                  <td style={{ whiteSpace: "nowrap", fontSize: 13 }}>{c.due_date || "—"}</td>
                  <td><span className="pill med" style={{ fontSize: 11 }}>{c.frequency}</span></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="link" onClick={() => togglePaid(c)} style={{ color: c.is_paid ? "var(--muted)" : "var(--green)" }}>
                      {c.is_paid ? "Unmark" : "✓ Paid"}
                    </button>
                    <button className="link" style={{ marginLeft: 10, color: "var(--coral)" }} onClick={() => { if (confirm(`Delete "${c.name}"?`)) deleteCommitment(c.id); }}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Heavy Months ─────────────────────────────────────────────────── */}
      <div className="section-title" style={{ marginTop: 32 }}>Heavy months — next 13 months</div>
      <p className="sub">Projected annual &amp; irregular commitment spend by month, so you can plan cashflow.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
        {heavyMonths.map((m) => {
          const isNow = m.key === today.slice(0, 7);
          const intensity = m.total / maxHeavy;
          const bg = m.total === 0 ? "var(--card)" : `rgba(232, 146, 42, ${0.08 + intensity * 0.62})`;
          return (
            <div key={m.key} className="card" style={{ background: bg, border: isNow ? "2px solid var(--gold)" : undefined, padding: "12px 14px" }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "var(--navy)", marginBottom: 4 }}>
                {m.label}{isNow && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--gold)", fontWeight: 800 }}>THIS MONTH</span>}
              </div>
              {m.items.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Nothing due</div>
              ) : (
                <>
                  {m.items.map((it, i) => (
                    <div key={i} style={{ fontSize: 12, display: "flex", justifyContent: "space-between", gap: 4, marginBottom: 2 }}>
                      <span style={{ color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
                      <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{moneyRound(it.amount)}</span>
                    </div>
                  ))}
                  <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(0,0,0,0.08)", fontWeight: 800, fontSize: 13, textAlign: "right", color: "var(--navy)" }}>
                    {moneyRound(m.total)}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="foot">
        Subscriptions are detected from transactions categorised as Subscriptions in the last 3 months.
        Commitments are manually maintained — add, mark paid, and delete as bills land.
        The heavy-months grid projects each commitment's next occurrence forward so you can see cashflow pressure ahead.
      </div>
    </div>
  );
}
