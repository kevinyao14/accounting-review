import { kvGet, kvSet } from "../lib/storage.js";

const DEFAULT_ITEMS = [
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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method === "GET") {
      const raw = await kvGet("checklist");
      let items = raw ? JSON.parse(raw) : null;
      if (!items) {
        items = DEFAULT_ITEMS;
        await kvSet("checklist", JSON.stringify(items));
      }
      return res.status(200).json(items);
    }

    if (req.method === "POST") {
      const items = req.body?.items;
      if (!Array.isArray(items)) return res.status(400).json({ error: "Invalid checklist format" });
      await kvSet("checklist", JSON.stringify(items));
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("Checklist API error:", e);
    return res.status(500).json({ error: e.message });
  }
}
