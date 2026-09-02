// MoneyMoves rule engine (ported from the statement-ingestion analysis).
// First match wins; Ignore/transfer rules fire first. Tested against the raw
// bank description (case-insensitive). Returns category + confidence (0..1).

type Rule = { re: RegExp; category: string; conf: number; name: string };

const R: Rule[] = [
  // ---- IGNORE (internal transfers, card payments, reversals, intl fees) ----
  { re: /payment received|thank ?you/i, category: "Ignore", conf: 0.99, name: "ignore_cc_payment" },
  { re: /internal transfer|ingtoing|to orange everyday|to meera ?bom|meera ?pearler|creditcard(may|april|march|june|july)/i, category: "Ignore", conf: 0.97, name: "ignore_transfer" },
  { re: /force post no funds|reversal direct debit/i, category: "Ignore", conf: 0.95, name: "ignore_reversal" },
  { re: /intnl transaction fee|international transaction fee/i, category: "Ignore", conf: 0.95, name: "ignore_intnl_fee" },
  // ---- INCOME ----
  { re: /\bdverve\b|\bnverve\b|verve.*(salary|pay)|osko.*(salary|deposit)|praseetha|soman rent|\bato\b|tax refund|cashback/i, category: "Income", conf: 0.85, name: "income" },
  // ---- WORK (GP) ----
  { re: /verve family doctors|\bahpra\b|heidi ?health|gocardless|\bdpm\b|\bavant\b/i, category: "Work Expenses", conf: 0.85, name: "work" },
  // ---- MEERA ----
  { re: /green ?leaves/i, category: "Meera Childcare", conf: 0.97, name: "meera_childcare" },
  { re: /swimworld|shichida|\brsgk\b|gymnastics|rainbow ?town|flip ?out|bounce|baby ?bunting|shoes ?& ?sox|toy ?waverley/i, category: "Meera Activities", conf: 0.85, name: "meera_activities" },
  // ---- SPORTS & FITNESS ----
  { re: /level ?up ?pickleball|glenpickle|bodyfit|aqualink|gym ?plus|monash aquatic|coreplus|\brevo\b|zwift/i, category: "Sports & Fitness", conf: 0.92, name: "sport" },
  // ---- INSURANCE ----
  { re: /racv|aust ?unity|pps ?mutual|ambulance/i, category: "Insurance", conf: 0.88, name: "insurance" },
  // ---- SUBSCRIPTIONS ----
  { re: /netflix|spotify|disney|\bstan\b|youtube|google ?one|amazon ?prime|amznprime|apple\.com|apple ?com|microsoft|nintendo|aussie ?broadband|belong|\bzoom\b|strava|claude|anthropic|ring ?multiplan|blinkist/i, category: "Subscriptions", conf: 0.9, name: "subscriptions" },
  // ---- GIVING ----
  { re: /effective ?alt|\bace\b|st ?john ?ambul|red ?cross|oxfam/i, category: "Giving", conf: 0.7, name: "giving" },
  // ---- FUEL & CAR ----
  { re: /reddy ?express|coles ?express|\bshell\b|7-?eleven|\bbp\b|ampol|caltex|vicroads|autoservice|ask ?auto|\bmyki\b|parking|linkt ?rego/i, category: "Fuel & Car", conf: 0.85, name: "fuel_car" },
  // ---- TOLLS ----
  { re: /\blinkt\b|eastlink|citylink/i, category: "Tolls", conf: 0.95, name: "tolls" },
  // ---- INVESTMENT PROPERTY ----
  { re: /state revenue office|land tax|maroondah|kingston city council|yarra valley w(a)?t(er)?/i, category: "Investment Property Costs", conf: 0.85, name: "inv_property" },
  // ---- HOME UTILITIES ----
  { re: /\bagl\b|origin energy|energy ?australia|red ?energy|alinta/i, category: "Home Utilities", conf: 0.9, name: "utilities" },
  // ---- HEALTH ----
  { re: /chemist ?warehouse|\bamcal\b|pharmacy|pharmac\b|healthlink|\bopsm\b|physio|kin ?fertility|medical ?lane/i, category: "Health", conf: 0.88, name: "health" },
  // ---- TRAVEL ----
  { re: /interglobe|indigo|\beih\b|reliance (retail|trends)|indian ?hotels|indianvisa|department ?of ?immigrat|travel ?money|melbourne ?airport|qantas|jetstar|virgin australia|hotel|airbnb/i, category: "Travel", conf: 0.8, name: "travel" },
  // ---- GROCERIES ----
  { re: /\bcoles\b|woolworth|\baldi\b|\biga\b|costco|poultry ?one|h ?and ?k ?meats|bakers ?delight|liquorland|dan ?murphy|\bbws\b/i, category: "Groceries", conf: 0.93, name: "groceries" },
  // ---- EATING OUT ----
  { re: /mcdonald|domino|doordash|uber ?eats|uber\*eats|nando|mad ?mex|guzman|soul ?origin|subway|\bkfc\b|sushi|seoul ?garden|katsuyaku|babaji|kerala|bombay|urban ?alley|hecho|laksa|hotpot|bbq ?king|straits|cafe|caffe|coffee|brunetti|pidapipo|gelat|cheesecake|krispy ?kreme|ben ?& ?jerry|boost ?juice|burger ?king|gami|ichiro|pancake|muffin ?break|shingle ?inn|foster ?& ?black|mopa|marrybrown|schnitz|yo-?chi|good ?daze|merchant society/i, category: "Eating Out", conf: 0.82, name: "eating_out" },
  // ---- SHOPPING (catch-all discretionary retail & leisure) ----
  { re: /\bkmart|\btarget|\bbig ?w|reject ?shop|\bdaiso|officeworks|bunnings|\bikea|spotlight|pillow ?talk|tk ?maxx|smiggle|games ?world|matchbox|\bcex\b|\bjb ?hi-?fi|99 ?bikes|\brebel\b|ausport|snowys|anaconda|cotton ?on|lovisa|sunglass ?hut|amazon|muji|\bmammut|westfield|hoyts|ticketek|ticketmaster|rod ?laver|sea ?life|\bzoo\b|skydeck|puffing ?billy|museum|post ?shop|australia ?post|pet ?circle|wilson ?parking/i, category: "Shopping", conf: 0.8, name: "shopping" },
];

