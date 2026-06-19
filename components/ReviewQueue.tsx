"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { CATEGORIES } from "@/lib/categories";

type Row = {
  id: string;
  date: string;
  description: string;
  amount: number;
  source: string;
  category: string;
  confidence: number | null;
};

const money = (n: number) =>
  (n < 0 ? "-" : "+") + "$" + Math.abs(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ReviewQueue() {
  const [rows, setRows] = useState<Row[]>([]);
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from("transactions")
          .select("id,date,description,amount,source,category,confidence")
          .or("category.eq.NEEDS_REVIEW,confidence.lt.0.8")
          .order("date", { ascending: false })
          .limit(1000);
        if (error) throw error;
        setRows((data as Row[]).map((r) => ({ ...r, amount: Number(r.amount) })));
      } catch (e: any) {
        setErr(e?.message || "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function recategorise(id: string, category: string) {
    const { error } = await supabase
      .from("transactions")
      .update({ category, confidence: 1, notes: "Reviewed in Review Queue." })
      .eq("id", id);
    if (error) { setErr(error.message); return; }
    setResolved((r) => ({ ...r, [id]: category }));
  }

  async function saveAsRule(row: Row, category: string) {
    const guess = (row.description || "").split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";
    const pattern = window.prompt(
      `New rule → "${category}". Pattern (regex, case-insensitive) that should match this merchant:`,
      guess
    );
    if (!pattern) return;
    const { error } = await supabase.from("merchant_rules").insert({
      pattern,
      category,
      confidence: 0.95,
      rule_name: "review_" + Date.now(),
      priority: 50,
    });
    if (error) { setErr(error.message); return; }
    await recategorise(row.id, category);
    setMsg(`Rule saved: /${pattern}/i → ${category}. It’ll auto-apply on future imports.`);
  }

  if (loading) return <div className="wrap"><div className="loading">Loading review queue…</div></div>;
  if (err) return <div className="wrap"><div className="err">{err}</div></div>;

  const pending = rows.filter((r) => !resolved[r.id]);

  return (
    <div className="wrap">
      <div className="header"><div className="logo">Review <span>Queue</span></div></div>
      <p className="sub">{pending.length} transactions need a decision (uncategorised or low confidence). Set a category — and where it’s a recurring merchant, save it as a rule so it never asks again.</p>
      {msg && <div className="card" style={{ background: "#d8efe3", color: "var(--green)", marginBottom: 14 }}>{msg}</div>}

      {pending.length === 0 ? (
        <div className="card" style={{ background: "#d8efe3", color: "var(--green)" }}>✓ All clear — nothing to review.</div>
      ) : (
        <div className="card" style={{ padding: 6 }}>
          <table>
            <thead><tr><th>Date</th><th>Description</th><th className="num">Amount</th><th>Set category</th><th></th></tr></thead>
            <tbody>
              {pending.map((r) => {
                const cat = choice[r.id] ?? r.category;
                return (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{r.date}</td>
                    <td>{r.description} <span className="pill low">{r.source}</span></td>
                    <td className="num">{money(r.amount)}</td>
                    <td>
                      <select className="sel-cat" value={cat} onChange={(e) => setChoice((c) => ({ ...c, [r.id]: e.target.value }))}>
                        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="link" onClick={() => recategorise(r.id, cat)}>Save</button>
                      <button className="link" style={{ marginLeft: 12 }} onClick={() => saveAsRule(r, cat)}>+ rule</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="foot">
        Recategorising sets a row to high confidence. “+ rule” adds a merchant rule to the database (priority 50, above the
        built-in rules) so the same merchant is auto-categorised on every future import — this is the loop that pushes
        accuracy past 95% over time.
      </div>
    </div>
  );
}
