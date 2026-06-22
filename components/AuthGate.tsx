"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import Login from "./Login";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

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
          <a href="/bills">Bills</a>
          <a href="/import">Import</a>
          <a href="/review">Review</a>
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
