"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import Login from "./Login";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [reviewCount, setReviewCount] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Persistent "not done yet" signal: a red count on the Review link whenever
  // anything is uncategorised or low-confidence.
  useEffect(() => {
    if (!session) { setReviewCount(0); return; }
    supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .or("category.eq.NEEDS_REVIEW,confidence.lt.0.8")
      .then(({ count }) => setReviewCount(count || 0));
  }, [session]);

  if (session === undefined)
    return <div className="wrap"><div className="loading">Loading…</div></div>;

  if (!session) return <Login />;

  return (
    <>
      <nav className="nav">
        <div className="nav-inner">
          <span className="nav-logo">$<b>MM</b></span>
          <a href="/">Dashboard</a>
          <a href="/salary">Salary</a>
          <a href="/outlook">Outlook</a>
          <a href="/networth">Net Worth</a>
          <a href="/meera">Meera</a>
          <a href="/bills">Bills</a>
          <a href="/import">Import</a>
          <a href="/review">
            Review
            {reviewCount > 0 && (
              <span style={{ marginLeft: 5, background: "var(--coral)", color: "#fff", borderRadius: 9, padding: "1px 6px", fontSize: 11, fontWeight: 700, verticalAlign: "middle" }}>{reviewCount}</span>
            )}
          </a>
          <a href="/settings">Settings</a>
          <button className="link" style={{ marginLeft: "auto", color: "#cdd8e2" }} onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </nav>
      {children}
    </>
  );
}
