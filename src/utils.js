// ── Shared constants and parsing utilities ─────────────────────────────────
// Extracted from App.jsx to reduce file size and improve maintainability.

export const DEFAULT_ITEMS = [
  { id: 2,  source: "GL", category: "Accruals",                        accounts: "",                                                                          rule: "FLAG IF", text: "Accrual entry has no corresponding reversal within first 5 business days of month" },
  { id: 4,  source: "GL", category: "Accruals",                        accounts: "",                                                                          rule: "FLAG IF", text: "Any standard accrual is missing or differs more than 5% from prior month" },
  { id: 5,  source: "GL", category: "Accruals",                        accounts: "",                                                                          rule: "FLAG IF", text: "Account shows a reversal with no corresponding new accrual or expense entry in the same month" },
  { id: 6,  source: "GL", category: "Accruals",                        accounts: "",                                                                          rule: "FLAG IF", text: "Accrual description references a service period that ended more than 60 days prior to the current review month (stale period accrual). Indicates a prior-period accrual has not been resolved and is continuing to cycle through reversals and re-accruals without the underlying invoice being posted or the accrual being closed." },
  { id: 7,  source: "IS", category: "Revenue - Total Rental Income",   accounts: "411001-415002",                                                             rule: "FLAG IF", text: "Total Rental Income (sum of 411001-415002) variance of more than 2% vs prior month" },
  { id: 8,  source: "IS", category: "Revenue - Bad Debt",              accounts: "419001 Bad Debt Expense",                                                   rule: "FLAG IF", text: "Bad Debt Expense equals zero; may be missing entries or bad debt reserve" },
  { id: 36, source: "IS", category: "Revenue - Other Income",          accounts: "440003, 440020, 440032",                                                    rule: "FLAG IF", text: "Any of these other income account ending balances in the income statement for the current month varies by more than 20% from the prior month" },
  { id: 38, source: "IS", category: "Commercial Revenue",              accounts: "45xxxx all commercial revenue accounts",                                    rule: "FLAG IF", text: "Commercial base rent (450001) is not the same as the prior month, unless there is a new tenant, a tenant vacates, or a rent increase. Accept reasonable explanation; otherwise flag." },
  { id: 39, source: "IS", category: "Commercial Revenue",              accounts: "45xxxx all commercial revenue accounts",                                    rule: "FLAG IF", text: "Commercial reimbursement (450006-450007) is not the same as the prior month, unless there is a new tenant, a tenant vacates, or a rent increase in account 450001. Accept reasonable explanation; otherwise flag." },
  { id: 9,  source: "IS", category: "Repairs & Maintenance",           accounts: "601001-601049",                                                             rule: "FLAG IF", text: "Any single R&M account exceeds $3,000 in current month and was under $1,000 prior month" },
  { id: 10, source: "IS", category: "Repairs & Maintenance",           accounts: "601001-601049",                                                             rule: "FLAG IF", text: "Any R&M account shows a large negative balance on the income statement in the current month" },
  { id: 11, source: "GL", category: "Repairs & Maintenance",           accounts: "601001-601049",                                                             rule: "FLAG IF", text: "PO accruals apply identical dollar amounts across unrelated line items (system error pattern)" },
  { id: 12, source: "GL", category: "Repairs & Maintenance",           accounts: "601001-601049",                                                             rule: "FLAG IF", text: "Any entry description for a GL entry over $500 that references roof, HVAC, appliance, flooring - verify P&L vs. capital" },
  { id: 13, source: "IS", category: "Turnover Expenses",               accounts: "602001-602016",                                                             rule: "FLAG IF", text: "Total Turnover Expenses increase more than 50% vs prior month without corresponding vacancy increase" },
  { id: 37, source: "GL", category: "Turnover Expenses",               accounts: "602001-602016",                                                             rule: "FLAG IF", text: "Any turnover expense entry (invoice or accrual) does not include a unit number in the description. This is a documentation cleanliness requirement — every turnover charge must reference the specific unit it relates to (e.g. 'Unit 204', '#204', 'Apt 204')." },
  { id: 15, source: "IS", category: "Payroll",                         accounts: "603001-603106",                                                             rule: "FLAG IF", text: "Total payroll, excluding 603008 Bonuses - Performance, varies more than 10% vs prior month without explanation" },
  { id: 16, source: "IS", category: "Payroll",                         accounts: "603001-603106",                                                             rule: "FLAG IF", text: "Wages post but burden accounts (taxes, insurance, 401k) are zero or missing same period" },
  { id: 17, source: "IS", category: "Utilities",                       accounts: "604003, 604004, 604201, 604301, 604302",                                    rule: "FLAG IF", text: "Any utility varies more than 25% from trailing 3-month average" },
  { id: 18, source: "IS", category: "Utilities",                       accounts: "604003, 604004, 604201, 604301, 604302",                                    rule: "FLAG IF", text: "Any utility account shows large negative income statement value in current month - may indicate billing catch-up or accrual error" },
  { id: 19, source: "GL", category: "Contract Services",               accounts: "605001-605030",                                                             rule: "FLAG IF", text: "Any recurring vendor missing for current month with no explanation" },
  { id: 20, source: "GL", category: "Contract Services",               accounts: "605001-605030",                                                             rule: "FLAG IF", text: "Any contract amount varies more than 10% from its typical monthly amount" },
  { id: 21, source: "IS", category: "Contract Services",               accounts: "605001-605030",                                                             rule: "FLAG IF", text: "Any material increase or decrease in contract line (e.g., 2x the prior month amount) that looks like an incorrect accrual" },
  { id: 22, source: "IS", category: "ILS Marketing",                   accounts: "606602-606610",                                                             rule: "FLAG IF", text: "ILS marketing spend in any account varies 50% or more from the prior month" },
  { id: 23, source: "IS", category: "Marketing",                       accounts: "606001-606822",                                                             rule: "FLAG IF", text: "Any marketing account reversed but not re-accrued in same period or expensed" },
  { id: 24, source: "GL", category: "Marketing",                       accounts: "606001-606822",                                                             rule: "FLAG IF", text: "Same vendor accrued twice in one month without explanation" },
  { id: 25, source: "IS", category: "Administrative",                  accounts: "607005-607009, 607011-607018, 607022-607023, 607029, 607038",               rule: "FLAG IF", text: "Any administrative expense income statement account is negative for the current month or varies more than 25% from trailing 3-month average" },
  { id: 26, source: "IS", category: "Management Fee",                  accounts: "608001 External Management Fee Expense",                                    rule: "FLAG IF", text: "Fee as % of Total Revenue varies more than 1% from prior months" },
  { id: 27, source: "GL", category: "Management Fee",                  accounts: "608001 External Management Fee Expense",                                    rule: "FLAG IF", text: "Negative management fee entry" },
  { id: 28, source: "IS", category: "Insurance",                       accounts: "640001 Property Insurance",                                                 rule: "FLAG IF", text: "Amount changes vs prior month" },
  { id: 29, source: "IS", category: "Debt Service",                    accounts: "701001-701010",                                                             rule: "FLAG IF", text: "Any expense line changes vs prior month by more than 3%" },
  { id: 30, source: "IS", category: "Real Estate Taxes",               accounts: "630001 Real Estate Tax",                                                    rule: "FLAG IF", text: "Amount changes vs prior month" },
  { id: 31, source: "GL", category: "Legal",                           accounts: "607010 Legal - Evictions",                                                  rule: "FLAG IF", text: "Any legal fee entry appears - note for manager awareness regardless of amount" },
  { id: 32, source: "IS", category: "Expense Trends",                  accounts: "",                                                                          rule: "FLAG IF", text: "Identify any expense line present in 2+ prior months but zero or negative in current month" },
  { id: 33, source: "IS", category: "Expense Trends",                  accounts: "",                                                                          rule: "FLAG IF", text: "Flag any income statement account with large swing from positive to negative or vice versa in consecutive months" },
  { id: 34, source: "IS", category: "Expense Trends",                  accounts: "6xxxxx all expense accounts",                                               rule: "FLAG IF", text: "ANY expense account (6xxxxx) shows a negative month-ending balance on the income statement - flag every instance regardless of amount or category" },
];

