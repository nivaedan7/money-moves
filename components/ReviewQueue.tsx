"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { CATEGORIES } from "@/lib/categories";
import { writeMonthlySnapshot } from "@/lib/netWorthSnapshot";

type Row = {
  id: string;
  date: string;
  description: string;
  amount: number;
  source: string;
  category: string;
  confidence: number | null;
  is_one_off: boolean;
};

type RuleEditor = { rowId: string; pattern: string; saving: boolean };

const money = (n: number) =>
  (n < 0 ? "−" : "+") + "$" + Math.abs(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function guessPattern(description: string): string {
  return (description || "").split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";
}

export default function ReviewQueue() {
  const [rows, setRows] = useState<Row[]>([]);
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [ruleEditor, setRuleEditor] = useState<RuleEditor | null>(null);
  const [oneOffState, setOneOffState] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [snapMsg, setSnapMsg] = useState<string | null>(null);
  const snapshotWritten = useRef(false);
  const patternInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from("transactions")
          .select("id,date,description,amount,source,category,confidence,is_one_off")
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

  useEffect(() => {
    if (ruleEditor) patternInputRef.current?.focus();
  }, [ruleEditor?.rowId]);

  async function recategorise(id: string, category: string) {
    const { error } = await supabase
      .from("transactions")
      .update({ category, confidence: 1, notes: "Reviewed in Review Queue." })
      .eq("id", id);
    if (error) { setErr(error.message); return; }
    setResolved((prev) => {
      const next = { ...prev, [id]: category };
      // If this resolves the last pending item, write a snapshot
      const stillPending = rows.filter((r) => !next[r.id]);
      if (stillPending.length === 0 && !snapshotWritten.current) {
        snapshotWritten.current = true;
        writeMonthlySnapshot().then((result) => {
          if (result.written) {
            setSnapMsg(result.isUpdate
              ? "Queue clear — net worth snapshot updated for this month."
              : "Queue clear — net worth snapshot written for this month.");
          }
        });
      }
      return next;
    });
  }

  function openRuleEditor(row: Row) {
    setRuleEditor({ rowId: row.id, pattern: guessPattern(row.description), saving: false });
    setMsg(null);
  }

  async function confirmRule(row: Row, category: string) {
    if (!ruleEditor || !ruleEditor.pattern.trim()) return;
    setRuleEditor((r) => r && ({ ...r, saving: true }));
    const pattern = ruleEditor.pattern.trim();
    const { error } = await supabase.from("merchant_rules").insert({
      pattern,
      category,
      confidence: 0.95,
      rule_name: "review_" + Date.now(),
      priority: 50,
    });
    if (error) { setErr(error.message); setRuleEditor((r) => r && ({ ...r, saving: false })); return; }
    await recategorise(row.id, category);
    setRuleEditor(null);
    setMsg(`Rule saved: /${pattern}/i → ${category}. Auto-applies on future imports.`);
  }

  async function toggleOneOff(row: Row) {
    const next = !(oneOffState[row.id] ?? row.is_one_off);
    const { error } = await supabase
      .from("transactions")
      .update({ is_one_off: next })
      .eq("id", row.id);
    if (error) { setErr(error.message); return; }
    setOneOffState((s) => ({ ...s, [row.id]: next }));
  }

  if (loading) return <div className="wrap"><div className="loading">Loading review queue…</div></div>;
  if (err) return <div className="wrap"><div className="err">{err}</div></div>;

  const pending = rows.filter((r) => !resolved[r.id]);

  return (
    <div className="wrap">
      <div className="header"><div className="logo">Review <span>Queue</span></div></div>
      <p className="sub">{pending.length} transaction{pending.length === 1 ? "" : "s"} {pending.length === 1 ? "needs" : "need"} a decision — uncategorised or low confidence. Set the category, and for recurring merchants save a rule so it never comes up again.</p>
      {msg && <div className="card" style={{ background: "#d8efe3", color: "var(--green)", marginBottom: 14 }}>{msg}</div>}
      {snapMsg && <div className="card" style={{ background: "#fffbf2", color: "var(--navy)", borderLeft: "3px solid var(--gold)", marginBottom: 14 }}>📸 {snapMsg}</div>}

      {pending.length === 0 ? (
        <div className="card" style={{ background: "#d8efe3", color: "var(--green)" }}>✓ All clear — nothing to review.</div>
      ) : (
        <div className="card" style={{ padding: 6 }}>
          <table>
            <thead>
              <tr><th>Date</th><th>Description</th><th className="num">Amount</th><th>Set category</th><th></th></tr>
            </thead>
            <tbody>
              {pending.map((r) => {
                const cat = choice[r.id] ?? r.category;
                const editorOpen = ruleEditor?.rowId === r.id;
                return (
                  <>
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
                        <button
                          className="link"
                          style={{ marginLeft: 12, color: editorOpen ? "var(--coral)" : "var(--gold)" }}
                          onClick={() => editorOpen ? setRuleEditor(null) : openRuleEditor(r)}
                        >
                          {editorOpen ? "Cancel" : "+ Rule"}
                        </button>
                        {(() => {
                          const isOneOff = oneOffState[r.id] ?? r.is_one_off;
                          return (
                            <button
                              className="link"
                              title="Mark as a large one-off — surfaces on the Dashboard callout"
                              style={{ marginLeft: 12, color: isOneOff ? "var(--coral)" : "var(--muted)", fontWeight: isOneOff ? 700 : 400 }}
                              onClick={() => toggleOneOff(r)}
                            >
                              {isOneOff ? "★ one-off" : "☆ one-off"}
                            </button>
                          );
                        })()}
                      </td>
                    </tr>
                    {editorOpen && (
                      <tr key={r.id + "_rule"} style={{ background: "#fffbf2" }}>
                        <td colSpan={5} style={{ padding: "10px 12px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>PATTERN (regex, case-insensitive)</span>
                            <div style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: "monospace", fontSize: 13, color: "var(--muted)" }}>
                              <span>/</span>
                              <input
                                ref={patternInputRef}
                                className="inp"
                                style={{ padding: "5px 8px", fontSize: 13, fontFamily: "monospace", width: 220 }}
                                value={ruleEditor?.pattern ?? ""}
                                onChange={(e) => setRuleEditor((s) => s && ({ ...s, pattern: e.target.value }))}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") confirmRule(r, cat);
                                  if (e.key === "Escape") setRuleEditor(null);
                                }}
                                placeholder="e.g. netflix"
                              />
                              <span>/i → <b style={{ color: "var(--navy)" }}>{cat}</b></span>
                            </div>
                            <button
                              className="btn"
                              style={{ padding: "6px 14px", fontSize: 13 }}
                              disabled={!ruleEditor?.pattern.trim() || ruleEditor.saving}
                              onClick={() => confirmRule(r, cat)}
                            >
                              {ruleEditor?.saving ? "Saving…" : "Save rule"}
                            </button>
                          </div>
                          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
                            This pattern will auto-categorise matching merchants on every future import. Priority 50 (above built-in rules).
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="foot">
        Saving a category sets that row to high confidence. <b>+ Rule</b> adds a merchant pattern rule to the database
        (priority 50, above built-in rules) so the same merchant is auto-categorised on every future import — this is
        the feedback loop that drives categorisation accuracy over time. <b>★ one-off</b> flags a transaction for the
        Dashboard one-offs callout; unflag by clicking again.
      </div>
    </div>
  );
}