export type CatResult = { category: string; confidence: number; rule: string | null };

export type DbRule = { pattern: string; category: string; confidence: number; rule_name: string | null; priority: number };

// Amount sanity check: a transaction far outside its category's normal range is
// probably mis-matched (e.g. a $72k car purchase that a rule sent to Rent /
// Mortgage). Downgrade its confidence below the review threshold so a human
// looks — never override the category. Thresholds reflect what each category
// legitimately reaches; discretionary categories are capped low.
function amountThreshold(category: string): number {
  switch (category) {
    case "Rent / Mortgage": return 15000;
    case "Investment Property Costs": return 20000;
    case "Income": return 40000;
    case "Ignore": return 60000;
    case "Big One-Offs": return Infinity;
    default: return 5000;
  }
}
function sanityConfidence(category: string, amount: number, conf: number): number {
  return Math.abs(amount) > amountThreshold(category) ? Math.min(conf, 0.5) : conf;
}

// Apply DB-backed merchant rules first (sorted by priority by the caller), then
// fall back to the built-in static rules. This is how MoneyMoves gets smarter
// each month: approved rules from the Review Queue land in the DB and win.
export function categoriseWith(dbRules: DbRule[], description: string, amount: number, source: string): CatResult {
  const d = description || "";
  for (const r of dbRules) {
    try {
      if (new RegExp(r.pattern, "i").test(d)) {
        return { category: r.category, confidence: sanityConfidence(r.category, amount, Number(r.confidence)), rule: r.rule_name };
      }
    } catch {
      /* ignore a malformed pattern and continue */
    }
  }
  return categorise(d, amount, source);
}

export function categorise(description: string, amount: number, _source: string): CatResult {
  const d = description || "";
  for (const r of R) {
    if (r.re.test(d)) {
      // A positive amount on an Income rule stays income; a positive amount that
      // matched an expense merchant is most likely a refund — keep the category.
      return { category: r.category, confidence: sanityConfidence(r.category, amount, r.conf), rule: r.name };
    }
  }
  // Credits with no rule are most likely income/refunds; flag for review either way.
  return { category: "NEEDS_REVIEW", confidence: 0.4, rule: null };
}