export const CATEGORIES = [
  "Accruals","Revenue - Total Rental Income","Revenue - Bad Debt","Revenue - Other Income","Commercial Revenue",
  "Repairs & Maintenance","Turnover Expenses","Payroll","Utilities",
  "Contract Services","ILS Marketing","Marketing","Administrative","Management Fee","Insurance","Debt Service",
  "Real Estate Taxes","Legal","Expense Trends",
];

export const AUDIENCE_LABELS = {
  accounting_manager: "Accounting Manager",
  property_manager:   "Property Manager",
  asset_manager:      "Asset Manager",
};

export function serialize(items) {
  const grouped = {};
  items.forEach(item => {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  });
  return Object.entries(grouped).map(([cat, rows]) => {
    const accts = rows[0].accounts ? "ACCOUNTS: " + rows[0].accounts + "\n" : "";
    return "CATEGORY: " + cat + "\n" + accts + rows.map(r => r.rule + ": " + r.text).join("\n");
  }).join("\n\n");
}

export function serializeBySource(items, source) {
  return serialize(items.filter(i => i.source === source));
}

export function parseAIChecklist(text) {
  const items = [];
  let nextId = Date.now();
  text.split(/\n\n+/).forEach(block => {
    let category = "", accounts = "";
    block.trim().split("\n").forEach(line => {
      if (line.startsWith("CATEGORY:")) { category = line.replace("CATEGORY:", "").trim(); }
      else if (/^ACCOUNTS?:/.test(line)) { accounts = line.replace(/^ACCOUNTS?:\s*/, ""); }
      else if (line.startsWith("CHECK:") || line.startsWith("FLAG IF:")) {
        const rule = line.startsWith("CHECK:") ? "CHECK" : "FLAG IF";
        const txt = line.replace(/^(CHECK:|FLAG IF:)\s*/, "").trim();
        if (txt && category) items.push({ id: nextId++, category, accounts, rule, text: txt });
      }
    });
  });
  return items.length ? items : null;
}

