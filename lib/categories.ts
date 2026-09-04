export const CATEGORIES = [
  // Behavioural — pinned on the Dashboard (the levers you actually move)
  "Groceries",
  "Eating Out",
  "Shopping",
  // Discretionary / tracked
  "Personal Care",
  "Sports & Fitness",
  "Meera Activities",
  "Health",
  "Transport",
  "Travel",
  "Giving",
  "Work Expenses",
  // Fixed / structural
  "Home Utilities",
  "Rent / Mortgage",
  "Insurance",
  "Subscriptions",
  "Investment Property Costs",
  "Meera Childcare",
  // Exceptional
  "Big One-Offs",
  // System
  "Income",
  "Ignore",
  "NEEDS_REVIEW",
] as const;

export type Category = (typeof CATEGORIES)[number];
