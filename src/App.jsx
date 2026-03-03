import { useState, useRef } from "react";

// ── Structured checklist data ─────────────────────────────────────────────────
const DEFAULT_ITEMS = [
  { id: 1,  category: "Accruals",                       accounts: "",                                                                         rule: "CHECK",   text: "Verify all prior month accruals were reversed in current month" },
  { id: 2,  category: "Accruals",                       accounts: "",                                                                         rule: "FLAG IF", text: "Accrual entry has no corresponding reversal within first 5 business days of month" },
  { id: 3,  category: "Accruals",                       accounts: "",                                                                         rule: "CHECK",   text: "Confirm standard monthly accruals are present (property mgmt fee, property tax, insurance)" },
  { id: 4,  category: "Accruals",                       accounts: "",                                                                         rule: "FLAG IF", text: "Any standard accrual is missing or differs more than 5% from prior month" },
  { id: 5,  category: "Accruals",                       accounts: "",                                                                         rule: "FLAG IF", text: "Account shows a reversal with no corresponding new entry in the same month" },
  { id: 6,  category: "Revenue - Gross Potential Rent", accounts: "411001 Residential Income",                                               rule: "FLAG IF", text: "Balance changes more than 2% vs prior month with no explanation" },
  { id: 7,  category: "Revenue - Bad Debt",             accounts: "419001 Bad Debt Expense | 419002 Bad Debt Recoveries",                    rule: "FLAG IF", text: "Net bad debt exceeds 2% of Residential Income in any single month" },
  { id: 8,  category: "Repairs & Maintenance",          accounts: "601001-601049",                                                           rule: "FLAG IF", text: "Any single R&M account exceeds $3,000 in current month and was under $1,000 prior month" },
  { id: 9,  category: "Repairs & Maintenance",          accounts: "601001-601049",                                                           rule: "FLAG IF", text: "Any R&M account shows a large negative balance" },
  { id: 10, category: "Repairs & Maintenance",          accounts: "601001-601049",                                                           rule: "FLAG IF", text: "PO accruals apply identical dollar amounts across unrelated line items (system error pattern)" },
  { id: 11, category: "Repairs & Maintenance",          accounts: "601001-601049",                                                           rule: "FLAG IF", text: "Any entry description references roof, HVAC, appliance, flooring - verify P&L vs. capital" },
  { id: 12, category: "Turnover Expenses",              accounts: "602001-602016",                                                           rule: "FLAG IF", text: "Total Turnover Expenses increase more than 50% vs prior month without corresponding vacancy increase" },
  { id: 13, category: "Turnover Expenses",              accounts: "602001-602016",                                                           rule: "FLAG IF", text: "Turnover costs near zero when vacancy loss is elevated" },
  { id: 14, category: "Payroll",                        accounts: "603001-603106",                                                           rule: "FLAG IF", text: "Total payroll varies more than 10% vs prior month without explanation" },
  { id: 15, category: "Payroll",                        accounts: "603001-603106",                                                           rule: "FLAG IF", text: "Wages post but burden accounts (taxes, insurance, 401k) are zero or missing same period" },
  { id: 16, category: "Utilities",                      accounts: "604003, 604004, 604201, 604301, 604302",                                  rule: "FLAG IF", text: "Any utility varies more than 25% from trailing 3-month average without explanation" },
  { id: 17, category: "Utilities",                      accounts: "604003, 604004, 604201, 604301, 604302",                                  rule: "FLAG IF", text: "Any utility account shows large negative - may indicate billing catch-up or accrual error" },
  { id: 18, category: "Contract Services",              accounts: "605006, 605014, 605019, 605020, 605023",                                  rule: "FLAG IF", text: "Any recurring vendor missing for current month with no explanation" },
  { id: 19, category: "Contract Services",              accounts: "605006, 605014, 605019, 605020, 605023",                                  rule: "FLAG IF", text: "Any contract amount varies more than 10% from its typical monthly amount" },
  { id: 20, category: "Marketing",                      accounts: "606602 Zillow | 606603 ApartmentList | 606604 CoStar | 606822 ReachLocal", rule: "FLAG IF", text: "If marketing spend in any account varies more than 25% from the prior month" },
  { id: 21, category: "Marketing",                      accounts: "606602 Zillow | 606603 ApartmentList | 606604 CoStar | 606822 ReachLocal", rule: "FLAG IF", text: "Any marketing account reversed but not re-accrued in same period" },
  { id: 22, category: "Marketing",                      accounts: "606602 Zillow | 606603 ApartmentList | 606604 CoStar | 606822 ReachLocal", rule: "FLAG IF", text: "Same vendor accrued twice in one month without explanation" },
  { id: 23, category: "Management Fee",                 accounts: "608001 External Management Fee Expense",                                  rule: "FLAG IF", text: "Fee as % of Total Revenue varies more than 1% from prior months" },
  { id: 24, category: "Management Fee",                 accounts: "608001 External Management Fee Expense",                                  rule: "FLAG IF", text: "Negative management fee entry posts without explanation" },
  { id: 25, category: "Insurance",                      accounts: "640001 Property Insurance",                                               rule: "FLAG IF", text: "Amount changes vs prior month without documented policy change or new amortization schedule" },
  { id: 26, category: "Real Estate Taxes",              accounts: "630001 Real Estate Tax",                                                  rule: "FLAG IF", text: "Amount changes vs prior month without explanation" },
  { id: 27, category: "Legal",                          accounts: "607010 Legal - Evictions",                                                rule: "FLAG IF", text: "Any legal fee entry appears - note for manager awareness regardless of amount" },
  { id: 29, category: "Expense Trends",                 accounts: "",                                                                         rule: "CHECK",   text: "Identify any expense line present in 2+ prior months but zero in current month" },
  { id: 30, category: "Expense Trends",                 accounts: "",                                                                         rule: "FLAG IF", text: "Zero balance with no prior indication expense was one-time or seasonal" },
  { id: 31, category: "Expense Trends",                 accounts: "",                                                                         rule: "CHECK",   text: "Flag any account with large swing from positive to negative or vice versa in consecutive months" },
];

