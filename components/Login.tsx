"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function Login() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
      if (error) throw error;
      // onAuthStateChange in AuthGate will swap the view
    } catch (e: any) {
      setMsg(e?.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap" style={{ maxWidth: 420 }}>
      <div className="header"><div className="logo">$<span>MM</span> Money Moves</div></div>
      <p className="sub">Sign in to continue.</p>
      <form className="card" onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <input className="inp" type="email" placeholder="Email" value={email} required onChange={(e) => setEmail(e.target.value)} />
        <input className="inp" type="password" placeholder="Password" value={pw} required minLength={6} onChange={(e) => setPw(e.target.value)} />
        <button className="btn" disabled={busy} type="submit">{busy ? "…" : "Sign in"}</button>
        {msg && <div className="err" style={{ padding: 0, textAlign: "left", fontSize: 13 }}>{msg}</div>}
      </form>
      <p className="foot">Accounts are created in Supabase → Authentication → Users. Public sign-up is disabled.</p>
    </div>
  );
}
