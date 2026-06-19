import { createClient } from "@supabase/supabase-js";

// Supabase publishable key is safe to ship to the browser — data is protected by
// Row Level Security + the auth gate. Env vars win if set (local dev / Vercel),
// otherwise fall back to the project defaults so production builds always work.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://weoaakhlcllcjfzupjsj.supabase.co";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_lfKI1pU8RKJSVOxRo3hv0g_CDON3CSX";

export const supabase = createClient(url, key);

export type Transaction = {
  id: string;
  date: string; // YYYY-MM-DD
  description: string | null;
  raw_description: string | null;
  amount: number;
  balance: number | null;
  category: string;
  confidence: number | null;
  source: "cba" | "ing" | "bom";
  is_annual_commitment: boolean;
  notes: string | null;
};

export type Budget = { category: string; monthly_amount: number };

export type MerchantRule = {
  id: string;
  pattern: string;
  category: string;
  confidence: number;
  rule_name: string | null;
  priority: number;
  active: boolean;
};

export type AnnualCommitment = {
  id: string;
  name: string;
  category: string;
  amount: number;
  due_date: string | null;
  frequency: string;
  notes: string | null;
  is_paid: boolean;
};
