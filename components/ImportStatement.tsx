"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { parseStatement, UnrecognisedStatement } from "@/lib/csv";
import { categoriseWith, DbRule } from "@/lib/rules";
import { CATEGORIES } from "@/lib/categories";
import { writeMonthlySnapshot } from "@/lib/netWorthSnapshot";

type Row = {
  date: string;
  description: string;
  amount: number;
  balance: number | null;
  category: string;
  confidence: number;
  rule: string | null;
};

const money = (n: number) =>
  (n < 0 ? "−" : "+") + "$" + Math.abs(n).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const confTier = (c: number) => (c >= 0.9 ? "high" : c >= 0.7 ? "med" : "low");

export default function ImportStatement() {
  const [filename, setFilename] = useState("");
  const [source, setSource] = useState<"cba" | "ing" | "bom" | "">("");
  const [rows, setRows] = useState<Row[]>([]);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [hideIgnored, setHideIgnored] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setErr(null); setDone(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    const text = await file.text();
    let parsed;
    try {
      parsed = parseStatement(text);
    } catch (e) {
      if (e instanceof UnrecognisedStatement) {
        setErr(`${e.message} First line seen: "${e.firstLine}". Expected one of — ${e.tried.join("; ")}.`);
      } else {
        setErr((e as any)?.message || "Could not read this file.");
      }
      setFilename("");
      return;
    }
    if (parsed.rows.length === 0) {
      setErr(`No transactions found in this ${parsed.source.toUpperCase()} file.`);
      setFilename("");
      return;
    }
    setSource(parsed.source);
    // Load DB-backed merchant rules (ignore-first via priority), fall back to static rules.
    const { data: ruleRows } = await supabase
      .from("merchant_rules")
      .select("pattern,category,confidence,rule_name,priority")
      .eq("active", true)
      .order("priority", { ascending: true });
    const dbRules = (ruleRows || []) as DbRule[];
    setRows(
      parsed.rows.map((r) => {
        const c = categoriseWith(dbRules, r.description, r.amount, parsed.source);
        return { ...r, category: c.category, confidence: c.confidence, rule: c.rule };
      })
    );
  }

  const setCat = (i: number, cat: string) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, category: cat, confidence: 1, rule: "manual" } : r)));

  const visible = useMemo(
    () => rows.map((r, i) => ({ r, i })).filter(({ r }) => (flaggedOnly ? r.confidence < 0.8 : true)).filter(({ r }) => (hideIgnored ? r.category !== "Ignore" : true)),
    [rows, flaggedOnly, hideIgnored]
  );

  const stats = useMemo(() => {
    const spend = rows.filter((r) => r.category !== "Ignore" && r.category !== "Income").reduce((s, r) => s + (r.amount < 0 ? -r.amount : 0), 0);
    const income = rows.filter((r) => r.category === "Income").reduce((s, r) => s + (r.amount > 0 ? r.amount : 0), 0);
    const flagged = rows.filter((r) => r.confidence < 0.8).length;
    return { spend, income, flagged, count: rows.length };
  }, [rows]);

  async function confirmSave() {
    setSaving(true); setErr(null);
    try {
      const dates = rows.map((r) => r.date).sort();
      const start = dates[0];
      const end = dates[dates.length - 1];

      const { data: batch, error: be } = await supabase
        .from("import_batches")
        .insert({ source, filename, transaction_count: rows.length, date_range_start: start, date_range_end: end })
        .select("id")
        .single();
      if (be) throw be;

      const payload = rows.map((r) => ({
        date: r.date,
        description: r.description.slice(0, 200),
        raw_description: r.description.slice(0, 300),
        amount: r.amount,
        balance: r.balance,
        category: r.category,
        confidence: r.confidence,
        source,
        import_id: batch!.id,
        is_annual_commitment: false,
        notes: r.rule === "manual" ? "Manually categorised on import." : null,
      }));

      // Upsert in chunks of 500. The dedup_key trigger + unique index drop any
      // row already imported (same file re-uploaded, or the same transaction in
      // a different statement format), so re-imports insert nothing.
      let inserted = 0;
      for (let i = 0; i < payload.length; i += 500) {
        const { data, error } = await supabase
          .from("transactions")
          .upsert(payload.slice(i, i + 500), { onConflict: "dedup_key", ignoreDuplicates: true })
          .select("id");
        if (error) throw error;
        inserted += data?.length ?? 0;
      }
      const skipped = rows.length - inserted;

      if (inserted === 0) {
        setDone(`Nothing new — all ${rows.length} transaction${rows.length === 1 ? "" : "s"} were already imported.`);
        setRows([]); setFilename(""); setSource(""); setSaving(false);
        return;
      }

      // Write (or overwrite) this month's net worth snapshot
      const closingBalance = rows.findLast((r) => r.balance != null)?.balance ?? null;
      const snapResult = await writeMonthlySnapshot({
        source: source as "cba" | "ing" | "bom",
        closingBalance,
      });

      const snapNote = snapResult.written
        ? snapResult.isUpdate
          ? " Net worth snapshot updated."
          : " Net worth snapshot written."
        : "";

      setDone(
        `Saved ${inserted} transaction${inserted === 1 ? "" : "s"} to the dashboard.` +
        (skipped > 0 ? ` Skipped ${skipped} already-imported duplicate${skipped === 1 ? "" : "s"}.` : "") +
        snapNote
      );
      setRows([]); setFilename(""); setSource("");
    } catch (e: any) {
      setErr(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="wrap">
      <div className="header"><div className="logo">Import <span>Statement</span></div></div>
      <p className="sub">Upload a CBA, ING or Bank of Melbourne CSV. The rule engine categorises known merchants instantly; review the flagged ones, then save.</p>

      {rows.length === 0 && (
        <label className="dropzone" style={{ display: "block", cursor: "pointer" }}>
          <input type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: "none" }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--navy)" }}>Choose a CSV file</div>
          <div style={{ marginTop: 6 }}>CBA, ING or Bank of Melbourne CSV — the format is auto-detected.</div>
        </label>
      )}

      {done && <div className="card" style={{ background: "#d8efe3", color: "var(--green)", marginTop: 16 }}>{done}</div>}
      {err && <div className="err" style={{ textAlign: "left" }}>{err}</div>}

      {rows.length > 0 && (
        <>
          <div className="toolbar">
            <span className="pill high">{source.toUpperCase()}</span>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>{filename}</span>
            <span style={{ fontSize: 13 }}>· {stats.count} txns · spend {money(-stats.spend)} · in {money(stats.income)} · <b>{stats.flagged} flagged</b></span>
            <label style={{ fontSize: 13, marginLeft: "auto" }}><input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} /> Flagged only</label>
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={hideIgnored} onChange={(e) => setHideIgnored(e.target.checked)} /> Hide ignored</label>
          </div>

          <div className="toolbar">
            <button className="btn" disabled={saving} onClick={confirmSave}>{saving ? "Saving…" : `Confirm & save ${rows.length} transactions`}</button>
            <button className="btn ghost" disabled={saving} onClick={() => { setRows([]); setFilename(""); setSource(""); }}>Cancel</button>
          </div>

          <div className="card" style={{ padding: 6 }}>
            <table>
              <thead><tr><th>Date</th><th>Description</th><th className="num">Amount</th><th>Category</th><th>Conf.</th></tr></thead>
              <tbody>
                {visible.map(({ r, i }) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: "nowrap" }}>{r.date}</td>
                    <td>{r.description}</td>
                    <td className="num" style={{ color: r.amount < 0 ? "var(--ink)" : "var(--green)" }}>{money(r.amount)}</td>
                    <td>
                      <select className="sel-cat" value={r.category} onChange={(e) => setCat(i, e.target.value)}>
                        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td><span className={"pill " + confTier(r.confidence)}>{confTier(r.confidence)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="foot">
        Format detection is automatic: ING and Bank of Melbourne files are told apart by their column order
        (<code>Credit,Debit</code> vs <code>Debit,Credit</code>); CBA files by a leading date column with no header
        row. A file that matches nothing, or that parses to mostly $0, is rejected with the line it saw. Amounts are
        stored signed — negative for money out, positive for
        money in. Adjusting a category here sets its confidence to high. Confirming writes an <code>import_batch</code>{" "}
        record and all transactions to Supabase; they appear on the Dashboard immediately.
      </div>
    </div>
  );
}
