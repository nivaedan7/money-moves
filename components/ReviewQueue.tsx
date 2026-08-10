"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

type Group = { key: string; label: string; rows: Row[]; total: number };
type RuleEditor = { key: string; pattern: string; saving: boolean };

const money = (n: number) =>
  (n < 0 ? "−" : "+") + "$" + Math.abs(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Collapse a bank description to a stable merchant key: letters only, first 16
// chars. This merges the two formats the banks use for the same merchant —
// "MONKI 3 PTY LTD  Burwood East" and "Monki3PtyLtdBurwoodEast" both become
// "monkiptyltdburwo" — so repeat merchants cluster into one group.
function merchantKey(desc: string): string {
  return (desc || "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 16) || "misc";
}

// Guess a regex pattern for a rule from a description: drop digits, split
// camelCase and punctuation into words, take the first word of 3+ letters.
function guessPattern(desc: string): string {
  const words = (desc || "")
    .replace(/[0-9]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z ]/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  return (words[0] || "").toLowerCase();
}

// The most human-readable description in a cluster (prefer the spaced format).
function representative(rows: Row[]): string {
  return rows
    .map((r) => r.description || "")
    .sort((a, b) => (b.split(" ").length - a.split(" ").length) || (b.length - a.length))[0] || "(no description)";
}

export default function ReviewQueue() {
  const [rows, setRows] = useState<Row[]>([]);
  const [resolved, setResolved] = useState<Record<string, boolean>>({});
  const [groupCat, setGroupCat] = useState<Record<string, string>>({});
  const [rowCat, setRowCat] = useState<Record<string, string>>({});
  const [ruleEditor, setRuleEditor] = useState<RuleEditor | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [oneOffState, setOneOffState] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
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
  }, [ruleEditor?.key]);

  const pending = useMemo(() => rows.filter((r) => !resolved[r.id]), [rows, resolved]);

  // Split into repeat-merchant groups (2+) and true singletons.
  const { groups, singles } = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of pending) {
      const k = merchantKey(r.description);
      (map.get(k) ?? map.set(k, []).get(k)!).push(r);
    }
    const all: Group[] = Array.from(map.entries()).map(([key, rs]) => ({
      key,
      label: representative(rs),
      rows: rs,
      total: rs.reduce((s, r) => s + r.amount, 0),
    }));
    const groups = all
      .filter((g) => g.rows.length >= 2)
      .sort((a, b) => b.rows.length - a.rows.length || Math.abs(b.total) - Math.abs(a.total));
    const singles = all
      .filter((g) => g.rows.length === 1)
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
    return { groups, singles };
  }, [pending]);

  function markResolved(ids: string[]) {
    setResolved((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = true;
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

  async function applyCategory(ids: string[], category: string, busyKey: string) {
    if (!category || category === "NEEDS_REVIEW") { setErr("Pick a real category first."); return; }
    setErr(null);
    setBusy((b) => ({ ...b, [busyKey]: true }));
    const { error } = await supabase
      .from("transactions")
      .update({ category, confidence: 1, notes: "Reviewed in Review Queue." })
      .in("id", ids);
    setBusy((b) => ({ ...b, [busyKey]: false }));
    if (error) { setErr(error.message); return; }
    markResolved(ids);
    setMsg(`${ids.length} transaction${ids.length === 1 ? "" : "s"} → ${category}.`);
  }

  async function saveRuleAndApply(g: Group, category: string) {
    if (!ruleEditor || !ruleEditor.pattern.trim()) return;
    if (!category || category === "NEEDS_REVIEW") { setErr("Pick a real category first."); return; }
    const pattern = ruleEditor.pattern.trim();
    setRuleEditor((r) => r && ({ ...r, saving: true }));
    const { error } = await supabase.from("merchant_rules").insert({
      pattern, category, confidence: 0.95, rule_name: "review_" + Date.now(), priority: 50,
    });
    if (error) { setErr(error.message); setRuleEditor((r) => r && ({ ...r, saving: false })); return; }
    setRuleEditor(null);
    await applyCategory(g.rows.map((r) => r.id), category, g.key);
    setMsg(`Rule /${pattern}/i → ${category}, applied to ${g.rows.length}. Future imports auto-match.`);
  }

  async function toggleOneOff(row: Row) {
    const next = !(oneOffState[row.id] ?? row.is_one_off);
    const { error } = await supabase.from("transactions").update({ is_one_off: next }).eq("id", row.id);
    if (error) { setErr(error.message); return; }
    setOneOffState((s) => ({ ...s, [row.id]: next }));
  }

  if (loading) return <div className="wrap"><div className="loading">Loading review queue…</div></div>;
  if (err && rows.length === 0) return <div className="wrap"><div className="err">{err}</div></div>;

  const groupedCount = groups.reduce((s, g) => s + g.rows.length, 0);

  return (
    <div className="wrap">
      <div className="header"><div className="logo">Review <span>Queue</span></div></div>
      <p className="sub">
        {pending.length} transaction{pending.length === 1 ? "" : "s"} to categorise — grouped by merchant so you can
        clear repeats in one move. Set a category for a whole group, and save a rule to auto-match it on every future import.
      </p>
      {err && <div className="err" style={{ textAlign: "left", marginBottom: 14 }}>{err}</div>}
      {msg && <div className="card" style={{ background: "#d8efe3", color: "var(--green)", marginBottom: 14 }}>{msg}</div>}
      {snapMsg && <div className="card" style={{ background: "#fffbf2", color: "var(--navy)", borderLeft: "3px solid var(--gold)", marginBottom: 14 }}>📸 {snapMsg}</div>}

      {pending.length === 0 ? (
        <div className="card" style={{ background: "#d8efe3", color: "var(--green)" }}>✓ All clear — nothing to review.</div>
      ) : (
        <>
          {groups.length > 0 && (
            <>
              <div className="section-title">Repeat merchants — {groups.length} groups, {groupedCount} transactions</div>
              {groups.map((g) => {
                const cat = groupCat[g.key] ?? "NEEDS_REVIEW";
                const editorOpen = ruleEditor?.key === g.key;
                const isOpen = expanded[g.key];
                return (
                  <div key={g.key} className="card" style={{ marginBottom: 10, padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: "var(--navy)", overflow: "hidden", textOverflow: "ellipsis" }}>{g.label}</div>
                        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
                          {g.rows.length} txns · total {money(g.total)}
                          <button className="link" style={{ marginLeft: 8 }} onClick={() => setExpanded((e) => ({ ...e, [g.key]: !isOpen }))}>
                            {isOpen ? "hide" : "show rows"}
                          </button>
                        </div>
                      </div>
                      <select className="sel-cat" value={cat} onChange={(e) => setGroupCat((c) => ({ ...c, [g.key]: e.target.value }))}>
                        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <button className="btn" style={{ padding: "7px 14px", fontSize: 13 }} disabled={busy[g.key]}
                        onClick={() => applyCategory(g.rows.map((r) => r.id), cat, g.key)}>
                        {busy[g.key] ? "…" : `Apply to ${g.rows.length}`}
                      </button>
                      <button className="link" style={{ color: editorOpen ? "var(--coral)" : "var(--gold)" }}
                        onClick={() => editorOpen ? setRuleEditor(null) : setRuleEditor({ key: g.key, pattern: guessPattern(g.label), saving: false })}>
                        {editorOpen ? "Cancel" : "＋ Rule"}
                      </button>
                    </div>

                    {editorOpen && (
                      <div style={{ marginTop: 10, padding: "10px 12px", background: "#fffbf2", borderRadius: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>PATTERN (regex, case-insensitive)</span>
                          <div style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: "monospace", fontSize: 13, color: "var(--muted)" }}>
                            <span>/</span>
                            <input ref={patternInputRef} className="inp"
                              style={{ padding: "5px 8px", fontSize: 13, fontFamily: "monospace", width: 200 }}
                              value={ruleEditor?.pattern ?? ""}
                              onChange={(e) => setRuleEditor((s) => s && ({ ...s, pattern: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === "Enter") saveRuleAndApply(g, cat); if (e.key === "Escape") setRuleEditor(null); }}
                              placeholder="e.g. monki" />
                            <span>/i → <b style={{ color: "var(--navy)" }}>{cat}</b></span>
                          </div>
                          <button className="btn" style={{ padding: "6px 14px", fontSize: 13 }}
                            disabled={!ruleEditor?.pattern.trim() || ruleEditor.saving || cat === "NEEDS_REVIEW"}
                            onClick={() => saveRuleAndApply(g, cat)}>
                            {ruleEditor?.saving ? "Saving…" : `Save rule & apply to ${g.rows.length}`}
                          </button>
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
                          Saves a priority-50 merchant rule (above the built-ins) so this merchant is auto-categorised on every future import.
                        </div>
                      </div>
                    )}

                    {isOpen && (
                      <table style={{ marginTop: 10 }}>
                        <tbody>
                          {g.rows.map((r) => {
                            const isOneOff = oneOffState[r.id] ?? r.is_one_off;
                            return (
                              <tr key={r.id}>
                                <td style={{ whiteSpace: "nowrap", fontSize: 12.5 }}>{r.date}</td>
                                <td style={{ fontSize: 12.5 }}>{r.description} <span className="pill low">{r.source}</span></td>
                                <td className="num" style={{ fontSize: 12.5 }}>{money(r.amount)}</td>
                                <td style={{ whiteSpace: "nowrap" }}>
                                  <button className="link" title="Mark as a large one-off — surfaces on the Dashboard callout"
                                    style={{ color: isOneOff ? "var(--coral)" : "var(--muted)", fontWeight: isOneOff ? 700 : 400 }}
                                    onClick={() => toggleOneOff(r)}>
                                    {isOneOff ? "★ one-off" : "☆ one-off"}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {singles.length > 0 && (
            <>
              <div className="section-title" style={{ marginTop: groups.length ? 28 : 0 }}>Individual transactions — {singles.length}</div>
              <div className="card" style={{ padding: 6 }}>
                <table>
                  <thead>
                    <tr><th>Date</th><th>Description</th><th className="num">Amount</th><th>Set category</th><th></th></tr>
                  </thead>
                  <tbody>
                    {singles.map((g) => {
                      const r = g.rows[0];
                      const cat = rowCat[r.id] ?? r.category;
                      const isOneOff = oneOffState[r.id] ?? r.is_one_off;
                      return (
                        <tr key={r.id}>
                          <td style={{ whiteSpace: "nowrap" }}>{r.date}</td>
                          <td>{r.description} <span className="pill low">{r.source}</span></td>
                          <td className="num">{money(r.amount)}</td>
                          <td>
                            <select className="sel-cat" value={cat} onChange={(e) => setRowCat((c) => ({ ...c, [r.id]: e.target.value }))}>
                              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <button className="link" onClick={() => applyCategory([r.id], cat, r.id)}>Save</button>
                            <button className="link" title="Mark as a large one-off — surfaces on the Dashboard callout"
                              style={{ marginLeft: 12, color: isOneOff ? "var(--coral)" : "var(--muted)", fontWeight: isOneOff ? 700 : 400 }}
                              onClick={() => toggleOneOff(r)}>
                              {isOneOff ? "★ one-off" : "☆ one-off"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      <div className="foot">
        Transactions are grouped by merchant so repeats clear together. <b>Apply to N</b> sets the category for the whole
        group; <b>＋ Rule</b> also saves a merchant pattern (priority 50, above the built-in rules) so the same merchant is
        auto-categorised on every future import — the feedback loop that keeps this queue short over time.
        <b> ★ one-off</b> flags a transaction for the Dashboard one-offs callout.
      </div>
    </div>
  );
}