// ── IS detail parser ─────────────────────────────────────────────────────────
// Returns { headers, dataRows, sumRow, isRange } or null
export function parseIsDetail(isText, accountNumber) {
  if (!isText) return null;
  const rangeMatch = accountNumber.match(/^(\d{5,6})-(\d{5,6})$/);
  const isRange    = !!rangeMatch;
  const rangeStart = isRange ? parseInt(rangeMatch[1]) : null;
  const rangeEnd   = isRange ? parseInt(rangeMatch[2]) : null;

  const lines = isText.split("\n");
  let headers  = null;
  const dataRows = [];

  for (const line of lines) {
    const cols = line.split(",").map(c => c.trim());
    if (!headers) {
      if (cols.some(c => /^\d{1,2}\/\d{2}\/\d{4}$/.test(c))) { headers = cols; continue; }
    } else {
      const acctNum = parseInt(cols[0]);
      if (isRange) {
        if (!isNaN(acctNum) && acctNum >= rangeStart && acctNum <= rangeEnd) dataRows.push(cols);
      } else {
        if (cols[0] === accountNumber || cols[0].startsWith(accountNumber + " ") || cols[0].startsWith(accountNumber + "-")) {
          return { headers, dataRows: [cols], sumRow: null, isRange: false };
        }
      }
    }
  }
  if (!headers || dataRows.length === 0) return null;

  // Build sum row for ranges
  const sumRow = headers.map((_, hi) => {
    if (hi === 0) return accountNumber;
    if (hi === 1) return "Total";
    const sum = dataRows.reduce((acc, row) => {
      const v = parseFloat(row[hi] ?? "");
      return acc + (isNaN(v) ? 0 : v);
    }, 0);
    return sum.toFixed(2);
  });
  return { headers, dataRows, sumRow, isRange: true };
}

// ── GL detail parser ─────────────────────────────────────────────────────────
// Returns entries array, or null (with isAccountRange flag for messaging)
export function parseGlDetail(glText, accountNumber) {
  if (!glText) return null;
  if (/^\d{5,6}-\d{5,6}$/.test(accountNumber)) return null; // range — caller handles message
  const lines = glText.split("\n");
  let inSection = false;
  const entries = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("//") || t.startsWith("FORMAT:")) continue;
    if (/^(?:4[4-9]\d{3,4}|[5-9]\d{4,5})\s+-/.test(t)) {
      const m = t.match(/^(\d{5,6})/);
      inSection = m?.[1] === accountNumber;
      continue;
    }
    if (!inSection) continue;
    const parts = [];
    let cur = "", inQ = false;
    for (const ch of t) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { parts.push(cur); cur = ""; }
      else { cur += ch; }
    }
    parts.push(cur);
    const dt = parts[0]?.trim() ?? "";
    if (!(dt.length === 10 && dt[2] === "/" && dt[5] === "/")) continue;
    entries.push({
      date:   dt,
      desc:   parts.slice(1, parts.length - 2).join(", ").trim(),
      debit:  parts[parts.length - 2]?.trim() ?? "",
      credit: parts[parts.length - 1]?.trim() ?? "",
    });
  }
  return entries.length > 0 ? entries : null;
}

