"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { CATEGORIES } from "@/lib/categories";

// Categories shown in the budget editor (exclude accounting/meta categories)
const SPEND_CATEGORIES = CATEGORIES.filter(
  (c) => c !== "Income" && c !== "Ignore" && c !== "NEEDS_REVIEW"
);

const money = (n: number) =>
  "$" + Math.abs(n).toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

// ─── Component ────────────────────────────────────────────────────────────────

export default function Settings() {
  const [budgets, setBudgets] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // CSV export state
  const [exportFrom, setExportFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().slice(0, 10);
  });
  const [exportTo, setExportTo] = useState(new Date().toISOString().slice(0, 10));
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("budgets")
        .select("category,monthly_amount");
      if (error) { setErr(error.message); setLoading(false); return; }
      const map: Record<string, number> = {};
      for (const row of (data || []) as { category: string; monthly_amount: string }[]) {
        map[row.category] = Number(row.monthly_amount);
      }
      setBudgets(map);
      setLoading(false);
    })();
  }, []);

  function startEdit(cat: string) {
    setEditing(cat);
    setEditVal(String(budgets[cat] ?? 0));
    setSavedMsg(null);
  }

  async function saveBudget(cat: string) {
    const amount = Number(editVal);
    if (isNaN(amount)) return;
    setSaving(true);
    const { error } = await supabase
      .from("budgets")
      .upsert({ category: cat, monthly_amount: amount }, { onConflict: "category" });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setBudgets((b) => ({ ...b, [cat]: amount }));
    setEditing(null);
    setSavedMsg(`${cat} budget updated to ${money(amount)}/mo`);
    setTimeout(() => setSavedMsg(null), 3000);
  }

  async function exportCSV() {
    setExporting(true);
    const { data, error } = await supabase
      .from("transactions")
      .select("date,description,amount,category,source,confidence,notes")
      .gte("date", exportFrom)
      .lte("date", exportTo)
      .order("date", { ascending: true });
    setExporting(false);
    if (error) { setErr(error.message); return; }
    if (!data || data.length === 0) { setErr("No transactions in that date range."); return; }

    const header = ["date", "description", "amount", "category", "source", "confidence", "notes"];
    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };
    const rows = (data as any[]).map((r) =>
      header.map((h) => escape(r[h])).join(",")
    );
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `moneymoves-${exportFrom}-to-${exportTo}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="wrap"><div className="loading">Loading settings…</div></div>;

  const totalBudget = SPEND_CATEGORIES.reduce((s, c) => s + (budgets[c] ?? 0), 0);

  return (
    <div className="wrap">
      <div className="header"><div className="logo">Set<span>tings</span></div></div>
      <p className="sub">Monthly budgets by category, and data export.</p>

      {err && <div className="card" style={{ background: "#fbdcd3", color: "var(--coral)", marginBottom: 14 }}>{err}</div>}
      {savedMsg && <div className="card" style={{ background: "#d8efe3", color: "var(--green)", marginBottom: 14 }}>{savedMsg}</div>}

      {/* ── Budget editor ──────────────────────────────────────────────────── */}
      <div className="section-title">Monthly budgets</div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th className="num">Monthly budget</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {SPEND_CATEGORIES.map((cat) => {
              const isEditing = editing === cat;
              const val = budgets[cat] ?? 0;
              return (
                <tr key={cat} style={{ background: isEditing ? "#fffbf2" : undefined }}>
                  <td style={{ fontWeight: 600 }}>{cat}</td>
                  <td className="num">
                    {isEditing ? (
                      <input
                        autoFocus
                        type="number"
                        min="0"
                        step="1"
                        value={editVal}
                        onChange={(e) => setEditVal(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveBudget(cat);
                          if (e.key === "Escape") setEditing(null);
                        }}
                        style={{
                          width: 100, textAlign: "right", fontVariantNumeric: "tabular-nums",
                          background: "#fff", border: "1px solid var(--gold)", borderRadius: 8,
                          padding: "4px 8px", fontSize: 14, fontWeight: 600,
                        }}
                      />
                    ) : (
                      <span style={{ color: val === 0 ? "var(--muted)" : "var(--ink)" }}>
                        {val === 0 ? "—" : money(val)}
                      </span>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                    {isEditing ? (
                      <>
                        <button
                          className="link"
                          style={{ color: "var(--green)" }}
                          disabled={saving}
                          onClick={() => saveBudget(cat)}
                        >
                          {saving ? "Saving…" : "Save"}
                        </button>
                        <button
                          className="link"
                          style={{ marginLeft: 10, color: "var(--muted)" }}
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button className="link" onClick={() => startEdit(cat)}>Edit</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{
          padding: "10px 12px", borderTop: "1px solid var(--line)",
          display: "flex", justifyContent: "space-between", fontSize: 13,
        }}>
          <span style={{ color: "var(--muted)", fontWeight: 600 }}>Total monthly budget</span>
          <span style={{ fontWeight: 800, color: "var(--navy)" }}>{money(totalBudget)}</span>
        </div>
      </div>
      <p className="sub" style={{ marginTop: 8 }}>
        Click Edit on any row, type the new amount, then press Enter or Save. Budgets are used in the
        Dashboard behavioural cards and category table.
      </p>

      {/* ── CSV Export ────────────────────────────────────────────────────── */}
      <div className="section-title" style={{ marginTop: 32 }}>Export transactions</div>
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>From</label>
            <input
              type="date"
              className="inp"
              style={{ padding: "7px 10px", fontSize: 13 }}
              value={exportFrom}
              onChange={(e) => setExportFrom(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>To</label>
            <input
              type="date"
              className="inp"
              style={{ padding: "7px 10px", fontSize: 13 }}
              value={exportTo}
              onChange={(e) => setExportTo(e.target.value)}
            />
          </div>
          <button
            className="btn"
            onClick={exportCSV}
            disabled={exporting || !exportFrom || !exportTo}
          >
            {exporting ? "Exporting…" : "Download CSV"}
          </button>
        </div>
        <p style={{ margin: "12px 0 0", fontSize: 12.5, color: "var(--muted)" }}>
          Exports: date · description · amount · category · source · confidence · notes.
          All transactions in range, including Ignore rows — filter in Excel/Sheets as needed.
        </p>
      </div>
    </div>
  );
}
