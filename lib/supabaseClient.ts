import { createClient } from "@supabase/supabase-js";

// The Supabase URL + publishable key are read from the environment. They are
// required — no hardcoded fallback ships in the bundle. Set both in .env.local
// (local) and the Vercel project (production); a missing var fails the build
// loudly rather than silently shipping a literal key.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY — set both in .env.local and the Vercel project."
  );
}

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
  is_one_off: boolean;
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
