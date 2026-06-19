"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function Login() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [mode, setMode] = useState<"in" | "up">("in");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
        if (error) throw error;
        // onAuthStateChange in AuthGate will swap the view
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password: pw });
        if (error) throw error;
        if (!data.session) setMsg("Account created. If email confirmation is on, confirm it (or auto-confirm the user in Supabase → Authentication → Users), then sign in.");
      }
    } catch (e: any) {
      setMsg(e?.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap" style={{ maxWidth: 420 }}>
      <div className="header"><div className="logo">$<span>MM</span> Money Moves</div></div>
      <p className="sub">{mode === "in" ? "Sign in to continue." : "Create your account."}</p>
      <form className="card" onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <input className="inp" type="email" placeholder="Email" value={email} required onChange={(e) => setEmail(e.target.value)} />
        <input className="inp" type="password" placeholder="Password" value={pw} required minLength={6} onChange={(e) => setPw(e.target.value)} />
        <button className="btn" disabled={busy} type="submit">{busy ? "…" : mode === "in" ? "Sign in" : "Sign up"}</button>
        {msg && <div className="err" style={{ padding: 0, textAlign: "left", fontSize: 13 }}>{msg}</div>}
        <button type="button" className="link" onClick={() => { setMode(mode === "in" ? "up" : "in"); setMsg(null); }}>
          {mode === "in" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
