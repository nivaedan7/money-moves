// Parse CBA and ING CSV exports into normalised rows.
// Convention: amount negative = money out, positive = money in.

export type ParsedRow = {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number;
  balance: number | null;
};

export type ParsedFile = {
  source: "cba" | "ing";
  rows: ParsedRow[];
};

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

export function parseStatement(text: string): ParsedFile {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { source: "cba", rows: [] };

  const header = lines[0].toLowerCase();
  const isIng = header.includes("credit") && header.includes("debit");

  if (isIng) {
    // Date,Description,Credit,Debit,Balance
    const rows: ParsedRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const c = splitCsvLine(lines[i]);
      if (c.length < 4 || !/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(c[0])) continue;
      const credit = num(c[2]);
      const debit = num(c[3]);
      const amount = credit !== 0 ? Math.abs(credit) : -Math.abs(debit);
      rows.push({ date: toISO(c[0]), description: c[1], amount, balance: c[4] !== undefined ? num(c[4]) : null });
    }
    return { source: "ing", rows };
  }

  // CBA: no header. Date,Amount(signed),Description,Balance
  const rows: ParsedRow[] = [];
  for (const ln of lines) {
    const c = splitCsvLine(ln);
    if (c.length < 3 || !/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(c[0])) continue;
    rows.push({ date: toISO(c[0]), description: c[2], amount: num(c[1]), balance: c[3] ? num(c[3]) : null });
  }
  return { source: "cba", rows };
}
