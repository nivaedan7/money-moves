"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// The one band at the top of the Dashboard that says, in plain English, where
// this month stands and what to do next. Three states: missing data, review
// outstanding, done. Runs its own three cheap queries — never the full fetch.

const SOURCES: { key: "cba" | "ing" | "bom"; label: string }[] = [
  { key: "cba", label: "CBA" },
  { key: "ing", label: "ING" },
  { key: "bom", label: "Bank of Melbourne" },
];

function monthBounds(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const start = `${ym}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start, next };
}
const monthName = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-AU", { month: "long", year: "numeric" });
};
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short" });

export default function MonthStatus({ month }: { month: string }) {
  const [covered, setCovered] = useState<Set<string> | null>(null);
  const [queue, setQueue] = useState(0);
  const [lastImport, setLastImport] = useState<string | null>(null);

  useEffect(() => {
    if (!month) return;
    let alive = true;
    (async () => {
      const { start, next } = monthBounds(month);
      const [srcRes, qRes, biRes] = await Promise.all([
        supabase.from("transactions").select("source").gte("date", start).lt("date", next),
        supabase.from("transactions").select("id", { count: "exact", head: true }).or("category.eq.NEEDS_REVIEW,confidence.lt.0.8"),
        supabase.from("import_batches").select("created_at").order("created_at", { ascending: false }).limit(1),
      ]);
      if (!alive) return;
      setCovered(new Set<string>((srcRes.data || []).map((r: any) => r.source)));
      setQueue(qRes.count || 0);
      setLastImport(biRes.data?.[0]?.created_at || null);
    })();
    return () => { alive = false; };
  }, [month]);

  if (covered === null) return null;

  const missing = SOURCES.filter((s) => !covered.has(s.key));
  const name = monthName(month);

  let tone: "missing" | "review" | "done";
  let title: string;
  let cta: { href: string; label: string } | null = null;

  if (missing.length > 0) {
    tone = "missing";
    const list = missing.map((s) => s.label).join(", ");
    title = covered.size === 0
      ? `${name}: no statements imported yet — ${list} are all missing.`
      : `${name}: ${list} ${missing.length === 1 ? "is" : "are"} still missing.`;
    cta = { href: "/import", label: "Import" };
  } else if (queue > 0) {
    tone = "review";
    title = `${name}: all three accounts imported. ${queue} transaction${queue === 1 ? "" : "s"} need a decision.`;
    cta = { href: "/review", label: "Review" };
  } else {
    tone = "done";
    title = `${name} is complete. All three accounts imported, nothing to review.${lastImport ? ` Last import ${fmtDate(lastImport)}.` : ""}`;
  }

  const style = {
    missing: { bg: "#fff4e8", border: "var(--coral)", icon: "📥" },
    review: { bg: "#fffbf2", border: "var(--gold)", icon: "📝" },
    done: { bg: "#d8efe3", border: "var(--green)", icon: "✓" },
  }[tone];

  return (
    <div className="card" style={{ background: style.bg, borderLeft: `3px solid ${style.border}`, display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
      <span style={{ fontSize: 18 }}>{style.icon}</span>
      <span style={{ flex: "1 1 240px", fontSize: 14, color: "var(--navy)", fontWeight: 500 }}>{title}</span>
      {cta && (
        <a className="btn" href={cta.href} style={{ padding: "7px 16px", fontSize: 13, textDecoration: "none" }}>{cta.label}</a>
      )}
    </div>
  );
}