// ── GL reconciliation check ──────────────────────────────────────────────────
// Returns { glNet, isAmount, match } or null (null = skip check, show table)
export function glPeriodCheck(entries, isData, period) {
  if (!entries || !isData || !period) return null;
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return null;

  // Find IS column matching the review period (header format: "MM/DD/YYYY")
  const colIdx = isData.headers.findIndex(h => {
    const m = h.match(/^(\d{1,2})\/\d{2}\/(\d{4})$/);
    return m && parseInt(m[1]) === month && parseInt(m[2]) === year;
  });
  if (colIdx === -1) return null;

  const row = isData.dataRows[0];
  if (!row) return null;
  const isAmount = parseFloat((row[colIdx] ?? "").replace(/,/g, ""));
  if (isNaN(isAmount)) return null;

  // Sum GL entries whose date falls in the review period
  let sumDebit = 0, sumCredit = 0, count = 0;
  for (const e of entries) {
    const parts = e.date.split("/");
    if (parts.length !== 3) continue;
    const eMonth = parseInt(parts[0]), eYear = parseInt(parts[2]);
    if (eMonth === month && eYear === year) {
      sumDebit  += parseFloat(e.debit.replace(/,/g, ""))  || 0;
      sumCredit += parseFloat(e.credit.replace(/,/g, "")) || 0;
      count++;
    }
  }
  if (count === 0) return null; // no period entries — can't reconcile

  const glNet = sumDebit - sumCredit;
  // Allow $1.00 rounding tolerance; check both sign conventions (expense vs revenue)
  const match = Math.abs(glNet - isAmount) <= 1.00 || Math.abs(-glNet - isAmount) <= 1.00;
  return { glNet, isAmount, match };
}

// ── Report context builder ───────────────────────────────────────────────────
export function buildReportContext(findings, isText, budText, feedback, generalFindings) {
  const fmtRow = row => row.map((v, i) => i >= 2 ? (parseFloat(v) || 0).toFixed(2) : v).join(" | ");
  const sections = findings.map(item => {
    const lines = [`[${item.accountNumber}] ${item.accountName}`];
    const isData = parseIsDetail(isText, item.accountNumber);
    if (isData) {
      lines.push("Income Statement:");
      isData.dataRows.forEach(row => lines.push("  " + fmtRow(row)));
      if (isData.sumRow) lines.push("  TOTAL | " + fmtRow(isData.sumRow));
    }
    if (budText) {
      const budData = parseIsDetail(budText, item.accountNumber);
      if (budData) {
        lines.push("Budget:");
        budData.dataRows.forEach(row => lines.push("  " + fmtRow(row)));
        if (budData.sumRow) lines.push("  TOTAL | " + fmtRow(budData.sumRow));
      }
    }
    if (item.isIssue)     lines.push(`IS Finding: ${item.isIssue}`);
    if (item.glIssue)     lines.push(`GL Finding: ${item.glIssue}`);
    if (item.budgetIssue) lines.push(`Budget Finding: ${item.budgetIssue}`);
    if (item.action)      lines.push(`Action: ${item.action}`);
    const fb = feedback?.findings?.[item.accountNumber];
    if (fb?.rating) lines.push(`Reviewer Feedback: ${fb.rating.replace(/_/g, " ")}${fb.note ? " — " + fb.note : ""}`);
    return lines.join("\n");
  });
  if (generalFindings?.length > 0) {
    const genLines = generalFindings.map(gf => `- ${gf.isIssue || gf.glIssue || ""}${gf.action ? " Action: " + gf.action : ""}`).join("\n");
    sections.unshift(`GENERAL PROCESS FINDINGS:\n${genLines}`);
  }
  if (feedback?.general) sections.push(`GENERAL REVIEWER NOTES:\n${feedback.general}`);
  return sections.join("\n\n---\n\n");
}