const CATEGORIES = [
  "Accruals","Revenue - Gross Potential Rent","Revenue - Bad Debt",
  "Repairs & Maintenance","Turnover Expenses","Payroll","Utilities",
  "Contract Services","Marketing","Management Fee","Insurance",
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

async function callClaude(system, user) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, messages: [{ role: "user", content: user }] }),
  });
  const data = await res.json();
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
  const [findings, setFindings]               = useState("");
  const [reviewing, setReviewing]             = useState(false);
  const [reviewError, setReviewError]         = useState("");

  const [items, setItems]         = useState(DEFAULT_ITEMS);
  const [prevItems, setPrevItems] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({});
  const [adding, setAdding]       = useState(false);
  const [newItem, setNewItem]     = useState({ category: CATEGORIES[0], accounts: "", rule: "FLAG IF", text: "" });
  const [importError, setImportError] = useState("");
  const fileInputRef = useRef(null);
  const isFileRef    = useRef(null);
  const glFileRef    = useRef(null);
  const refineISFileRef = useRef(null);
  const refineGLFileRef = useRef(null);

  const readCsv = (file, setter) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => setter(e.target.result);
    reader.readAsText(file);
  };

  // For GL files: extract expense account section (6xxxxx), keep 3 months of entries + all totals
  const readGlCsv = (file, setter, setErr) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const raw = e.target.result;
      const [yr, mo] = reviewMonth.split("-");

      // Build set of MM/YYYY for current + 2 prior months
      const keepMonths = new Set();
      for (let i = 0; i < 3; i++) {
        const d = new Date(+yr, +mo - 1 - i, 1);
        keepMonths.add(
          String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear()
        );
      }

      const lines = raw.split("\n");

      // Find where expense accounts start (first line starting with 6XXXXX -)
      let expenseStart = 0;
      for (let i = 0; i < lines.length; i++) {
        if (/^6\d{4,5}\s+-/.test(lines[i])) { expenseStart = i; break; }
      }

      // If no expense section found, fall back to date-based filter across whole file
      const source = expenseStart > 0 ? lines.slice(expenseStart) : lines;

      const result = [];
      for (const line of source) {
        const t = line.trim();
        // Always keep account headers (6XXXXX - Name) and totals
        if (/^6\d{4,5}\s+-/.test(t) || /^Totals for 6/.test(t)) {
          result.push(line); continue;
        }
        // Keep date entries in our 3-month window
        const parts = t.split(",");
        const dt = parts[0] ?? "";
        if (dt.length === 10 && dt[2] === "/" && dt[5] === "/") {
          const my = dt.slice(0,3) + dt.slice(6,10); // MM/YYYY
          if (keepMonths.has(my)) result.push(line);
        }
      }

      if (result.length === 0) {
        setErr("No expense entries found for the selected period. Check the review period matches your data.");
        return;
      }
      setErr("");
      const label = new Date(+yr, +mo-1).toLocaleString("en-US", {month:"long", year:"numeric"});
      setter([
        "// GL: expense accounts, 3 months ending " + label + " (" + result.length + " lines)",
        lines[0], lines[2], // property name + column headers
        ...result
      ].join("\n"));
    };
    reader.readAsText(file);
  };

  const [refineIS, setRefineIS]               = useState("");
  const [refineGL, setRefineGL]               = useState("");
  const [refineComments, setRefineComments]   = useState("");
  const [refineAnalysis, setRefineAnalysis]   = useState("");
  const [refining, setRefining]               = useState(false);
  const [refineError, setRefineError]         = useState("");
  const [refineApplied, setRefineApplied]     = useState(false);

  const updateItem = (id, patch) => setItems(is => is.map(i => i.id === id ? { ...i, ...patch } : i));
  const deleteItem = (id) => setItems(is => is.filter(i => i.id !== id));
  const startEdit  = (item) => { setEditingId(item.id); setEditDraft({ ...item }); };
  const cancelEdit = () => { setEditingId(null); setEditDraft({}); };
  const saveEdit   = () => { updateItem(editingId, editDraft); setEditingId(null); setEditDraft({}); };
  const addItem    = () => {
    if (!newItem.text.trim()) return;
    setItems(is => [...is, { ...newItem, id: Date.now() }]);
    setNewItem({ category: CATEGORIES[0], accounts: "", rule: "FLAG IF", text: "" });
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
          category: item.category ?? "Uncategorised",
          accounts: item.accounts ?? "",
          rule: item.rule === "CHECK" ? "CHECK" : "FLAG IF",
          text: item.text,
        }));
        setPrevItems(items);
        setItems(normalised);
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
    setReviewError(""); setReviewing(true); setFindings("");
    try {
      const [yr, mo] = reviewMonth.split("-");
      const label = new Date(+yr, +mo - 1).toLocaleString("en-US", { month: "long", year: "numeric" });
      const sys = "You are a senior multifamily property accountant reviewing financials for errors, accrual issues, and anomalies.\nProduce a structured findings report. For each finding:\n- Assign priority: HIGH / MEDIUM / LOW\n- State the account name and number\n- Describe the issue with specific dollar amounts from the data\n- State the required action\nFormat each finding as:\n[PRIORITY] Account Name (Account #)\nIssue: ...\nAction: ...\n---\nOrder HIGH first, then MEDIUM, then LOW. Skip categories with no issues. Be specific.";
      const usr = "REVIEW PERIOD: " + label + "\n\nCHECKLIST:\n" + serialize(items) + "\n\n" + (incomeStatement.trim() ? "INCOME STATEMENT:\n" + incomeStatement + "\n\n" : "") + (glEntries.trim() ? "GL ENTRIES:\n" + glEntries + "\n\n" : "") + "Review the " + label + " financials against the checklist.";
      setFindings(await callClaude(sys, usr));
      setTab("findings");
    } catch(e) { setReviewError("Error: " + (e.message || "Please try again.")); }
    setReviewing(false);
  };

  const analyseGaps = async () => {
    if (!refineComments.trim()) { setRefineError("Manager comments are required."); return; }
    if (!refineIS.trim() && !refineGL.trim()) { setRefineError("Paste at least the income statement or GL entries."); return; }
    setRefineError(""); setRefining(true); setRefineAnalysis(""); setRefineApplied(false);
    try {
      const sys = "You are a senior multifamily accounting reviewer comparing what an AI checklist should have caught versus what a human manager identified.\nAnalyse the gap and produce:\n1. Issues the manager found that the checklist would have MISSED entirely\n2. Patterns in the data that should have triggered a flag\n3. Specific recommended changes (new FLAG IF rules, threshold adjustments, new categories)\nReference specific accounts and dollar amounts.\nFormat:\nGAPS IDENTIFIED:\n- ...\n\nPATTERNS MISSED:\n- ...\n\nRECOMMENDED CHECKLIST CHANGES:\n- ...";
      const usr = "CURRENT CHECKLIST:\n" + serialize(items) + "\n\n" + (refineIS.trim() ? "INCOME STATEMENT (pre-correction):\n" + refineIS + "\n\n" : "") + (refineGL.trim() ? "GL ENTRIES (pre-correction):\n" + refineGL + "\n\n" : "") + "MANAGER COMMENTS:\n" + refineComments + "\n\nAnalyse what the checklist missed.";
      setRefineAnalysis(await callClaude(sys, usr));
    } catch(e) { setRefineError("Error running analysis. Please try again."); }
    setRefining(false);
  };

  const applyUpdates = async () => {
    if (!refineAnalysis.trim()) { setRefineError("Run the gap analysis first."); return; }
    setRefineError(""); setRefining(true);
    try {
      const sys = "You are updating a multifamily property accounting review checklist.\nReturn ONLY the full updated checklist. Keep all existing checks unless the analysis says to change them.\nAdd new FLAG IF or CHECK lines where gaps were found. Adjust thresholds as needed.\nFormat strictly:\nCATEGORY: X\nACCOUNTS: ... (if applicable)\nCHECK: ...\nFLAG IF: ...\n\nSeparate each category with a blank line. No preamble, no explanation, nothing else.";
      const usr = "CURRENT CHECKLIST:\n" + serialize(items) + "\n\nGAP ANALYSIS:\n" + refineAnalysis + "\n\nReturn full updated checklist.";
      const result = await callClaude(sys, usr);
      const parsed = parseAIChecklist(result);
      if (parsed) { setPrevItems(items); setItems(parsed); setRefineApplied(true); }
      else { setRefineError("Could not parse AI response. Try again."); }
    } catch(e) { setRefineError("Error updating checklist. Please try again."); }
    setRefining(false);
  };

  const revert = () => { if (prevItems) { setItems(prevItems); setPrevItems(null); setRefineApplied(false); } };

  const grouped = {};
  items.forEach(item => { if (!grouped[item.category]) grouped[item.category] = []; grouped[item.category].push(item); });
  const totalChecks = items.length;
  const flagCount   = items.filter(i => i.rule === "FLAG IF").length;

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
              {key:"findings",  label:"02 · Findings",   dot: !!findings},
              {key:"refine",    label:"03 · Refine Checklist"},
              {key:"checklist", label:"04 · Checklist",  badge: totalChecks},
            ].map(t => (
              <button key={t.key} className="tab" onClick={() => setTab(t.key)}
                style={{...s.tab,...(tab===t.key?s.tabActive:{})}}>
                {t.label}
                {t.dot && tab!=="findings" && <span style={s.dot}/>}
                {t.badge && <span style={s.badge}>{t.badge}</span>}
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
              <p style={s.panelDesc}>Paste your income statement and/or GL entries. The AI reviews them against the current checklist ({totalChecks} checks, {flagCount} flags).</p>
            </div>
            <div style={{marginBottom:20}}>
              <label style={s.label}>Review Period</label>
              <div style={{display:"flex",alignItems:"center",gap:12,marginTop:8}}>
                <input type="month" value={reviewMonth} onChange={e=>setReviewMonth(e.target.value)}
                  style={{background:"#0e0e0e",border:"1px solid #2a2a2a",borderRadius:8,color:"#e8c468",
                    fontFamily:"'Fira Code',monospace",fontSize:13,padding:"8px 14px",colorScheme:"dark"}}/>
                <span style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#4b5563"}}>{monthLabel}</span>
              </div>
            </div>
            <div style={s.twoCol}>
              <div style={s.inputGroup}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <label style={s.label}>Trailing Income Statement <span style={s.hint}>(CSV or plain text)</span></label>
                  <button className="btn" onClick={()=>isFileRef.current?.click()}
                    style={{...s.btnOutline,fontSize:10,padding:"3px 10px",marginBottom:4}}>
                    Upload CSV
                  </button>
                  <input ref={isFileRef} type="file" accept=".csv,.txt" style={{display:"none"}}
                    onChange={e=>{ readCsv(e.target.files?.[0], setIncomeStatement); e.target.value=""; }}/>
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
                    onChange={e=>{ readGlCsv(e.target.files?.[0], setGlEntries, setReviewError); e.target.value=""; }}/>
                </div>
                <textarea style={{...s.textarea,minHeight:240}}
                  placeholder={"Date, Account, Description, Debit, Credit\n02/25/2026, 601002, RED SEAL FILL VALVE, 9589.33,\n02/25/2026, 601039, PAPER TOWEL ROLLS, 9589.33,"}
                  value={glEntries} onChange={e=>setGlEntries(e.target.value)}/>
              </div>
            </div>
            {reviewError && <div style={s.error}>{reviewError}</div>}
            <div style={{display:"flex",justifyContent:"flex-end",marginTop:20}}>
              <button className="btn" onClick={runReview} disabled={reviewing} style={s.btnGold}>
                {reviewing ? <span className="pulsing">Reviewing...</span> : "Run Review →"}
              </button>
            </div>
          </div>
        )}

        {tab==="findings" && (
          <div className="fade-up" style={s.panel}>
            <div style={s.panelHead}>
              <h2 style={s.panelTitle}>Findings</h2>
              <p style={s.panelDesc}>
                {findings
                  ? <span>Results for <strong style={{color:"#e8c468"}}>{monthLabel}</strong>. Copy for staff distribution, or use Refine Checklist to improve future reviews.</span>
                  : "No findings yet - run a review first."}
              </p>
            </div>
            {findings ? (
              <div style={s.findingsBox}>
                {findings.split("---").filter(f=>f.trim()).map((block,i)=>{
                  const lines = block.trim().split("\n");
                  const header = lines[0]||"";
                  const p = header.startsWith("[HIGH]")?"high":header.startsWith("[MEDIUM]")?"medium":"low";
                  const pc = {high:"#ef4444",medium:"#f59e0b",low:"#60a5fa"}[p];
                  return (
                    <div key={i} style={{borderBottom:"1px solid #1e1e1e",padding:"16px 0"}}>
                      <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
                        <div style={{fontFamily:"'Fira Code',monospace",fontSize:10,color:pc,
                          border:"1px solid "+pc,borderRadius:3,padding:"2px 7px",marginTop:2,whiteSpace:"nowrap",flexShrink:0}}>
                          {p.toUpperCase()}
                        </div>
                        <div style={{flex:1}}>
                          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:600,fontSize:14,color:"#f5f5f5",marginBottom:8}}>
                            {header.replace(/\[HIGH\]|\[MEDIUM\]|\[LOW\]/g,"").trim()}
                          </div>
                          {lines.slice(1).map((line,j)=>{
                            const isLabel = line.startsWith("Issue:")||line.startsWith("Action:");
                            return <div key={j} style={{fontFamily:"'Lora',serif",fontSize:13,lineHeight:1.7,
                              color:isLabel?"#e8c468":"#9ca3af",fontWeight:isLabel?500:400}}>{line}</div>;
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={s.empty}>
                <div style={{fontSize:28,color:"#2a2a2a",marginBottom:12}}>◈</div>
                <div style={{fontFamily:"'Lora',serif",fontSize:14,fontStyle:"italic",color:"#4b5563"}}>Run a review to see findings here</div>
                <button className="btn" onClick={()=>setTab("review")} style={{...s.btnGold,marginTop:16}}>Go to Review →</button>
              </div>
            )}
          </div>
        )}

        {tab==="refine" && (
          <div className="fade-up" style={s.panel}>
            <div style={s.panelHead}>
              <h2 style={s.panelTitle}>Refine Checklist</h2>
              <p style={s.panelDesc}>Upload the <strong style={{color:"#e8c468"}}>uncorrected</strong> financials from a period the manager has already reviewed, add their comments, and the AI will identify checklist gaps and improve the rules.</p>
            </div>

            <div style={{display:"flex",alignItems:"center",gap:0,marginBottom:28}}>
              {["Provide financials & comments","Review gap analysis","Apply to checklist"].map((label,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",flex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                    <div style={{width:22,height:22,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",
                      fontFamily:"'Fira Code',monospace",fontSize:11,fontWeight:700,
                      background:(i===0||(i===1&&refineAnalysis)||(i===2&&refineApplied))?"#e8c468":"#1e1e1e",
                      color:(i===0||(i===1&&refineAnalysis)||(i===2&&refineApplied))?"#0e0e0e":"#4b5563"}}>
                      {i+1}
                    </div>
                    <span style={{fontFamily:"'Fira Code',monospace",fontSize:10,color:"#4b5563",whiteSpace:"nowrap"}}>{label}</span>
                  </div>
                  {i<2 && <div style={{flex:1,height:1,background:"#1e1e1e",margin:"0 10px"}}/>}
                </div>
              ))}
            </div>

            <div style={{marginBottom:20}}>
              <div style={s.stepLabel}>Step 1 - Financials & Manager Comments</div>
              <div style={s.twoCol}>
                <div style={s.inputGroup}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <label style={s.label}>Trailing Income Statement <span style={s.hint}>(pre-correction)</span></label>
                    <button className="btn" onClick={()=>refineISFileRef.current?.click()}
                      style={{...s.btnOutline,fontSize:10,padding:"3px 10px",marginBottom:4}}>
                      Upload CSV
                    </button>
                    <input ref={refineISFileRef} type="file" accept=".csv,.txt" style={{display:"none"}}
                      onChange={e=>{ readCsv(e.target.files?.[0], setRefineIS); e.target.value=""; }}/>
                  </div>
                  <textarea style={{...s.textarea,minHeight:180}}
                    placeholder="Paste income statement exactly as it was before any corrections..."
                    value={refineIS} onChange={e=>setRefineIS(e.target.value)}/>
                </div>
                <div style={s.inputGroup}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <label style={s.label}>GL Entries <span style={s.hint}>(pre-correction)</span></label>
                    <button className="btn" onClick={()=>refineGLFileRef.current?.click()}
                      style={{...s.btnOutline,fontSize:10,padding:"3px 10px",marginBottom:4}}>
                      Upload CSV
                    </button>
                    <input ref={refineGLFileRef} type="file" accept=".csv,.txt" style={{display:"none"}}
                      onChange={e=>{ readGlCsv(e.target.files?.[0], setRefineGL, setRefineError); e.target.value=""; }}/>
                  </div>
                  <textarea style={{...s.textarea,minHeight:180}}
                    placeholder="Paste GL entries exactly as they were before any corrections..."
                    value={refineGL} onChange={e=>setRefineGL(e.target.value)}/>
                </div>
              </div>
              <div style={{...s.inputGroup,marginTop:16}}>
                <label style={s.label}>Manager Comments <span style={s.hint}>(every issue found, with context)</span></label>
                <textarea style={{...s.textarea,minHeight:130}}
                  placeholder={"Describe every issue the manager caught - what was wrong, the dollar amount, why it happened, and whether it was corrected.\n\nExample: 'PO accrual bug - $9,589.33 applied to 25 line items, total overstatement $239,733. Yardi bug when PO exceeds 20 lines. Reversed and re-accrued correctly.'\n\nExample: 'Insurance drop from $14,228 to $9,348 was intentional - new policy rate. Not an error.'"}
                  value={refineComments} onChange={e=>setRefineComments(e.target.value)}/>
              </div>
            </div>

            {refineError && <div style={s.error}>{refineError}</div>}
            <div style={{display:"flex",justifyContent:"flex-end",marginBottom:24}}>
              <button className="btn" onClick={analyseGaps} disabled={refining} style={s.btnGold}>
                {refining&&!refineAnalysis?<span className="pulsing">Analysing gaps...</span>:"Analyse Gaps →"}
              </button>
            </div>

            {refineAnalysis && (
              <div style={{marginBottom:24}}>
                <div style={s.stepLabel}>Step 2 - Gap Analysis</div>
                <div style={{background:"#0e0e0e",border:"1px solid #2a2a2a",borderRadius:8,padding:"18px 20px",maxHeight:300,overflowY:"auto",marginBottom:20}}>
                  {refineAnalysis.split("\n").map((line,i)=>{
                    const isH=/^(GAPS|PATTERNS|RECOMMENDED)/.test(line);
                    const isB=line.trim().startsWith("- ");
                    return <div key={i} style={{fontFamily:isH?"'Fira Code',monospace":"'Lora',serif",
                      fontSize:isH?11:13,color:isH?"#e8c468":isB?"#d1d5db":"#6b7280",
                      lineHeight:1.7,marginTop:isH?14:0,letterSpacing:isH?0.5:0}}>{line||<br/>}</div>;
                  })}
                </div>
                <div style={s.stepLabel}>Step 3 - Apply to Checklist</div>
                <div style={{display:"flex",gap:12,alignItems:"center"}}>
                  {prevItems && <button className="btn" onClick={revert} style={s.btnOutline}>Revert</button>}
                  <button className="btn" onClick={applyUpdates} disabled={refining} style={s.btnGold}>
                    {refining&&refineAnalysis?<span className="pulsing">Updating...</span>:"Apply to Checklist →"}
                  </button>
                  {refineApplied && <span style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#4ade80"}}>Checklist updated - view in Checklist tab</span>}
                </div>
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
                  <p style={s.panelDesc}>{totalChecks} checks across {Object.keys(grouped).length} categories - {flagCount} FLAG IF rules, {totalChecks-flagCount} CHECK rules.</p>
                </div>
                <div style={{display:"flex",gap:8,flexShrink:0}}>
                  <button className="btn" onClick={()=>setItems(DEFAULT_ITEMS)} style={{...s.btnOutline,fontSize:11,padding:"5px 12px"}}>Reset</button>
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
                      {CATEGORIES.map(c=><option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div style={s.inputGroup}>
                    <label style={s.label}>Rule Type</label>
                    <select value={newItem.rule} onChange={e=>setNewItem(n=>({...n,rule:e.target.value}))} style={s.select}>
                      <option value="FLAG IF">FLAG IF</option>
                      <option value="CHECK">CHECK</option>
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
                              {CATEGORIES.map(c=><option key={c}>{c}</option>)}
                            </select>
                          </div>
                          <div style={s.inputGroup}>
                            <label style={s.label}>Rule Type</label>
                            <select value={editDraft.rule} onChange={e=>setEditDraft(d=>({...d,rule:e.target.value}))} style={s.select}>
                              <option value="FLAG IF">FLAG IF</option>
                              <option value="CHECK">CHECK</option>
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
                            background:item.rule==="FLAG IF"?"#2a1a0a":"#0a1a2a",
                            color:item.rule==="FLAG IF"?"#f59e0b":"#60a5fa",
                            border:"1px solid "+(item.rule==="FLAG IF"?"#3a2a0a":"#1a2a3a")}}>
                            {item.rule}
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
