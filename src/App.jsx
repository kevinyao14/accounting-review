import { useState, useRef, useEffect } from "react";
import * as XLSX from "xlsx";

// ── Structured checklist data ─────────────────────────────────────────────────
const DEFAULT_ITEMS = [
  { id: 2,  source: "GL", category: "Accruals",                        accounts: "",                                                                          rule: "FLAG IF", text: "Accrual entry has no corresponding reversal within first 5 business days of month" },
  { id: 4,  source: "GL", category: "Accruals",                        accounts: "",                                                                          rule: "FLAG IF", text: "Any standard accrual is missing or differs more than 5% from prior month" },
  { id: 5,  source: "GL", category: "Accruals",                        accounts: "",                                                                          rule: "FLAG IF", text: "Account shows a reversal with no corresponding new accrual or expense entry in the same month" },
  { id: 6,  source: "GL", category: "Accruals",                        accounts: "",                                                                          rule: "FLAG IF", text: "Accrual description references a service period that ended more than 60 days prior to the current review month (stale period accrual). Indicates a prior-period accrual has not been resolved and is continuing to cycle through reversals and re-accruals without the underlying invoice being posted or the accrual being closed." },
  { id: 7,  source: "IS", category: "Revenue - Total Rental Income",   accounts: "411001-415002",                                                             rule: "FLAG IF", text: "Total Rental Income (sum of 411001-415002) variance of more than 2% vs prior month" },
  { id: 8,  source: "IS", category: "Revenue - Bad Debt",              accounts: "419001 Bad Debt Expense",                                                   rule: "FLAG IF", text: "Bad Debt Expense equals zero; may be missing entries or bad debt reserve" },
  { id: 36, source: "IS", category: "Revenue - Other Income",          accounts: "440003, 440020, 440032",                                                    rule: "FLAG IF", text: "Any of these other income account ending balances in the income statement for the current month varies by more than 20% from the prior month" },
  { id: 9,  source: "IS", category: "Repairs & Maintenance",           accounts: "601001-601049",                                                             rule: "FLAG IF", text: "Any single R&M account exceeds $3,000 in current month and was under $1,000 prior month" },
  { id: 10, source: "IS", category: "Repairs & Maintenance",           accounts: "601001-601049",                                                             rule: "FLAG IF", text: "Any R&M account shows a large negative balance on the income statement in the current month" },
  { id: 11, source: "GL", category: "Repairs & Maintenance",           accounts: "601001-601049",                                                             rule: "FLAG IF", text: "PO accruals apply identical dollar amounts across unrelated line items (system error pattern)" },
  { id: 12, source: "GL", category: "Repairs & Maintenance",           accounts: "601001-601049",                                                             rule: "FLAG IF", text: "Any entry description for a GL entry over $500 that references roof, HVAC, appliance, flooring - verify P&L vs. capital" },
  { id: 13, source: "IS", category: "Turnover Expenses",               accounts: "602001-602016",                                                             rule: "FLAG IF", text: "Total Turnover Expenses increase more than 50% vs prior month without corresponding vacancy increase" },
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

const CATEGORIES = [
  "Accruals","Revenue - Total Rental Income","Revenue - Bad Debt","Revenue - Other Income",
  "Repairs & Maintenance","Turnover Expenses","Payroll","Utilities",
  "Contract Services","ILS Marketing","Marketing","Administrative","Management Fee","Insurance","Debt Service",
  "Real Estate Taxes","Legal","Expense Trends",
];

function serialize(items) {
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

function serializeBySource(items, source) {
  return serialize(items.filter(i => i.source === source));
}

function parseAIChecklist(text) {
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
function parseIsDetail(isText, accountNumber) {
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

// ── GL detail parser ──────────────────────────────────────────────────────────
// Returns entries array, or null (with isAccountRange flag for messaging)
function parseGlDetail(glText, accountNumber) {
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

// ── GL reconciliation check ───────────────────────────────────────────────────
// Returns { glNet, isAmount, match } or null (null = skip check, show table)
function glPeriodCheck(entries, isData, period) {
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

async function callClaude(system, user, options = {}) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, messages: [{ role: "user", content: user }], ...options }),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(text.slice(0, 300)); }
  if (!res.ok || data.error) {
    const msg = data.error?.message || data.error || JSON.stringify(data);
    throw new Error(msg);
  }
  return data.content?.[0]?.text ?? "";
}

export default function App() {
  const [tab, setTab] = useState("review");

  const [reviewMonth, setReviewMonth] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  });
  const [incomeStatement, setIncomeStatement] = useState("");
  const [glEntries, setGlEntries]             = useState("");
  const [findings, setFindings]               = useState([]);
  const [reviewing, setReviewing]             = useState(false);
  const [reviewStatus, setReviewStatus]       = useState("");
  const [reviewError, setReviewError]         = useState("");
  const [budgetData, setBudgetData]           = useState("");
  const [budgetError, setBudgetError]         = useState("");
  const [glFileName, setGlFileName]           = useState("");

  const [items, setItems]         = useState(DEFAULT_ITEMS);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({});
  const [adding, setAdding]       = useState(false);
  const [newItem, setNewItem]     = useState({ category: CATEGORIES[0], accounts: "", rule: "FLAG IF", source: "IS", text: "" });
  const [importError, setImportError]     = useState("");
  const [periodWarning, setPeriodWarning] = useState("");
  const [checklistDirty, setChecklistDirty]   = useState(false);
  const [checklistSaving, setChecklistSaving] = useState(false);
  const [checklistSaveMsg, setChecklistSaveMsg] = useState("");

  const [historyIndex, setHistoryIndex]       = useState([]);
  const [historyLoaded, setHistoryLoaded]     = useState(false);
  const [historyLoading, setHistoryLoading]   = useState(false);
  const [expandedReview, setExpandedReview]   = useState(null); // { blobUrl, data|null, loading }
  const [feedbackMode, setFeedbackMode]       = useState(null); // blobUrl of review in feedback mode
  const [feedbackDraft, setFeedbackDraft]     = useState({ findings: {}, accountNotes: [{ id: 1, accountNumber: "", note: "" }], general: "" });
  const [feedbackSaving, setFeedbackSaving]   = useState(false);
  const [feedbackSaved, setFeedbackSaved]     = useState(false);
  const [detailOpen, setDetailOpen]           = useState({});
  const toggleDetail = (acct, type) => setDetailOpen(prev => ({
    ...prev, [acct]: { ...prev[acct], [type]: !prev[acct]?.[type] }
  }));
  const [historyDetailOpen, setHistoryDetailOpen] = useState({});
  const toggleHistoryDetail = (key, type) => setHistoryDetailOpen(prev => ({
    ...prev, [key]: { ...prev[key], [type]: !prev[key]?.[type] }
  }));

  const fileInputRef = useRef(null);
  const isFileRef    = useRef(null);
  const glFileRef    = useRef(null);
  const budgetFileRef = useRef(null);

  // Load checklist: localStorage first (instant), then sync from KV in background
  useEffect(() => {
    try {
      const cached = localStorage.getItem("checklist");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) setItems(parsed);
      }
    } catch {}

    fetch("/api/checklist")
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setItems(data);
          localStorage.setItem("checklist", JSON.stringify(data));
        }
      })
      .catch(() => {});
  }, []);

  const saveChecklist = async () => {
    setChecklistSaving(true);
    setChecklistSaveMsg("");
    try {
      const res = await fetch("/api/checklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error("Save failed");
      localStorage.setItem("checklist", JSON.stringify(items));
      setChecklistDirty(false);
      setChecklistSaveMsg("Saved");
      setTimeout(() => setChecklistSaveMsg(""), 2500);
    } catch {
      setChecklistSaveMsg("Save failed — try again");
    } finally {
      setChecklistSaving(false);
    }
  };

  const updateItems = (newItems) => {
    setItems(newItems);
    setChecklistDirty(true);
  };

  const readCsv = (file, setter) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => setter(e.target.result);
    reader.readAsText(file);
  };

  const readIsCsv = (file, setter, setErr) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const raw = e.target.result;

      // Detect wrong file type
      if (/Posted Dt\./i.test(raw.slice(0, 2000))) {
        setErr("This appears to be a GL report, not an income statement. Please upload the income statement CSV.");
        return;
      }

      const [yr, mo] = reviewMonth.split("-");
      const reviewDate = new Date(+yr, +mo - 1, 1);

      const lines = raw.split("\n");

      // Pre-scan: find the most recent date in the IS before any column filtering
      let maxISDate = null;
      for (const line of lines) {
        const cols = line.split(",");
        const dateCols = cols.filter(c => { const t = c.trim(); return t.length === 10 && t[2] === "/" && t[5] === "/"; });
        if (dateCols.length > 0) {
          dateCols.forEach(c => {
            const p = c.trim().split("/");
            const colDate = new Date(+p[2], +p[0] - 1, 1);
            if (!maxISDate || colDate > maxISDate) maxISDate = colDate;
          });
          break; // only need the header row
        }
      }
      if (maxISDate) {
        const monthsAhead = (maxISDate.getFullYear() - reviewDate.getFullYear()) * 12
          + (maxISDate.getMonth() - reviewDate.getMonth());
        if (monthsAhead >= 2) {
          const isLabel = maxISDate.toLocaleString("en-US", { month: "long", year: "numeric" });
          const rvLabel = reviewDate.toLocaleString("en-US", { month: "long", year: "numeric" });
          setPeriodWarning(`Income statement runs through ${isLabel} but review period is set to ${rvLabel} — review period may be stale.`);
        } else {
          setPeriodWarning("");
        }
      }

      let keepCols = null; // will be set when we find the date header row

      const result = lines.map(line => {
        const cols = line.split(",");

        // Detect the date header row and compute which columns to keep
        if (!keepCols) {
          const hasDate = cols.some(c => {
            const t = c.trim();
            return t.length === 10 && t[2] === "/" && t[5] === "/";
          });
          if (hasDate) {
            keepCols = [0, 1]; // always keep account number + name
            cols.forEach((c, j) => {
              const t = c.trim();
              if (t.length === 10 && t[2] === "/" && t[5] === "/") {
                const parts = t.split("/");
                const colDate = new Date(+parts[2], +parts[0] - 1, 1);
                const monthsDiff = (reviewDate.getFullYear() - colDate.getFullYear()) * 12
                  + (reviewDate.getMonth() - colDate.getMonth());
                if (monthsDiff >= 0 && monthsDiff <= 3) keepCols.push(j);
              }
            });
          }
        }

        // If we have keepCols, filter this row; otherwise pass through (header rows)
        if (keepCols) {
          return keepCols.map(j => cols[j] ?? "").join(",");
        }
        return line;
      });

      const filtered = result.join("\n");
      if (!keepCols) {
        setErr("Could not detect date columns in income statement. Expected month-ending dates (e.g. 04/30/2025) as column headers.");
        return;
      }
      if (keepCols.length <= 2) {
        const [y, m] = reviewMonth.split("-");
        const label = new Date(+y, +m - 1).toLocaleString("en-US", { month: "long", year: "numeric" });
        setErr(`No data columns found near ${label}. Check that the file covers the review period.`);
        return;
      }
      setErr("");
      setter(filtered);
    };
    reader.readAsText(file);
  };

  const readBudgetCsv = (file, setter, setErr) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const raw = e.target.result;
      const [yr, mo] = reviewMonth.split("-");
      const reviewDate = new Date(+yr, +mo - 1, 1);

      const lines = raw.split("\n");
      let budgetColIdx = null;

      // Find the date header row and locate the exact review month column
      for (let i = 0; i < lines.length; i++) {
        const cols = lines[i].split(",");
        const hasDate = cols.some(c => {
          const t = c.trim();
          return t.length === 10 && t[2] === "/" && t[5] === "/";
        });
        if (hasDate) {
          cols.forEach((c, j) => {
            const t = c.trim();
            if (t.length === 10 && t[2] === "/" && t[5] === "/") {
              const parts = t.split("/");
              const colDate = new Date(+parts[2], +parts[0] - 1, 1);
              if (colDate.getFullYear() === reviewDate.getFullYear() &&
                  colDate.getMonth() === reviewDate.getMonth()) {
                budgetColIdx = j;
              }
            }
          });
          break;
        }
      }

      if (budgetColIdx === null) {
        const [y, m] = reviewMonth.split("-");
        const label = new Date(+y, +m - 1).toLocaleString("en-US", { month: "long", year: "numeric" });
        setErr(`No column found for ${label} in this budget file. Check that the review period matches the file.`);
        return;
      }

      const rows = ["AccountNumber,AccountName,Budget"];
      for (const line of lines) {
        const cols = line.split(",");
        const acct = (cols[0] ?? "").trim();
        if (/^\d{6}$/.test(acct)) {
          const name = (cols[1] ?? "").trim();
          const budget = (cols[budgetColIdx] ?? "").trim();
          rows.push([acct, name, budget].join(","));
        }
      }

      setErr("");
      setter(rows.join("\n"));
    };
    reader.readAsText(file);
  };

  // For GL files: extract revenue (4[4-9]xxxx) + expense (5-9xxxxx) sections, keep 2 months of entries
  const readGlCsv = (file, setter, setErr) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const raw = e.target.result;

      // Detect IS file uploaded by mistake: IS has 3+ date columns in a single early row
      const earlyLines = raw.split("\n").slice(0, 15);
      const looksLikeIS = earlyLines.some(line => {
        const dateCols = line.split(",").filter(c => { const t = c.trim(); return t.length === 10 && t[2] === "/" && t[5] === "/"; });
        return dateCols.length >= 3;
      });
      if (looksLikeIS) {
        setErr("This appears to be an income statement, not a GL report. Please upload the GL report CSV.");
        return;
      }

      const [yr, mo] = reviewMonth.split("-");

      const keepMonths = new Set();
      for (let i = 0; i < 2; i++) {
        const d = new Date(+yr, +mo - 1 - i, 1);
        keepMonths.add(
          String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear()
        );
      }

      const lines = raw.split("\n");

      // Regex matching revenue (440001+) and expense (5xxxxx, 6xxxxx, 7xxxxx+) account headers
      const acctHdrRe = /^(?:4[4-9]\d{3,4}|[5-9]\d{4,5})\s+-/;

      // Check relevant accounts exist before processing
      const hasAccounts = lines.some(l => acctHdrRe.test(l));
      if (!hasAccounts) {
        setErr("No revenue (44xxxx+) or expense (6xxxxx) accounts found. Check that a GL report with account sections was uploaded.");
        return;
      }

      let acctStart = 0;
      for (let i = 0; i < lines.length; i++) {
        if (acctHdrRe.test(lines[i])) { acctStart = i; break; }
      }

      const source = acctStart > 0 ? lines.slice(acctStart) : lines;
      const result = [];

      for (const line of source) {
        const t = line.trim();

        // Account header — keep just account number and name
        if (acctHdrRe.test(t)) {
          const m = t.match(/^(\d{5,6}\s+-[^(]+)/);
          result.push(m ? m[1].trim() : t);
          continue;
        }

        // Skip totals rows
        if (/^Totals for \d/.test(t)) continue;

        // Journal entry lines — keep only if in the relevant months
        // Columns: [0] Posted Dt, [1] Doc Dt, [2] Doc, [3] Memo/Description,
        //          [4] Dept, [5] Location, [6] Unit, [7] JNL, [8] Debit, [9] Credit, [10] Balance
        // Use a quoted-CSV parser to handle commas inside quoted fields
        const parts = [];
        { let cur = "", inQ = false;
          for (let ci = 0; ci < t.length; ci++) {
            const ch = t[ci];
            if (ch === '"') { inQ = !inQ; }
            else if (ch === ',' && !inQ) { parts.push(cur); cur = ""; }
            else { cur += ch; }
          }
          parts.push(cur);
        }
        const dt = parts[0] ?? "";
        if (dt.length === 10 && dt[2] === "/" && dt[5] === "/") {
          const my = dt.slice(0, 3) + dt.slice(6, 10);
          if (keepMonths.has(my)) {
            // GL columns (right-to-left from end, robust to unquoted commas in description):
            //   [length-1]=Balance, [length-2]=Credit, [length-3]=Debit, [length-4]=JNL,
            //   [length-5]=Unit, [length-6]=Location, [length-7]=Department
            //   [2]=Doc, [3..length-8]=Description (rejoin if extra commas present)
            const n = parts.length;
            const doc  = (parts[2] ?? "").trim();
            // Rejoin any extra middle parts caused by unquoted commas in the description
            const desc = parts.slice(3, n - 7).join(",").trim();
            // Strip commas from numeric amounts (e.g. "1,500.00" → "1500.00")
            const debit  = (parts[n - 3] ?? "").replace(/,/g, "").trim();
            const credit = (parts[n - 2] ?? "").replace(/,/g, "").trim();
            const docPart = doc ? `,${doc}` : "";
            const apMatch = desc.match(/^AP Invoic[a-z]*[:\s-]+(.+)/i);
            const shortDesc = apMatch ? "AP: " + apMatch[1].slice(0, 100) : desc;
            // Quote description if it contains commas so debit/credit columns stay unambiguous
            const safeDesc = shortDesc.includes(",") ? `"${shortDesc}"` : shortDesc;
            result.push(`${dt}${docPart},${safeDesc},${debit},${credit}`);
          }
        }
      }

      if (result.length === 0) {
        const monthList = [...keepMonths].join(" or ");
        setErr(`No expense entries found for ${monthList}. Check that the GL report covers the review period.`);
        return;
      }

      setErr("");
      const label = new Date(+yr, +mo - 1).toLocaleString("en-US", { month: "long", year: "numeric" });
      setter([
        "// GL: revenue (440001+) and expense (6xxxxx) accounts, 2 months ending " + label + " (" + result.length + " lines)",
        "FORMAT: Account | Date, [Doc/invoice#], Description, Debit, Credit.",
        ...result
      ].join("\n"));
    };
    reader.readAsText(file);
  };


  const updateItem = (id, patch) => updateItems(items.map(i => i.id === id ? { ...i, ...patch } : i));
  const deleteItem = (id) => updateItems(items.filter(i => i.id !== id));
  const startEdit  = (item) => { setEditingId(item.id); setEditDraft({ ...item }); };
  const cancelEdit = () => { setEditingId(null); setEditDraft({}); };
  const saveEdit   = () => { updateItem(editingId, editDraft); setEditingId(null); setEditDraft({}); };
  const addItem    = () => {
    if (!newItem.text.trim()) return;
    updateItems([...items, { ...newItem, id: Date.now() }]);
    setNewItem({ category: CATEGORIES[0], accounts: "", rule: "FLAG IF", source: "IS", text: "" });
    setAdding(false);
  };

  const exportJson = () => {
    const payload = { exportedAt: new Date().toISOString(), version: 1, items };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "accounting-checklist-" + new Date().toISOString().slice(0,10) + ".json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        // Support both bare array and { items: [...] } wrapper
        const raw = Array.isArray(parsed) ? parsed : parsed.items;
        if (!Array.isArray(raw) || !raw[0]?.text) {
          setImportError("Invalid format. Expected an array of checklist items with at least a 'text' field.");
          return;
        }
        const normalised = raw.map((item, i) => ({
          id: item.id ?? Date.now() + i,
          category: item.category ?? CATEGORIES[0],
          accounts: item.accounts ?? "",
          rule: item.rule === "CHECK" ? "CHECK" : "FLAG IF",
          text: item.text,
        }));
        updateItems(normalised);
        setImportError("");
      } catch {
        setImportError("Could not parse file. Make sure it is valid JSON.");
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  };

  const runReview = async () => {
    if (!incomeStatement.trim() && !glEntries.trim()) {
      setReviewError("Paste at least one of: Income Statement or GL Entries."); return;
    }
    setReviewError(""); setReviewing(true); setFindings([]); setDetailOpen({});
    try {
      const [yr, mo] = reviewMonth.split("-");
      const label = new Date(+yr, +mo - 1).toLocaleString("en-US", { month: "long", year: "numeric" });

      let isFindings = [];
      let glFindings = [];

      // ── Call 1: Income Statement Review ──────────────────────────────────────
      if (incomeStatement.trim()) {
        setReviewStatus("Reviewing income statement...");
        const isSys = "You are a senior multifamily property accountant performing a monthly financial review.\n\nYou must work through EVERY category in the checklist systematically from top to bottom. Do not stop early. Do not skip categories. Every FLAG IF rule must be evaluated against the data.\n\nRULES FOR READING THE DATA:\n- The review period column is the column whose header date matches the review period. Use only that column for current month balances.\n- When calculating trailing averages, use the 3 months immediately prior to the review period only. Do not include the current review month in the average.\n- Do not reference YTD totals, TTM columns, or any future month columns.\n- Revenue accounts are in the 4xxxxx range (e.g. 411001–440032). Expense accounts are in the 6xxxxx range (e.g. 601001–640001).\n- Flag every expense account (6xxxxx) that shows a negative month-ending balance in the review period as a finding.\n\nFOR EACH FLAG IF RULE:\n- If the data is present and the condition is NOT met, skip it silently.\n- If the data is present and the condition IS met, include it as a finding.\n- Only skip a rule if the account numbers listed do not appear anywhere in the income statement data at all.\n\nOUTPUT RULES:\n- Return a JSON array only. No preamble, no explanation, no markdown backticks.\n- Each finding must be an object with exactly these fields:\n  - accountNumber: the specific account number as a string e.g. \"601005\"\n  - accountName: the specific account name e.g. \"Roof Supplies & Repairs\"\n  - issue: 1-2 sentences maximum. State the specific variance or anomaly with exact dollar amounts and the threshold breached. Nothing else.\n  - action: one directive sentence stating what to obtain or verify.\n- Order findings by accountNumber ascending.\n- Return an empty array [] if genuinely no issues are found.";

        const isUsr = "REVIEW PERIOD: " + label + "\n\nCHECKLIST:\n" + serializeBySource(items, "IS") + "\n\nINCOME STATEMENT:\n" + incomeStatement + "\n\nReview the " + label + " income statement against the checklist.";

        const isRaw = await callClaude(isSys, isUsr, { thinking: { type: "enabled", budget_tokens: 6000 }, max_tokens: 16000 });
        try {
          const match = isRaw.match(/\[[\s\S]*\]/);
          isFindings = JSON.parse(match ? match[0] : isRaw);
        } catch(e) { isFindings = []; setReviewError("IS parse error: " + isRaw.slice(0, 200)); }
      }

      // ── Calls 2 & 3: GL Investigation + Budget Review (parallel) ─────────────
      const parallelStatus = glEntries.trim() && budgetData.trim() ? "Investigating GL entries and budget..."
        : glEntries.trim() ? "Investigating GL entries..."
        : budgetData.trim() ? "Running budget variance check..."
        : null;
      if (parallelStatus) setReviewStatus(parallelStatus);

      const glSys = "You are a senior multifamily property accountant investigating GL journal entries.\n\nACCOUNT RANGES: Revenue accounts are in the 4xxxxx range (e.g. 411001–440032). Expense accounts are in the 6xxxxx range (e.g. 601001–640001). Debt service accounts are in the 7xxxxx range.\n\nYou will receive two things: (1) a list of issues already identified from the income statement, and (2) GL journal entries to investigate.\n\nYour job has two parts:\nPART 1 - For each income statement finding, look at the GL entries for that account and add only the specific entry-level detail that explains or confirms the anomaly (dates, amounts, descriptions). Do not describe entries that are functioning correctly.\nPART 2 - Apply the GL checklist rules to identify issues visible only in the GL that the income statement would not show.\n\nCRITICAL RULES:\n- Only create a finding if there is a specific problem, error, or pattern risk. Do not create findings where GL activity is normal and consistent.\n- Do not describe entries that are working correctly. State only what is wrong.\n- Do not include findings where your conclusion is that activity looks accurate. If the GL simply explains an IS variance with no anomaly, do not add a GL finding — let the IS finding stand alone.\n- Do NOT re-detect income statement variance issues. Do NOT recalculate month-ending balances or compare column totals. Only look at individual journal entry patterns: accruals, reversals, duplicate postings, missing pairs, suspicious descriptions, and timing anomalies.\n\nOUTPUT RULES:\n- Return a JSON array only. No preamble, no explanation, no markdown backticks.\n- Each finding must be an object with exactly these fields:\n  - accountNumber: the specific account number as a string e.g. \"601005\"\n  - accountName: the specific account name e.g. \"Roof Supplies & Repairs\"\n  - issue: 2-3 sentences maximum. State only the specific anomaly with the relevant entry dates and amounts. Do not narrate correct activity.\n  - action: one directive sentence stating what to obtain or verify.\n  - source: either \"IS\" if this augments an income statement finding, or \"GL\" if this is a new GL-only finding\n- If you cannot find the specific entries to evaluate a checklist rule, skip it entirely.\n- Order findings by accountNumber ascending.\n- Return an empty array [] if no issues are found.";
      const glUsr = "REVIEW PERIOD: " + label + "\n\nINCOME STATEMENT FINDINGS ALREADY IDENTIFIED:\n" + JSON.stringify(isFindings, null, 2) + "\n\nGL CHECKLIST:\n" + serializeBySource(items, "GL") + "\n\nGL ENTRIES:\n" + glEntries + "\n\nInvestigate the GL entries for " + label + ".";

      const budSys = "You are a senior multifamily property accountant performing a budget variance review.  Apply exactly two checks to expense accounts (6xxxxx) only:  CHECK 1 — UNBUDGETED EXPENSES: Any expense account where the actual amount for the review period is greater than $0 but the budget is $0 or missing. Flag as potential miscoding to wrong account.  CHECK 2 — MATERIAL BUDGET OVERAGES: Any expense account where actual exceeds budget by more than 25% AND the dollar overage is greater than $500. Skip accounts where budget is $0 (those are caught by Check 1).  OUTPUT RULES: - Return a JSON array only. No preamble, no explanation, no markdown backticks. - Each object must have: { accountNumber, accountName, issue, action, checkType } where checkType is \"UNBUDGETED\" or \"BUDGET_OVERAGE\" - Include exact actual amount, budget amount, and variance % in the issue field. - Order by accountNumber ascending. - Return [] if no issues found.";
      const budUsr = "REVIEW PERIOD: " + label + "\n\nACTUAL (from income statement, review month column only):\n" + incomeStatement + "\n\nBUDGET (review month only):\n" + budgetData + "\n\nApply the two budget checks for " + label + ".";

      const [glResult, budResult] = await Promise.all([
        glEntries.trim()
          ? callClaude(glSys, glUsr, { thinking: { type: "enabled", budget_tokens: 5000 }, max_tokens: 16000 })
              .then(raw => { const match = raw.match(/\[[\s\S]*\]/); return JSON.parse(match ? match[0] : raw); })
              .catch(e => { setReviewError("GL error: " + e.message.slice(0, 300)); return []; })
          : Promise.resolve([]),
        budgetData.trim()
          ? callClaude(budSys, budUsr, { thinking: { type: "enabled", budget_tokens: 3000 }, max_tokens: 16000 })
              .then(raw => { const match = raw.match(/\[[\s\S]*\]/); return JSON.parse(match ? match[0] : raw); })
              .catch(e => { setReviewError("Budget error: " + e.message.slice(0, 300)); return []; })
          : Promise.resolve([]),
      ]);

      glFindings = glResult;
      const budgetFindings = budResult;

      // ── Merge by accountNumber ────────────────────────────────────────────────
      const merged = {};

      isFindings.forEach(f => {
        const key = f.accountNumber;
        if (!merged[key]) merged[key] = { accountNumber: f.accountNumber, accountName: f.accountName, isIssue: "", glIssue: "", budgetIssue: "", action: "" };
        merged[key].isIssue = f.issue;
        merged[key].action = f.action;
      });

      glFindings.forEach(f => {
        const key = f.accountNumber;
        if (!merged[key]) merged[key] = { accountNumber: f.accountNumber, accountName: f.accountName, isIssue: "", glIssue: "", budgetIssue: "", action: "" };
        if (!merged[key].accountName) merged[key].accountName = f.accountName;
        merged[key].glIssue = f.issue;
        if (!merged[key].action) merged[key].action = f.action;
      });

      budgetFindings.forEach(f => {
        const key = f.accountNumber;
        if (!merged[key]) merged[key] = { accountNumber: f.accountNumber, accountName: f.accountName, isIssue: "", glIssue: "", budgetIssue: "", action: "" };
        if (!merged[key].accountName) merged[key].accountName = f.accountName;
        merged[key].budgetIssue = f.issue;
        if (!merged[key].action) merged[key].action = f.action;
      });

      const mergedArray = Object.values(merged).sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
      setFindings(mergedArray);
      setTab("findings");

      const propertyName = glFileName
        ? glFileName.replace(/\.[^.]+$/, "").split("_").pop()
        : "";

      // Fire-and-forget email notification
      fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findings: mergedArray, label, propertyName })
      }).catch(() => {});

      // Fire-and-forget history save
      fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property:          propertyName,
          period:            reviewMonth,
          timestamp:         new Date().toISOString(),
          findings:          mergedArray,
          checklistSnapshot: items,
          csvs: {
            is:     incomeStatement,
            gl:     glEntries,
            budget: budgetData,
          },
        }),
      }).then(r => r.json())
        .then(d => {
          if (d.ok) setHistoryLoaded(false); // invalidate so History tab refreshes
        })
        .catch(() => {});

    } catch(e) { setReviewError("Error: " + (e.message || "Please try again.")); }
    setReviewStatus("");
    setReviewing(false);
  };

  const downloadXlsx = () => {
    const rows = findings.map(item => ({
      "Account Number": item.accountNumber,
      "Account Name": item.accountName,
      "IS Finding": item.isIssue || "",
      "GL Finding": item.glIssue || "",
      "Action": item.action || ""
    }));

    const ws = XLSX.utils.json_to_sheet(rows);

    ws["!cols"] = [
      { wch: 16 },
      { wch: 36 },
      { wch: 60 },
      { wch: 60 },
      { wch: 50 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Findings");

    XLSX.writeFile(wb, "Accounting_Review_" + reviewMonth + ".xlsx");
  };


  const grouped = {};
  items.forEach(item => { if (!grouped[item.category]) grouped[item.category] = []; grouped[item.category].push(item); });
  const totalChecks = items.length;

  const monthLabel = (() => {
    try { const [y,m] = reviewMonth.split("-"); return new Date(+y,+m-1).toLocaleString("en-US",{month:"long",year:"numeric"}); }
    catch { return ""; }
  })();

  return (
    <div style={s.root}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=Fira+Code:wght@400;500&family=Lora:ital,wght@0,400;0,500;1,400&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        body{background:#0e0e0e;}
        ::-webkit-scrollbar{width:4px;height:4px;}
        ::-webkit-scrollbar-track{background:transparent;}
        ::-webkit-scrollbar-thumb{background:#333;border-radius:2px;}
        .tab{transition:all 0.15s ease;}
        .tab:hover{color:#fff!important;}
        .btn{transition:all 0.15s ease;cursor:pointer;}
        .btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 4px 16px rgba(232,196,104,0.2);}
        .btn:active:not(:disabled){transform:translateY(0);}
        .btn:disabled{opacity:0.4;cursor:not-allowed;}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        .pulsing{animation:pulse 1.4s ease infinite;}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        .fade-up{animation:fadeUp 0.3s ease;}
        input:focus,textarea:focus,select:focus{outline:none;border-color:#e8c468!important;}
        .item-row:hover .item-actions{opacity:1!important;}
        .item-row:hover{background:#161616!important;}
      `}</style>

      <header style={s.header}>
        <div style={s.headerInner}>
          <div style={s.logo}>
            <span style={s.logoMark}>◈</span>
            <div>
              <div style={s.logoTitle}>Accounting Review</div>
              <div style={s.logoSub}>Multifamily · Accrual Basis</div>
            </div>
          </div>
          <nav style={s.nav}>
            {[
              {key:"review",    label:"01 · Run Review"},
              {key:"findings",  label:"02 · Findings",   dot: findings.length > 0},
              {key:"checklist", label:"03 · Checklist",  badge: totalChecks},
              {key:"history",   label:"04 · History",    badge: historyIndex.length || null},
            ].map(t => (
              <button key={t.key} className="tab" onClick={() => {
                setTab(t.key);
                if (t.key === "history" && !historyLoaded && !historyLoading) {
                  setHistoryLoading(true);
                  fetch("/api/history")
                    .then(r => r.json())
                    .then(data => { if (Array.isArray(data)) setHistoryIndex(data); setHistoryLoaded(true); })
                    .catch(() => setHistoryLoaded(true))
                    .finally(() => setHistoryLoading(false));
                }
              }}
                style={{...s.tab,...(tab===t.key?s.tabActive:{})}}>
                {t.label}
                {t.dot && tab!=="findings" && <span style={s.dot}/>}
                {t.badge != null && <span style={s.badge}>{t.badge}</span>}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main style={s.main}>

        {tab==="review" && (
          <div className="fade-up" style={s.panel}>
            <div style={s.panelHead}>
              <h2 style={s.panelTitle}>Run a Review</h2>
              <p style={s.panelDesc}>Paste your income statement and/or GL entries. The AI reviews them against the current checklist ({totalChecks} rules).</p>
            </div>
            <div style={{marginBottom:20}}>
              <label style={s.label}>Review Period</label>
              <div style={{display:"flex",alignItems:"center",gap:12,marginTop:8}}>
                <input type="month" value={reviewMonth} onChange={e=>{ setReviewMonth(e.target.value); setPeriodWarning(""); }}
                  style={{background:"#0e0e0e",border:"1px solid #2a2a2a",borderRadius:8,color:"#e8c468",
                    fontFamily:"'Fira Code',monospace",fontSize:13,padding:"8px 14px",colorScheme:"dark"}}/>
                <span style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#4b5563"}}>{monthLabel}</span>
              </div>
              {periodWarning && (
                <div style={{marginTop:8,padding:"7px 12px",background:"#2a1f00",border:"1px solid #7a5800",
                  borderRadius:6,color:"#e8c468",fontFamily:"'Fira Code',monospace",fontSize:11,display:"flex",alignItems:"center",gap:8}}>
                  <span>⚠</span><span>{periodWarning}</span>
                </div>
              )}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:20}}>
              <div style={s.inputGroup}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <label style={s.label}>Trailing Income Statement <span style={s.hint}>(CSV or plain text)</span></label>
                  <button className="btn" onClick={()=>isFileRef.current?.click()}
                    style={{...s.btnOutline,fontSize:10,padding:"3px 10px",marginBottom:4}}>
                    Upload CSV
                  </button>
                  <input ref={isFileRef} type="file" accept=".csv,.txt" style={{display:"none"}}
                    onChange={e=>{ readIsCsv(e.target.files?.[0], setIncomeStatement, setReviewError); e.target.value=""; }}/>
                </div>
                <textarea style={{...s.textarea,minHeight:240}}
                  placeholder={"Account Number, Account Name, Apr 2025, May 2025, ...\n411001, Residential Income, 466989, 466831, ...\n414000, Vacancy Loss, -30349, -23254, ..."}
                  value={incomeStatement} onChange={e=>setIncomeStatement(e.target.value)}/>
              </div>
              <div style={s.inputGroup}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <label style={s.label}>GL Entries <span style={s.hint}>(CSV or plain text)</span></label>
                  <button className="btn" onClick={()=>glFileRef.current?.click()}
                    style={{...s.btnOutline,fontSize:10,padding:"3px 10px",marginBottom:4}}>
                    Upload CSV
                  </button>
                  <input ref={glFileRef} type="file" accept=".csv,.txt" style={{display:"none"}}
                    onChange={e=>{ const f = e.target.files?.[0]; readGlCsv(f, setGlEntries, setReviewError); setGlFileName(f?.name ?? ""); e.target.value=""; }}/>
                </div>
                <textarea style={{...s.textarea,minHeight:240}}
                  placeholder={"Date, Account, Description, Debit, Credit\n02/25/2026, 601002, RED SEAL FILL VALVE, 9589.33,\n02/25/2026, 601039, PAPER TOWEL ROLLS, 9589.33,"}
                  value={glEntries} onChange={e=>setGlEntries(e.target.value)}/>
              </div>
              <div style={s.inputGroup}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <label style={s.label}>Budget Statement <span style={s.hint}>Annual budget CSV</span></label>
                  <button className="btn" onClick={()=>budgetFileRef.current?.click()}
                    style={{...s.btnOutline,fontSize:10,padding:"3px 10px",marginBottom:4}}>
                    Upload CSV
                  </button>
                  <input ref={budgetFileRef} type="file" accept=".csv,.txt" style={{display:"none"}}
                    onChange={e=>{ readBudgetCsv(e.target.files?.[0], setBudgetData, setBudgetError); e.target.value=""; }}/>
                </div>
                <div style={{...s.textarea,minHeight:240,display:"flex",flexDirection:"column",justifyContent:"center",
                  alignItems:"center",gap:8,cursor:"pointer",color:"#4b5563"}}
                  onClick={()=>budgetFileRef.current?.click()}>
                  {budgetError
                    ? <span style={{color:"#f87171",fontSize:11,textAlign:"center"}}>{budgetError}</span>
                    : budgetData
                      ? <>
                          <span style={{color:"#4ade80",fontSize:11}}>✓ Budget loaded</span>
                          <span style={{fontFamily:"'Fira Code',monospace",fontSize:10,color:"#6b7280"}}>
                            {budgetData.split("\n").length - 1} accounts · click to replace
                          </span>
                        </>
                      : <>
                          <span style={{fontSize:18,opacity:0.3}}>$</span>
                          <span style={{fontFamily:"'Fira Code',monospace",fontSize:10,textAlign:"center",lineHeight:1.6}}>
                            Upload annual budget CSV<br/>Review month column extracted automatically
                          </span>
                        </>
                  }
                </div>
              </div>
            </div>
            {reviewError && <div style={s.error}>{reviewError}</div>}
            <div style={{display:"flex",justifyContent:"flex-end",marginTop:20}}>
              <button className="btn" onClick={runReview} disabled={reviewing} style={s.btnGold}>
                {reviewing ? <span className="pulsing">{reviewStatus || "Reviewing..."}</span> : "Run Review →"}
              </button>
            </div>
          </div>
        )}

        {tab==="findings" && (
          <div className="fade-up" style={s.panel}>
            <div style={s.panelHead}>
              <h2 style={s.panelTitle}>Findings</h2>
              <p style={s.panelDesc}>
                {findings.length > 0
                  ? <span>Results for <strong style={{color:"#e8c468"}}>{monthLabel}</strong>. Copy for staff distribution, or use Refine Checklist to improve future reviews.</span>
                  : "No findings yet - run a review first."}
              </p>
              {findings.length > 0 && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                  <button className="btn" onClick={downloadXlsx} style={s.btnOutline}>
                    Download .xlsx
                  </button>
                </div>
              )}
            </div>
            {findings.length > 0 ? (
              <div style={s.findingsBox}>
                {findings.map((item, i) => (
                  <div key={i} style={{borderBottom:"1px solid #1e1e1e", padding:"16px 0"}}>
                    <div style={{fontFamily:"'Syne',sans-serif", fontWeight:600, fontSize:14, color:"#f5f5f5", marginBottom:8}}>
                      {item.accountName} ({item.accountNumber})
                    </div>
                    {item.isIssue && (
                      <div style={{marginBottom:6}}>
                        <span style={{fontFamily:"'Fira Code',monospace", fontSize:10, color:"#e8c468", letterSpacing:0.5}}>IS · </span>
                        <span style={{fontFamily:"'Lora',serif", fontSize:13, lineHeight:1.7, color:"#9ca3af"}}>{item.isIssue}</span>
                      </div>
                    )}
                    {item.glIssue && (
                      <div style={{marginBottom:6}}>
                        <span style={{fontFamily:"'Fira Code',monospace", fontSize:10, color:"#60a5fa", letterSpacing:0.5}}>GL · </span>
                        <span style={{fontFamily:"'Lora',serif", fontSize:13, lineHeight:1.7, color:"#9ca3af"}}>{item.glIssue}</span>
                      </div>
                    )}
                    {item.budgetIssue && (
                      <div style={{marginBottom:6}}>
                        <span style={{fontFamily:"'Fira Code',monospace", fontSize:10, color:"#f97316", letterSpacing:0.5}}>BUD · </span>
                        <span style={{fontFamily:"'Lora',serif", fontSize:13, lineHeight:1.7, color:"#9ca3af"}}>{item.budgetIssue}</span>
                      </div>
                    )}
                    {item.action && (
                      <div>
                        <span style={{fontFamily:"'Fira Code',monospace", fontSize:10, color:"#4ade80", letterSpacing:0.5}}>Action · </span>
                        <span style={{fontFamily:"'Lora',serif", fontSize:13, lineHeight:1.7, color:"#9ca3af"}}>{item.action}</span>
                      </div>
                    )}

                    {/* IS / GL detail toggles */}
                    <div style={{display:"flex",gap:6,marginTop:10}}>
                      {incomeStatement && (
                        <button className="btn" onClick={() => toggleDetail(item.accountNumber, "is")}
                          style={{...s.btnOutline,fontSize:10,padding:"2px 10px",
                            color: detailOpen[item.accountNumber]?.is ? "#e8c468" : "#4b5563",
                            borderColor: detailOpen[item.accountNumber]?.is ? "#e8c468" : "#2a2a2a"}}>
                          IS {detailOpen[item.accountNumber]?.is ? "▲" : "▼"}
                        </button>
                      )}
                      {glEntries && (
                        <button className="btn" onClick={() => toggleDetail(item.accountNumber, "gl")}
                          style={{...s.btnOutline,fontSize:10,padding:"2px 10px",
                            color: detailOpen[item.accountNumber]?.gl ? "#60a5fa" : "#4b5563",
                            borderColor: detailOpen[item.accountNumber]?.gl ? "#60a5fa" : "#2a2a2a"}}>
                          GL {detailOpen[item.accountNumber]?.gl ? "▲" : "▼"}
                        </button>
                      )}
                    </div>

                    {/* IS detail table */}
                    {detailOpen[item.accountNumber]?.is && (() => {
                      const d = parseIsDetail(incomeStatement, item.accountNumber);
                      if (!d) return <div style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#4b5563",marginTop:8}}>No IS data found for {item.accountNumber}.</div>;
                      const tblCell = (align, extra) => ({
                        padding:"4px 10px", textAlign:align, borderBottom:"1px solid #141414",
                        fontFamily:"'Fira Code',monospace", fontSize:11, whiteSpace:"nowrap", ...extra
                      });
                      return (
                        <div style={{marginTop:10,overflowX:"auto",borderRadius:6,border:"1px solid #1e1e1e"}}>
                          <table style={{borderCollapse:"collapse",width:"100%"}}>
                            <thead>
                              <tr style={{background:"#111"}}>
                                {d.headers.map((h,hi) => (
                                  <th key={hi} style={tblCell(hi<=1?"left":"right",{color:"#4b5563",fontWeight:400})}>
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {d.dataRows.map((row,ri) => (
                                <tr key={ri} style={{background: ri%2===0?"transparent":"#0a0a0a"}}>
                                  {row.map((v,vi) => {
                                    const num = vi >= 2 ? parseFloat(v) : NaN;
                                    const fmt = !isNaN(num) ? num.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}) : v;
                                    return (
                                      <td key={vi} style={tblCell(vi<=1?"left":"right",{
                                        color: vi<2 ? "#6b7280" : num<0 ? "#f87171" : num===0 ? "#374151" : "#d1d5db"
                                      })}>
                                        {fmt}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                              {d.sumRow && (
                                <tr style={{background:"#0d1a0d",borderTop:"1px solid #2a3a2a"}}>
                                  {d.sumRow.map((v,vi) => {
                                    const num = vi >= 2 ? parseFloat(v) : NaN;
                                    const fmt = !isNaN(num) ? num.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}) : v;
                                    return (
                                      <td key={vi} style={tblCell(vi<=1?"left":"right",{
                                        color: vi<2 ? "#4ade80" : num<0 ? "#f87171" : num===0 ? "#374151" : "#4ade80",
                                        fontWeight:600
                                      })}>
                                        {fmt}
                                      </td>
                                    );
                                  })}
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      );
                    })()}

                    {/* GL detail table */}
                    {detailOpen[item.accountNumber]?.gl && (() => {
                      const isRangeAcct = /^\d{5,6}-\d{5,6}$/.test(item.accountNumber);
                      if (isRangeAcct) return <div style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#4b5563",marginTop:8}}>No GL entries for {item.accountNumber} due to multiple accounts.</div>;
                      const entries = parseGlDetail(glEntries, item.accountNumber);
                      if (!entries) return <div style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#4b5563",marginTop:8}}>No GL entries found for {item.accountNumber}.</div>;
                      const isData = parseIsDetail(incomeStatement, item.accountNumber);
                      const check  = glPeriodCheck(entries, isData, reviewMonth);
                      if (check && !check.match) {
                        const fmt = n => (n < 0 ? "(" : "") + "$" + Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}) + (n < 0 ? ")" : "");
                        return <div style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#fbbf24",marginTop:8,padding:"8px 12px",border:"1px solid #92400e",borderRadius:6,background:"#1c1000"}}>
                          ⚠ GL does not reconcile with IS for {reviewMonth}. GL net (debit − credit): {fmt(check.glNet)} · IS: {fmt(check.isAmount)}
                        </div>;
                      }
                      const tblCell = (align, extra) => ({
                        padding:"4px 10px", textAlign:align, borderBottom:"1px solid #141414",
                        fontFamily:"'Fira Code',monospace", fontSize:11, ...extra
                      });
                      return (
                        <div style={{marginTop:10,overflowX:"auto",borderRadius:6,border:"1px solid #1e1e1e"}}>
                          <table style={{borderCollapse:"collapse",width:"100%"}}>
                            <thead>
                              <tr style={{background:"#111"}}>
                                {["Date","Description","Debit","Credit"].map(h => (
                                  <th key={h} style={tblCell(h==="Description"?"left":"right",{color:"#4b5563",fontWeight:400,whiteSpace:"nowrap"})}>
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {entries.map((e,ei) => (
                                <tr key={ei} style={{background: ei%2===0?"transparent":"#0a0a0a"}}>
                                  <td style={tblCell("left",{color:"#6b7280",whiteSpace:"nowrap"})}>{e.date}</td>
                                  <td style={tblCell("left",{color:"#9ca3af",maxWidth:380,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"})}>{e.desc}</td>
                                  <td style={tblCell("right",{color:"#4ade80",whiteSpace:"nowrap"})}>{e.debit}</td>
                                  <td style={tblCell("right",{color:"#f87171",whiteSpace:"nowrap"})}>{e.credit}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            ) : (
              <div style={s.empty}>
                <div style={{fontSize:28, color:"#2a2a2a", marginBottom:12}}>◈</div>
                <div style={{fontFamily:"'Lora',serif", fontSize:14, fontStyle:"italic", color:"#4b5563"}}>Run a review to see findings here</div>
                <button className="btn" onClick={()=>setTab("review")} style={{...s.btnGold, marginTop:16}}>Go to Review →</button>
              </div>
            )}
          </div>
        )}


        {tab==="checklist" && (
          <div className="fade-up" style={s.panel}>
            <div style={s.panelHead}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div>
                  <h2 style={s.panelTitle}>Master Checklist</h2>
                  <p style={s.panelDesc}>{totalChecks} rules across {Object.keys(grouped).length} categories.</p>
                </div>
                <div style={{display:"flex",gap:8,flexShrink:0,alignItems:"center"}}>
                  {checklistSaveMsg && (
                    <span style={{fontFamily:"'Fira Code',monospace",fontSize:11,
                      color: checklistSaveMsg === "Saved" ? "#4ade80" : "#f87171"}}>
                      {checklistSaveMsg}
                    </span>
                  )}
                  {checklistDirty && !checklistSaveMsg && (
                    <span style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#e8c468"}}>unsaved</span>
                  )}
                  <button className="btn" onClick={saveChecklist} disabled={!checklistDirty || checklistSaving}
                    style={{...s.btnGold,fontSize:11,padding:"5px 14px",opacity:(!checklistDirty||checklistSaving)?0.4:1}}>
                    {checklistSaving ? "Saving..." : "Save"}
                  </button>
                  <button className="btn" onClick={()=>updateItems(DEFAULT_ITEMS)} style={{...s.btnOutline,fontSize:11,padding:"5px 12px"}}>Reset</button>
                  <button className="btn" onClick={exportJson} style={{...s.btnOutline,fontSize:11,padding:"5px 12px"}}>Export JSON</button>
                  <button className="btn" onClick={()=>fileInputRef.current?.click()} style={{...s.btnOutline,fontSize:11,padding:"5px 12px"}}>Import JSON</button>
                  <input ref={fileInputRef} type="file" accept=".json" style={{display:"none"}} onChange={handleImport}/>
                  <button className="btn" onClick={()=>setAdding(a=>!a)} style={{...s.btnGold,fontSize:12,padding:"6px 16px"}}>
                    {adding?"Cancel":"+ Add Check"}
                  </button>
                </div>
              </div>
            </div>

            {importError && <div style={{...s.error,marginBottom:16}}>{importError}</div>}

            {adding && (
              <div style={{background:"#0a1a0a",border:"1px solid #1a3a1a",borderRadius:10,padding:"16px 18px",marginBottom:24}}>
                <div style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#4ade80",marginBottom:12,letterSpacing:0.5}}>NEW CHECK</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                  <div style={s.inputGroup}>
                    <label style={s.label}>Category</label>
                    <select value={newItem.category} onChange={e=>setNewItem(n=>({...n,category:e.target.value}))} style={s.select}>
                      {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div style={s.inputGroup}>
                    <label style={s.label}>Source</label>
                    <select value={newItem.source} onChange={e=>setNewItem(n=>({...n,source:e.target.value}))} style={s.select}>
                      <option value="IS">IS</option>
                      <option value="GL">GL</option>
                    </select>
                  </div>
                </div>
                <div style={{...s.inputGroup,marginBottom:12}}>
                  <label style={s.label}>Accounts <span style={s.hint}>(optional)</span></label>
                  <input value={newItem.accounts} onChange={e=>setNewItem(n=>({...n,accounts:e.target.value}))}
                    style={s.input} placeholder="e.g. 601001-601049 or leave blank"/>
                </div>
                <div style={{...s.inputGroup,marginBottom:12}}>
                  <label style={s.label}>Rule Text</label>
                  <textarea value={newItem.text} onChange={e=>setNewItem(n=>({...n,text:e.target.value}))}
                    style={{...s.textarea,minHeight:70}} placeholder="Describe the condition to check or flag..."/>
                </div>
                <div style={{display:"flex",justifyContent:"flex-end",gap:8}}>
                  <button className="btn" onClick={()=>setAdding(false)} style={s.btnOutline}>Cancel</button>
                  <button className="btn" onClick={addItem} disabled={!newItem.text.trim()} style={s.btnGold}>Add Check</button>
                </div>
              </div>
            )}

            {Object.entries(grouped).map(([category,catItems])=>(
              <div key={category} style={{marginBottom:28}}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
                  <div style={{width:6,height:6,borderRadius:"50%",background:"#e8c468",flexShrink:0}}/>
                  <span style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:13,color:"#f5f5f5"}}>{category}</span>
                  {catItems[0].accounts && (
                    <span style={{fontFamily:"'Fira Code',monospace",fontSize:10,color:"#4b5563"}}>{catItems[0].accounts}</span>
                  )}
                  <div style={{flex:1,height:1,background:"#1e1e1e"}}/>
                  <span style={{fontFamily:"'Fira Code',monospace",fontSize:10,color:"#4b5563"}}>{catItems.length} {catItems.length===1?"check":"checks"}</span>
                </div>

                {catItems.map(item=>(
                  <div key={item.id} className="item-row"
                    style={{display:"flex",alignItems:"flex-start",gap:10,padding:"9px 10px",
                      borderRadius:7,marginBottom:3,background:editingId===item.id?"#111":"transparent",
                      border:editingId===item.id?"1px solid #2a2a2a":"1px solid transparent",transition:"all 0.1s"}}>

                    {editingId===item.id ? (
                      <div style={{flex:1}}>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                          <div style={s.inputGroup}>
                            <label style={s.label}>Category</label>
                            <select value={editDraft.category} onChange={e=>setEditDraft(d=>({...d,category:e.target.value}))} style={s.select}>
                              {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
                            </select>
                          </div>
                          <div style={s.inputGroup}>
                            <label style={s.label}>Source</label>
                            <select value={editDraft.source || "IS"} onChange={e=>setEditDraft(d=>({...d,source:e.target.value}))} style={s.select}>
                              <option value="IS">IS</option>
                              <option value="GL">GL</option>
                            </select>
                          </div>
                        </div>
                        <div style={{...s.inputGroup,marginBottom:10}}>
                          <label style={s.label}>Accounts</label>
                          <input value={editDraft.accounts} onChange={e=>setEditDraft(d=>({...d,accounts:e.target.value}))} style={s.input}/>
                        </div>
                        <div style={{...s.inputGroup,marginBottom:10}}>
                          <label style={s.label}>Rule Text</label>
                          <textarea value={editDraft.text} onChange={e=>setEditDraft(d=>({...d,text:e.target.value}))}
                            style={{...s.textarea,minHeight:64}}/>
                        </div>
                        <div style={{display:"flex",gap:8}}>
                          <button className="btn" onClick={saveEdit} style={{...s.btnGold,fontSize:12,padding:"5px 14px"}}>Save</button>
                          <button className="btn" onClick={cancelEdit} style={{...s.btnOutline,fontSize:12,padding:"5px 12px"}}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{flexShrink:0,marginTop:1}}>
                          <span style={{fontFamily:"'Fira Code',monospace",fontSize:9,fontWeight:600,
                            padding:"2px 6px",borderRadius:3,whiteSpace:"nowrap",
                            background:(item.source||"IS")==="IS"?"#0a1a0a":"#1a0a1a",
                            color:(item.source||"IS")==="IS"?"#4ade80":"#c084fc",
                            border:"1px solid "+((item.source||"IS")==="IS"?"#1a3a1a":"#3a1a3a")}}>
                            {item.source||"IS"}
                          </span>
                        </div>
                        <div style={{flex:1,fontFamily:"'Lora',serif",fontSize:13,color:"#d1d5db",lineHeight:1.6}}>
                          {item.text}
                        </div>
                        <div className="item-actions" style={{display:"flex",gap:4,opacity:0,transition:"opacity 0.15s",flexShrink:0}}>
                          <button className="btn" onClick={()=>startEdit(item)}
                            style={{background:"transparent",border:"1px solid #2a2a2a",borderRadius:5,
                              color:"#6b7280",fontSize:11,padding:"3px 8px",fontFamily:"'Fira Code',monospace"}}>
                            edit
                          </button>
                          <button className="btn" onClick={()=>deleteItem(item.id)}
                            style={{background:"transparent",border:"1px solid #3a1a1a",borderRadius:5,
                              color:"#ef4444",fontSize:11,padding:"3px 8px",fontFamily:"'Fira Code',monospace"}}>
                            x
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {tab==="history" && (
          <div className="fade-up" style={s.panel}>
            <div style={s.panelHead}>
              <h2 style={s.panelTitle}>Review History</h2>
              <p style={s.panelDesc}>Every review is saved automatically with its source data and checklist snapshot.</p>
            </div>

            {historyLoading && (
              <div style={{textAlign:"center",padding:"40px 0",fontFamily:"'Fira Code',monospace",fontSize:12,color:"#4b5563"}}>
                Loading history…
              </div>
            )}

            {!historyLoading && historyLoaded && historyIndex.length === 0 && (
              <div style={s.empty}>
                <div style={{fontSize:28,color:"#2a2a2a",marginBottom:12}}>◈</div>
                <div style={{fontFamily:"'Lora',serif",fontSize:14,fontStyle:"italic",color:"#4b5563"}}>No reviews saved yet — run your first review to start building history.</div>
              </div>
            )}

            {!historyLoading && historyIndex.length > 0 && (() => {
              // Group by property
              const grouped = {};
              historyIndex.forEach(r => {
                const key = r.property || "Unknown Property";
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push(r);
              });
              return Object.entries(grouped).map(([prop, reviews]) => (
                <div key={prop} style={{marginBottom:32}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:"#e8c468",flexShrink:0}}/>
                    <span style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:13,color:"#f5f5f5"}}>{prop}</span>
                    <div style={{flex:1,height:1,background:"#1e1e1e"}}/>
                    <span style={{fontFamily:"'Fira Code',monospace",fontSize:10,color:"#4b5563"}}>{reviews.length} review{reviews.length!==1?"s":""}</span>
                  </div>
                  {reviews.map((r, i) => {
                    const [y, m] = r.period.split("-");
                    const periodLabel = new Date(+y, +m-1).toLocaleString("en-US", {month:"long",year:"numeric"});
                    const dateLabel   = new Date(r.timestamp).toLocaleString("en-US", {month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"});
                    const isExpanded    = expandedReview?.blobUrl === r.blobUrl;
                    const isFeedback    = feedbackMode === r.blobUrl;
                    const loadReview    = () => {
                      if (expandedReview?.blobUrl === r.blobUrl) return Promise.resolve();
                      return new Promise(resolve => {
                        setExpandedReview({ blobUrl: r.blobUrl, data: null, loading: true });
                        fetch(`/api/history?url=${encodeURIComponent(r.blobUrl)}`)
                          .then(res => res.json())
                          .then(data => { setExpandedReview({ blobUrl: r.blobUrl, data, loading: false }); resolve(data); })
                          .catch(() => { setExpandedReview({ blobUrl: r.blobUrl, data: null, loading: false, error: true }); resolve(null); });
                      });
                    };
                    return (
                      <div key={i} style={{borderBottom:"1px solid #1a1a1a",paddingBottom:12,marginBottom:12}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
                          <div style={{display:"flex",alignItems:"center",gap:14,flex:1,flexWrap:"wrap"}}>
                            <span style={{fontFamily:"'Syne',sans-serif",fontWeight:600,fontSize:13,color:"#f5f5f5"}}>{periodLabel}</span>
                            <span style={{fontFamily:"'Fira Code',monospace",fontSize:10,color:"#4b5563"}}>{r.findingCount} finding{r.findingCount!==1?"s":""}</span>
                            <span style={{fontFamily:"'Fira Code',monospace",fontSize:10,color:"#374151"}}>{dateLabel}</span>
                            {r.hasFeedback && (
                              <span style={{fontFamily:"'Fira Code',monospace",fontSize:9,padding:"2px 7px",
                                background: r.feedbackCommitted ? "#052e16" : "#1c1a0a",
                                border: `1px solid ${r.feedbackCommitted ? "#4ade80" : "#e8c468"}`,
                                borderRadius:4,
                                color: r.feedbackCommitted ? "#4ade80" : "#e8c468"}}>
                                {r.feedbackCommitted ? "✓ committed" : "feedback"}
                              </span>
                            )}
                          </div>
                          <div style={{display:"flex",gap:6,flexShrink:0}}>
                            <button className="btn" style={{...s.btnOutline,fontSize:11,padding:"4px 12px"}}
                              onClick={() => {
                                if (isExpanded && !isFeedback) { setExpandedReview(null); return; }
                                setFeedbackMode(null);
                                loadReview();
                              }}>
                              {isExpanded && !isFeedback ? "Collapse" : "View"}
                            </button>
                            <button className="btn" style={{...s.btnOutline,fontSize:11,padding:"4px 12px",
                              borderColor: isFeedback ? "#e8c468" : "#4b5563", color: isFeedback ? "#e8c468" : "#d1d5db"}}
                              onClick={() => {
                                if (isFeedback) { setFeedbackMode(null); return; }
                                // Load review first, then load any existing feedback
                                loadReview().then(() => {
                                  fetch(`/api/feedback?blobUrl=${encodeURIComponent(r.blobUrl)}`)
                                    .then(res => res.json())
                                    .then(existing => {
                                      setFeedbackDraft({
                                        findings:     existing?.findings     || {},
                                        accountNotes: existing?.accountNotes?.length
                                          ? existing.accountNotes
                                          : [{ id: 1, accountNumber: "", note: "" }],
                                        general:      existing?.general      || "",
                                      });
                                      setFeedbackMode(r.blobUrl);
                                      setFeedbackSaved(false);
                                    })
                                    .catch(() => {
                                      setFeedbackDraft({ findings: {}, accountNotes: [{ id: 1, accountNumber: "", note: "" }], general: "" });
                                      setFeedbackMode(r.blobUrl);
                                    });
                                });
                              }}>
                              {isFeedback ? "Cancel" : "Add Feedback"}
                            </button>
                            {r.hasFeedback && !r.feedbackCommitted && !isFeedback && (
                              <button className="btn" style={{...s.btnOutline,fontSize:11,padding:"4px 12px",
                                borderColor:"#4ade80",color:"#4ade80"}}
                                onClick={async () => {
                                  if (!window.confirm("Commit this feedback for training? This marks it as manager-approved.")) return;
                                  try {
                                    const res = await fetch("/api/feedback", {
                                      method: "POST",
                                      headers: {"Content-Type":"application/json"},
                                      body: JSON.stringify({ blobUrl: r.blobUrl, action: "commit" }),
                                    });
                                    if (!res.ok) throw new Error();
                                    setHistoryIndex(prev => prev.map(e =>
                                      e.blobUrl === r.blobUrl ? { ...e, feedbackCommitted: true } : e
                                    ));
                                  } catch { alert("Failed to commit feedback — please try again."); }
                                }}>
                                Commit Feedback
                              </button>
                            )}
                            {r.feedbackCommitted && !isFeedback && (
                              <button className="btn" style={{...s.btnOutline,fontSize:11,padding:"4px 12px",
                                borderColor:"#6b7280",color:"#6b7280"}}
                                onClick={async () => {
                                  if (!window.confirm("Uncommit this feedback? It will no longer be marked for training.")) return;
                                  try {
                                    const res = await fetch("/api/feedback", {
                                      method: "POST",
                                      headers: {"Content-Type":"application/json"},
                                      body: JSON.stringify({ blobUrl: r.blobUrl, action: "uncommit" }),
                                    });
                                    if (!res.ok) throw new Error();
                                    setHistoryIndex(prev => prev.map(e =>
                                      e.blobUrl === r.blobUrl ? { ...e, feedbackCommitted: false } : e
                                    ));
                                  } catch { alert("Failed to uncommit feedback — please try again."); }
                                }}>
                                Uncommit
                              </button>
                            )}
                            <button className="btn" style={{...s.btnOutline,fontSize:11,padding:"4px 12px",
                              borderColor:"#7f1d1d",color:"#f87171"}}
                              onClick={async () => {
                                if (!window.confirm(`Delete this review (${periodLabel})? This cannot be undone.`)) return;
                                try {
                                  const res = await fetch("/api/history", {
                                    method: "DELETE",
                                    headers: {"Content-Type":"application/json"},
                                    body: JSON.stringify({ blobUrl: r.blobUrl }),
                                  });
                                  if (!res.ok) throw new Error();
                                  setHistoryIndex(prev => prev.filter(e => e.blobUrl !== r.blobUrl));
                                  if (expandedReview?.blobUrl === r.blobUrl) setExpandedReview(null);
                                  if (feedbackMode === r.blobUrl) setFeedbackMode(null);
                                } catch { alert("Failed to delete review — please try again."); }
                              }}>
                              Delete
                            </button>
                          </div>
                        </div>

                        {isExpanded && expandedReview.loading && (
                          <div style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#4b5563",paddingTop:12}}>Loading…</div>
                        )}
                        {isExpanded && expandedReview.error && (
                          <div style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#f87171",paddingTop:12}}>Failed to load review.</div>
                        )}
                        {isExpanded && expandedReview.data && (
                          <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
                            {[
                              { key:"is",     label:"Income Statement" },
                              { key:"gl",     label:"GL Report" },
                              { key:"budget", label:"Budget" },
                            ].map(({key, label}) => {
                              const csv = expandedReview.data.csvs?.[key];
                              if (!csv) return null;
                              return (
                                <a key={key}
                                  href={URL.createObjectURL(new Blob([csv], {type:"text/csv"}))}
                                  download={`${r.property}-${r.period}-${label.replace(/ /g,"-")}.csv`}
                                  style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#e8c468",
                                    border:"1px solid #2a2a1a",borderRadius:5,padding:"4px 10px",
                                    textDecoration:"none",background:"transparent"}}>
                                  ↓ {label}
                                </a>
                              );
                            })}
                          </div>
                        )}

                        {isExpanded && expandedReview.data?.findings && (
                          <div style={{marginTop:16}}>
                            {expandedReview.data.findings.map((item, fi) => {
                              const fb = feedbackDraft.findings[item.accountNumber] || {};
                              return (
                                <div key={fi} style={{borderBottom:"1px solid #161616",padding:"12px 0"}}>
                                  <div style={{fontFamily:"'Syne',sans-serif",fontWeight:600,fontSize:13,color:"#f5f5f5",marginBottom:6}}>
                                    {item.accountName} ({item.accountNumber})
                                  </div>
                                  {item.isIssue && <div style={{marginBottom:4}}>
                                    <span style={{fontFamily:"'Fira Code',monospace",fontSize:10,color:"#e8c468"}}>IS · </span>
                                    <span style={{fontFamily:"'Lora',serif",fontSize:13,lineHeight:1.7,color:"#9ca3af"}}>{item.isIssue}</span>
                                  </div>}
                                  {item.glIssue && <div style={{marginBottom:4}}>
                                    <span style={{fontFamily:"'Fira Code',monospace",fontSize:10,color:"#60a5fa"}}>GL · </span>
                                    <span style={{fontFamily:"'Lora',serif",fontSize:13,lineHeight:1.7,color:"#9ca3af"}}>{item.glIssue}</span>
                                  </div>}
                                  {item.budgetIssue && <div style={{marginBottom:4}}>
                                    <span style={{fontFamily:"'Fira Code',monospace",fontSize:10,color:"#f97316"}}>BUD · </span>
                                    <span style={{fontFamily:"'Lora',serif",fontSize:13,lineHeight:1.7,color:"#9ca3af"}}>{item.budgetIssue}</span>
                                  </div>}
                                  {item.action && <div>
                                    <span style={{fontFamily:"'Fira Code',monospace",fontSize:10,color:"#4ade80"}}>Action · </span>
                                    <span style={{fontFamily:"'Lora',serif",fontSize:13,lineHeight:1.7,color:"#9ca3af"}}>{item.action}</span>
                                  </div>}

                                  {/* History IS / GL detail toggles — only shown in feedback mode */}
                                  {isFeedback && (() => {
                                    const hKey = `${r.blobUrl}:${item.accountNumber}`;
                                    const hd   = historyDetailOpen[hKey] || {};
                                    const isCs = expandedReview.data.csvs?.is;
                                    const glCs = expandedReview.data.csvs?.gl;
                                    const tblCell = (align, extra) => ({
                                      padding:"4px 10px", textAlign:align, borderBottom:"1px solid #141414",
                                      fontFamily:"'Fira Code',monospace", fontSize:11, ...extra
                                    });
                                    return (
                                      <>
                                        <div style={{display:"flex",gap:6,marginTop:10}}>
                                          {isCs && (
                                            <button className="btn"
                                              onClick={() => toggleHistoryDetail(hKey,"is")}
                                              style={{...s.btnOutline,fontSize:10,padding:"2px 10px",
                                                color: hd.is ? "#e8c468" : "#4b5563",
                                                borderColor: hd.is ? "#e8c468" : "#2a2a2a"}}>
                                              IS {hd.is ? "▲" : "▼"}
                                            </button>
                                          )}
                                          {glCs && (
                                            <button className="btn"
                                              onClick={() => toggleHistoryDetail(hKey,"gl")}
                                              style={{...s.btnOutline,fontSize:10,padding:"2px 10px",
                                                color: hd.gl ? "#60a5fa" : "#4b5563",
                                                borderColor: hd.gl ? "#60a5fa" : "#2a2a2a"}}>
                                              GL {hd.gl ? "▲" : "▼"}
                                            </button>
                                          )}
                                        </div>

                                        {hd.is && (() => {
                                          const d = parseIsDetail(isCs, item.accountNumber);
                                          if (!d) return <div style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#4b5563",marginTop:8}}>No IS data for {item.accountNumber}.</div>;
                                          return (
                                            <div style={{marginTop:10,overflowX:"auto",borderRadius:6,border:"1px solid #1e1e1e"}}>
                                              <table style={{borderCollapse:"collapse",width:"100%"}}>
                                                <thead>
                                                  <tr style={{background:"#111"}}>
                                                    {d.headers.map((h,hi) => (
                                                      <th key={hi} style={tblCell(hi<=1?"left":"right",{color:"#4b5563",fontWeight:400,whiteSpace:"nowrap"})}>{h}</th>
                                                    ))}
                                                  </tr>
                                                </thead>
                                                <tbody>
                                                  {d.dataRows.map((row,ri) => (
                                                    <tr key={ri} style={{background:ri%2===0?"transparent":"#0a0a0a"}}>
                                                      {row.map((v,vi) => {
                                                        const num = vi>=2 ? parseFloat(v) : NaN;
                                                        const fmt = !isNaN(num) ? num.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}) : v;
                                                        return <td key={vi} style={tblCell(vi<=1?"left":"right",{color:vi<2?"#6b7280":num<0?"#f87171":num===0?"#374151":"#d1d5db"})}>{fmt}</td>;
                                                      })}
                                                    </tr>
                                                  ))}
                                                  {d.sumRow && (
                                                    <tr style={{background:"#0d1a0d",borderTop:"1px solid #2a3a2a"}}>
                                                      {d.sumRow.map((v,vi) => {
                                                        const num = vi>=2 ? parseFloat(v) : NaN;
                                                        const fmt = !isNaN(num) ? num.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}) : v;
                                                        return <td key={vi} style={tblCell(vi<=1?"left":"right",{color:vi<2?"#4ade80":num<0?"#f87171":num===0?"#374151":"#4ade80",fontWeight:600})}>{fmt}</td>;
                                                      })}
                                                    </tr>
                                                  )}
                                                </tbody>
                                              </table>
                                            </div>
                                          );
                                        })()}

                                        {hd.gl && (() => {
                                          const isRangeAcct = /^\d{5,6}-\d{5,6}$/.test(item.accountNumber);
                                          if (isRangeAcct) return <div style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#4b5563",marginTop:8}}>No GL entries for {item.accountNumber} due to multiple accounts.</div>;
                                          const entries = parseGlDetail(glCs, item.accountNumber);
                                          if (!entries) return <div style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#4b5563",marginTop:8}}>No GL entries for {item.accountNumber}.</div>;
                                          const isData = parseIsDetail(isCs, item.accountNumber);
                                          const check  = glPeriodCheck(entries, isData, r.period);
                                          if (check && !check.match) {
                                            const fmt = n => (n < 0 ? "(" : "") + "$" + Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}) + (n < 0 ? ")" : "");
                                            return <div style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#fbbf24",marginTop:8,padding:"8px 12px",border:"1px solid #92400e",borderRadius:6,background:"#1c1000"}}>
                                              ⚠ GL does not reconcile with IS for {r.period}. GL net (debit − credit): {fmt(check.glNet)} · IS: {fmt(check.isAmount)}
                                            </div>;
                                          }
                                          return (
                                            <div style={{marginTop:10,overflowX:"auto",borderRadius:6,border:"1px solid #1e1e1e"}}>
                                              <table style={{borderCollapse:"collapse",width:"100%"}}>
                                                <thead>
                                                  <tr style={{background:"#111"}}>
                                                    {["Date","Description","Debit","Credit"].map(h => (
                                                      <th key={h} style={tblCell(h==="Description"?"left":"right",{color:"#4b5563",fontWeight:400,whiteSpace:"nowrap"})}>{h}</th>
                                                    ))}
                                                  </tr>
                                                </thead>
                                                <tbody>
                                                  {entries.map((e,ei) => (
                                                    <tr key={ei} style={{background:ei%2===0?"transparent":"#0a0a0a"}}>
                                                      <td style={tblCell("left",{color:"#6b7280",whiteSpace:"nowrap"})}>{e.date}</td>
                                                      <td style={tblCell("left",{color:"#9ca3af",maxWidth:340,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"})}>{e.desc}</td>
                                                      <td style={tblCell("right",{color:"#4ade80",whiteSpace:"nowrap"})}>{e.debit}</td>
                                                      <td style={tblCell("right",{color:"#f87171",whiteSpace:"nowrap"})}>{e.credit}</td>
                                                    </tr>
                                                  ))}
                                                </tbody>
                                              </table>
                                            </div>
                                          );
                                        })()}
                                      </>
                                    );
                                  })()}

                                  {isFeedback && (
                                    <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid #1a1a1a"}}>
                                      <div style={{display:"flex",gap:6,marginBottom:8}}>
                                        {[
                                          {val:"correct",        label:"✓ Correct",           color:"#4ade80"},
                                          {val:"false_positive", label:"✗ False Positive",    color:"#f87171"},
                                          {val:"needs_review",   label:"? Needs Review",      color:"#e8c468"},
                                        ].map(opt => (
                                          <button key={opt.val} className="btn"
                                            onClick={() => setFeedbackDraft(d => ({
                                              ...d,
                                              findings: {
                                                ...d.findings,
                                                [item.accountNumber]: { ...fb, rating: fb.rating === opt.val ? undefined : opt.val }
                                              }
                                            }))}
                                            style={{fontFamily:"'Fira Code',monospace",fontSize:10,padding:"3px 10px",
                                              background: fb.rating === opt.val ? opt.color + "22" : "transparent",
                                              border: `1px solid ${fb.rating === opt.val ? opt.color : "#2a2a2a"}`,
                                              borderRadius:4, color: fb.rating === opt.val ? opt.color : "#4b5563"}}>
                                            {opt.label}
                                          </button>
                                        ))}
                                      </div>
                                      <textarea
                                        placeholder="Review comments for this finding (optional)"
                                        value={fb.note || ""}
                                        onChange={e => setFeedbackDraft(d => ({
                                          ...d,
                                          findings: {
                                            ...d.findings,
                                            [item.accountNumber]: { ...fb, note: e.target.value }
                                          }
                                        }))}
                                        style={{...s.textarea,minHeight:44,fontSize:12,width:"100%",marginTop:6}}
                                      />
                                    </div>
                                  )}
                                </div>
                              );
                            })}

                            {isFeedback && (
                              <div style={{marginTop:20,paddingTop:16,borderTop:"1px solid #1e1e1e"}}>
                                <div style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#e8c468",marginBottom:12,letterSpacing:0.5}}>
                                  ACCOUNT-SPECIFIC FEEDBACK
                                </div>
                                {feedbackDraft.accountNotes.map((row, ri) => (
                                  <div key={row.id} style={{display:"flex",gap:8,alignItems:"flex-start",marginBottom:8}}>
                                    <input
                                      type="text"
                                      placeholder="Account #"
                                      value={row.accountNumber}
                                      onChange={e => setFeedbackDraft(d => ({
                                        ...d,
                                        accountNotes: d.accountNotes.map(r =>
                                          r.id === row.id ? { ...r, accountNumber: e.target.value } : r
                                        )
                                      }))}
                                      style={{...s.textarea,minHeight:0,height:36,fontSize:12,width:110,flexShrink:0,padding:"6px 10px"}}
                                    />
                                    <textarea
                                      placeholder="Account-specific feedback not mentioned above: be as specific as possible"
                                      value={row.note}
                                      onChange={e => setFeedbackDraft(d => ({
                                        ...d,
                                        accountNotes: d.accountNotes.map(r =>
                                          r.id === row.id ? { ...r, note: e.target.value } : r
                                        )
                                      }))}
                                      style={{...s.textarea,minHeight:36,fontSize:12,flex:1}}
                                    />
                                    {feedbackDraft.accountNotes.length > 1 && (
                                      <button className="btn" onClick={() => setFeedbackDraft(d => ({
                                        ...d,
                                        accountNotes: d.accountNotes.filter(r => r.id !== row.id)
                                      }))}
                                        style={{fontFamily:"'Fira Code',monospace",fontSize:12,padding:"6px 10px",
                                          color:"#4b5563",border:"1px solid #1e1e1e",borderRadius:4,
                                          background:"transparent",flexShrink:0,cursor:"pointer"}}>
                                        ✕
                                      </button>
                                    )}
                                  </div>
                                ))}
                                <button className="btn" onClick={() => setFeedbackDraft(d => ({
                                  ...d,
                                  accountNotes: [...d.accountNotes, { id: Date.now(), accountNumber: "", note: "" }]
                                }))}
                                  style={{fontFamily:"'Fira Code',monospace",fontSize:11,padding:"4px 14px",
                                    color:"#4b5563",border:"1px solid #1e1e1e",borderRadius:4,
                                    background:"transparent",cursor:"pointer",marginTop:2}}>
                                  + Add Account
                                </button>
                              </div>
                            )}

                            {isFeedback && (
                              <div style={{marginTop:16,paddingTop:16,borderTop:"1px solid #1e1e1e"}}>
                                <div style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#e8c468",marginBottom:8,letterSpacing:0.5}}>
                                  GENERAL FEEDBACK
                                </div>
                                <textarea
                                  placeholder="Additional observations, missed issues, context, or suggestions for improving future reviews…"
                                  value={feedbackDraft.general}
                                  onChange={e => setFeedbackDraft(d => ({...d, general: e.target.value}))}
                                  style={{...s.textarea,minHeight:90,width:"100%",marginBottom:12}}
                                />
                                <div style={{display:"flex",alignItems:"center",gap:12}}>
                                  <button className="btn" disabled={feedbackSaving}
                                    onClick={async () => {
                                      setFeedbackSaving(true);
                                      setFeedbackSaved(false);
                                      try {
                                        const res = await fetch("/api/feedback", {
                                          method: "POST",
                                          headers: {"Content-Type":"application/json"},
                                          body: JSON.stringify({
                                            blobUrl:  r.blobUrl,
                                            feedback: {
                                              ...feedbackDraft,
                                              reviewMeta: { property: r.property, period: r.period, timestamp: r.timestamp },
                                            },
                                          }),
                                        });
                                        if (!res.ok) throw new Error();
                                        setFeedbackSaved(true);
                                        setFeedbackMode(null);
                                        setHistoryIndex(prev => prev.map(e =>
                                          e.blobUrl === r.blobUrl ? { ...e, hasFeedback: true } : e
                                        ));
                                      } catch { alert("Failed to save feedback — please try again."); }
                                      finally { setFeedbackSaving(false); }
                                    }}
                                    style={{...s.btnGold,fontSize:12,padding:"6px 20px"}}>
                                    {feedbackSaving ? "Saving…" : "Submit Feedback"}
                                  </button>
                                  {feedbackSaved && <span style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#4ade80"}}>Saved</span>}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ));
            })()}
          </div>
        )}

      </main>
    </div>
  );
}

const s = {
  root:       {minHeight:"100vh",background:"#0e0e0e",color:"#f5f5f5"},
  header:     {borderBottom:"1px solid #1a1a1a",background:"#0e0e0e",position:"sticky",top:0,zIndex:100},
  headerInner:{maxWidth:980,margin:"0 auto",padding:"0 28px",display:"flex",alignItems:"center",justifyContent:"space-between",height:64},
  logo:       {display:"flex",alignItems:"center",gap:12},
  logoMark:   {fontSize:22,color:"#e8c468",lineHeight:1},
  logoTitle:  {fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15,color:"#f5f5f5",letterSpacing:0.3},
  logoSub:    {fontFamily:"'Fira Code',monospace",fontSize:10,color:"#4b5563",letterSpacing:0.5},
  nav:        {display:"flex",gap:2},
  tab:        {fontFamily:"'Fira Code',monospace",fontSize:11,color:"#4b5563",background:"transparent",
               border:"none",padding:"8px 14px",borderRadius:6,cursor:"pointer",position:"relative",letterSpacing:0.3},
  tabActive:  {color:"#e8c468",background:"#1a1a1a"},
  dot:        {display:"inline-block",width:5,height:5,borderRadius:"50%",background:"#e8c468",position:"absolute",top:6,right:6},
  badge:      {display:"inline-flex",alignItems:"center",justifyContent:"center",background:"#1e1e1e",color:"#6b7280",
               borderRadius:10,fontSize:9,fontFamily:"'Fira Code',monospace",padding:"1px 5px",marginLeft:4},
  main:       {maxWidth:980,margin:"0 auto",padding:"32px 28px 60px"},
  panel:      {background:"#111",border:"1px solid #1e1e1e",borderRadius:12,padding:"28px 32px"},
  panelHead:  {marginBottom:24,paddingBottom:20,borderBottom:"1px solid #1a1a1a"},
  panelTitle: {fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:22,color:"#f5f5f5",marginBottom:6},
  panelDesc:  {fontFamily:"'Lora',serif",fontSize:13,color:"#6b7280",lineHeight:1.6,maxWidth:620},
  stepLabel:  {fontFamily:"'Fira Code',monospace",fontSize:11,color:"#e8c468",letterSpacing:0.5,marginBottom:12},
  twoCol:     {display:"grid",gridTemplateColumns:"1fr 1fr",gap:20},
  inputGroup: {display:"flex",flexDirection:"column",gap:7},
  label:      {fontFamily:"'Fira Code',monospace",fontSize:10,color:"#9ca3af",textTransform:"uppercase",letterSpacing:0.8},
  hint:       {color:"#4b5563",textTransform:"none",fontSize:10},
  textarea:   {background:"#0e0e0e",border:"1px solid #2a2a2a",borderRadius:8,color:"#d1d5db",
               fontFamily:"'Fira Code',monospace",fontSize:11.5,lineHeight:1.7,padding:"12px 14px",resize:"vertical",width:"100%"},
  input:      {background:"#0e0e0e",border:"1px solid #2a2a2a",borderRadius:8,color:"#d1d5db",
               fontFamily:"'Fira Code',monospace",fontSize:12,padding:"8px 12px",width:"100%"},
  select:     {background:"#0e0e0e",border:"1px solid #2a2a2a",borderRadius:8,color:"#d1d5db",
               fontFamily:"'Fira Code',monospace",fontSize:12,padding:"8px 12px",width:"100%",cursor:"pointer"},
  findingsBox:{background:"#0e0e0e",border:"1px solid #1e1e1e",borderRadius:8,padding:"4px 20px",maxHeight:560,overflowY:"auto"},
  empty:      {textAlign:"center",padding:"60px 20px"},
  btnGold:    {background:"#e8c468",color:"#0e0e0e",border:"none",borderRadius:8,padding:"10px 20px",
               fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:13},
  btnOutline: {background:"transparent",color:"#9ca3af",border:"1px solid #2a2a2a",borderRadius:8,
               padding:"10px 18px",fontFamily:"'Fira Code',monospace",fontSize:12},
  error:      {marginTop:12,padding:"10px 14px",background:"#1a0a0a",border:"1px solid #3a1a1a",
               borderRadius:6,fontFamily:"'Fira Code',monospace",fontSize:12,color:"#ef4444"},
};
