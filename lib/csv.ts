// Parse CBA, ING and Bank of Melbourne CSV exports into normalised rows.
// Convention: amount negative = money out, positive = money in.

export type ParsedRow = {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number;
  balance: number | null;
};

export type ParsedFile = {
  source: "cba" | "ing" | "bom";
  rows: ParsedRow[];
};

// Known formats, in the order they are tested. Shown to the user on a no-match.
export const KNOWN_FORMATS = [
  "ING — header Date,Description,Credit,Debit,Balance",
  "Bank of Melbourne — header Date,Description,Debit,Credit,Balance",
  "CBA — no header, rows of Date,Amount,Description",
];

// Thrown when a file matches no known format, or parses to mostly-zero amounts.
// Carries what was detected so the UI can tell the user what to fix.
export class UnrecognisedStatement extends Error {
  firstLine: string;
  tried: string[];
  constructor(message: string, firstLine: string, tried: string[]) {
    super(message);
    this.name = "UnrecognisedStatement";
    this.firstLine = firstLine;
    this.tried = tried;
  }
}

// Minimal CSV line splitter that respects double quotes.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === "," && !inQ) {
      out.push(cur); cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function toISO(d: string): string {
  // expects DD/MM/YYYY
  const m = d.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return d;
  let [, dd, mm, yy] = m;
  if (yy.length === 2) yy = "20" + yy;
  return `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

const num = (s: string) => {
  const v = parseFloat((s || "").replace(/[$,]/g, ""));
  return isNaN(v) ? 0 : v;
};

const isDate = (s: string) => /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(s || "");

export function parseStatement(text: string): ParsedFile {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    throw new UnrecognisedStatement("The file is empty.", "(empty file)", KNOWN_FORMATS);
  }

  const first = lines[0];
  const header = first.toLowerCase();
  const hasHeader = header.includes("date") && header.includes("description");

  // ING and Bank of Melbourne both have Credit + Debit columns; they differ only
  // in column ORDER. ING is Credit-then-Debit, BoM is Debit-then-Credit.
  let source: "cba" | "ing" | "bom";
  let dataStart: number;
  if (hasHeader && header.includes("credit") && header.includes("debit")) {
    source = header.indexOf("credit") < header.indexOf("debit") ? "ing" : "bom";
    dataStart = 1;
  } else if (isDate(first.replace(/^"/, ""))) {
    source = "cba"; // no header — the first line is already a transaction row
    dataStart = 0;
  } else {
    throw new UnrecognisedStatement(
      "This doesn't match any known bank export.", first, KNOWN_FORMATS
    );
  }

  const rows: ParsedRow[] = [];
  for (let i = dataStart; i < lines.length; i++) {
    const c = splitCsvLine(lines[i]);
    if (!isDate(c[0])) continue;

    if (source === "cba") {
      // Date,Amount(signed),Description,Balance
      if (c.length < 3) continue;
      rows.push({ date: toISO(c[0]), description: c[2], amount: num(c[1]), balance: c[3] ? num(c[3]) : null });
    } else if (source === "ing") {
      // Date,Description,Credit,Debit,Balance — debit already signed negative
      if (c.length < 4) continue;
      const credit = num(c[2]); const debit = num(c[3]);
      rows.push({ date: toISO(c[0]), description: c[1], amount: credit !== 0 ? Math.abs(credit) : -Math.abs(debit), balance: c[4] !== undefined ? num(c[4]) : null });
    } else {
      // bom: Date,Description,Debit,Credit,Balance — debit positive = money out
      if (c.length < 4) continue;
      const debit = num(c[2]); const credit = num(c[3]);
      rows.push({ date: toISO(c[0]), description: c[1], amount: credit !== 0 ? Math.abs(credit) : -Math.abs(debit), balance: c[4] !== undefined ? num(c[4]) : null });
    }
  }

  // Zero-amount guard: a wrong column mapping parses many rows as amount 0.
  // Refuse rather than silently saving junk.
  const zeros = rows.filter((r) => r.amount === 0).length;
  if (rows.length > 0 && zeros / rows.length > 0.1) {
    throw new UnrecognisedStatement(
      `Detected ${source.toUpperCase()} but ${zeros} of ${rows.length} rows parsed to $0 — the columns don't line up.`,
      first, KNOWN_FORMATS
    );
  }

  return { source, rows };
}
