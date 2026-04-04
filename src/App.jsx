import { useState, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import { DEFAULT_ITEMS, CATEGORIES, AUDIENCE_LABELS, serialize, serializeBySource, parseAIChecklist, parseIsDetail, parseGlDetail, glPeriodCheck, buildReportContext } from "./utils.js";
import { s } from "./styles.js";

// ── Constants, parsers, and report helpers imported from ./utils.js ────────

function inlineBold(text) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((p, i) => i % 2 === 1 ? <strong key={i} style={{color:"#f5f5f5"}}>{p}</strong> : p);
}

function SimpleMarkdown({ content }) {
  return (
    <div>
      {content.split("\n").map((line, i) => {
        if (line.startsWith("## "))
          return <h2 key={i} style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:17,color:"#f5f5f5",marginTop:28,marginBottom:10,paddingBottom:6,borderBottom:"1px solid #1e1e1e"}}>{line.slice(3)}</h2>;
        if (line.startsWith("### "))
          return <h3 key={i} style={{fontFamily:"'Syne',sans-serif",fontWeight:600,fontSize:14,color:"#e8c468",marginTop:18,marginBottom:6}}>{line.slice(4)}</h3>;
        if (/^\*\*.+\*\*$/.test(line.trim()))
          return <p key={i} style={{fontWeight:600,color:"#f5f5f5",marginBottom:4,fontFamily:"'Syne',sans-serif"}}>{line.replace(/\*\*/g,"")}</p>;
        if (line.startsWith("- ") || line.startsWith("• "))
          return <div key={i} style={{display:"flex",gap:8,marginBottom:5,paddingLeft:8}}><span style={{color:"#e8c468",flexShrink:0,marginTop:2}}>·</span><span style={{fontFamily:"'Lora',serif",fontSize:14,lineHeight:1.7,color:"#9ca3af"}}>{inlineBold(line.slice(2))}</span></div>;
        if (line.trim() === "" || line.trim() === "---")
          return <div key={i} style={{height:10}} />;
        return <p key={i} style={{fontFamily:"'Lora',serif",fontSize:14,lineHeight:1.75,color:"#9ca3af",marginBottom:6}}>{inlineBold(line)}</p>;
      })}
    </div>
  );
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

function PasswordGate({ onAuth }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);
  const [checking, setChecking] = useState(false);
  const attempt = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw, scope: "app" }),
      });
      const data = await res.json();
      if (data.ok) { sessionStorage.setItem("ar_auth","1"); onAuth(); }
      else setErr(true);
    } catch { setErr(true); }
    finally { setChecking(false); }
  };
  return (
    <div style={{minHeight:"100vh",background:"#0e0e0e",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"#111",border:"1px solid #1e1e1e",borderRadius:12,padding:"40px 48px",display:"flex",flexDirection:"column",alignItems:"center",gap:20,minWidth:320}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:22,color:"#f5f5f5",letterSpacing:1}}>STYL</div>
        <div style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#4b5563",letterSpacing:0.5}}>Accounting Review</div>
        <input
          type="password"
          placeholder="Password"
          value={pw}
          onChange={e => { setPw(e.target.value); setErr(false); }}
          onKeyDown={e => e.key === "Enter" && attempt()}
          autoFocus
          style={{width:"100%",background:"#0e0e0e",border:`1px solid ${err ? "#f87171" : "#2a2a2a"}`,borderRadius:6,padding:"9px 14px",color:"#f5f5f5",fontFamily:"'Fira Code',monospace",fontSize:13,outline:"none"}}
        />
        {err && <div style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#f87171"}}>Incorrect password</div>}
        <button style={{width:"100%",background:"#1a1a1a",border:"1px solid #2a2a2a",borderRadius:6,padding:"9px 0",color:"#d1d5db",fontFamily:"'Fira Code',monospace",fontSize:12,cursor:"pointer"}}
          onClick={attempt} disabled={checking}>
          {checking ? "Checking…" : "Sign In"}
        </button>
      </div>
    </div>
  );
}

function AppInner() {
  const [tab, setTab] = useState("review");

  const [reviewMonth, setReviewMonth] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  });
  const [incomeStatement, setIncomeStatement] = useState("");
  const [glEntries, setGlEntries]             = useState("");
  const [rawIsText, setRawIsText]             = useState("");  // full untrimmed IS for data store
  const [rawGlText, setRawGlText]             = useState("");  // full untrimmed GL for data store
  const [findings, setFindings]               = useState([]);
  const [generalFindings, setGeneralFindings] = useState([]);
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
  const [historyPropertyFilter, setHistoryPropertyFilter] = useState("");
  const [expandedReview, setExpandedReview]   = useState(null); // { blobUrl, data|null, loading }
  const [feedbackMode, setFeedbackMode]       = useState(null); // blobUrl of review in feedback mode
  const [feedbackDraft, setFeedbackDraft]     = useState({ findings: {}, accountNotes: [{ id: 1, accountNumber: "", note: "" }], general: "" });
  const [feedbackSaving, setFeedbackSaving]   = useState(false);
  const [isPropertyName, setIsPropertyName]         = useState("");
  const [reviewBlobUrl, setReviewBlobUrl]           = useState(null);
  const [reviewPropertyName, setReviewPropertyName] = useState("");
  const [findingsFbMode, setFindingsFbMode]         = useState(false);
  const [findingsFbDraft, setFindingsFbDraft]     = useState({ findings: {}, accountNotes: [{ id: 1, accountNumber: "", note: "" }], general: "" });
  const [findingsFbSaving, setFindingsFbSaving]   = useState(false);
  const [findingsFbSaved, setFindingsFbSaved]     = useState(false);

  // Memory review (Stage 2) states
  const [memoryReviewRunning, setMemoryReviewRunning]       = useState(false);
  const [memoryReviewResult, setMemoryReviewResult]         = useState(null);
  const [memoryReviewError, setMemoryReviewError]           = useState("");
  // Memory chat state
  const [memoryChatOpen, setMemoryChatOpen]       = useState(false);
  const [memoryChatMessages, setMemoryChatMessages] = useState([]);
  const [memoryChatInput, setMemoryChatInput]     = useState("");
  const [memoryChatLoading, setMemoryChatLoading] = useState(false);

  const [reportContent, setReportContent]         = useState(null);
  const [reportLoading, setReportLoading]         = useState(false);
  const [reportError, setReportError]             = useState("");
  const [reportAudience, setReportAudience]       = useState("");
  const [reportMeta, setReportMeta]               = useState(null);

  const [claudeStatus, setClaudeStatus]           = useState(null); // null=loading, "none"|"minor"|"major"|"critical"
  const [reportPickerBlobUrl, setReportPickerBlobUrl] = useState(null);

  // Knowledge Base states
  const [kbAuthed, setKbAuthed]           = useState(() => sessionStorage.getItem("kb_auth") === "1");
  const [kbPw, setKbPw]                   = useState("");
  const [kbPwErr, setKbPwErr]             = useState(false);
  const [kbScope, setKbScope]             = useState("global"); // "global" | "property"
  const [kbPropertyName, setKbPropertyName] = useState("");
  const [kbPropertyList, setKbPropertyList] = useState([]);
  const [kbSource, setKbSource]           = useState("");
  const [kbCompressed, setKbCompressed]   = useState("");
  const [kbTokenCount, setKbTokenCount]   = useState(0);
  const [kbLoading, setKbLoading]         = useState(false);
  const [kbChatInput, setKbChatInput]         = useState("");
  const [kbChatLoading, setKbChatLoading]     = useState(false);
  const [kbPending, setKbPending]             = useState(null); // { action, preview, proposedSource }
  const [kbClarifyQuestions, setKbClarifyQuestions] = useState([]);
  const [kbClarifyLoading, setKbClarifyLoading]     = useState(false);
  const [kbSaving, setKbSaving]           = useState(false);
  const [kbCompressing, setKbCompressing] = useState(false);
  const [kbError, setKbError]             = useState("");
  const [kbFeedbackQueue, setKbFeedbackQueue] = useState([]); // committed feedback not yet in KB
  const [kbFeedbackLoading, setKbFeedbackLoading] = useState(false);

  // Portfolio tab states
  const [portfolioData, setPortfolioData]     = useState(null); // grouped history data
  const [portfolioLoading, setPortfolioLoading] = useState(false);

  const [detailOpen, setDetailOpen]           = useState({});
  const toggleDetail = (acct, type) => setDetailOpen(prev => ({
    ...prev, [acct]: { ...prev[acct], [type]: !prev[acct]?.[type] }
  }));
  const [historyDetailOpen, setHistoryDetailOpen] = useState({});
  const toggleHistoryDetail = (key, type) => setHistoryDetailOpen(prev => ({
    ...prev, [key]: { ...prev[key], [type]: !prev[key]?.[type] }
  }));

  const fileInputRef      = useRef(null);
  const isFileRef         = useRef(null);
  const glFileRef         = useRef(null);
  const budgetFileRef     = useRef(null);
  const expandedReviewRef = useRef(null);

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

  // Collapse expanded review on outside click, unless feedback draft has content
  useEffect(() => {
    function hasDraftContent(draft) {
      if (!draft) return false;
      if (draft.general?.trim()) return true;
      if (draft.accountNotes?.some(n => n.accountNumber?.trim() || n.note?.trim())) return true;
      if (Object.values(draft.findings || {}).some(v => v?.trim())) return true;
      return false;
    }
    function handleMouseDown(e) {
      if (!expandedReview) return;
      const el = expandedReviewRef.current;
      if (!el) return;
      if (el.contains(e.target)) return; // click inside the box — ignore
      // If feedback panel is open and has typed content, don't collapse
      if (feedbackMode && hasDraftContent(feedbackDraft)) return;
      setExpandedReview(null);
      setFeedbackMode(null);
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [expandedReview, feedbackMode, feedbackDraft]);

  // Claude API status (polls Anthropic Statuspage every 2 minutes)
  useEffect(() => {
    const fetchStatus = () => {
      fetch("/api/status")
        .then(r => r.json())
        .then(d => setClaudeStatus(d?.indicator ?? "none"))
        .catch(() => setClaudeStatus(null));
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 120000);
    return () => clearInterval(interval);
  }, []);

  // Server-side auth for KB / Data tabs
  const attemptKbAuth = async () => {
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: kbPw, scope: "kb" }),
      });
      const data = await res.json();
      if (data.ok) {
        sessionStorage.setItem("kb_auth","1");
        setKbAuthed(true);
        setKbPwErr(false);
        setKbPw("");
        loadKbPropertyList();
      } else {
        setKbPwErr(true);
      }
    } catch { setKbPwErr(true); }
  };

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

  const generateReport = async (r, audience) => {
    setReportPickerBlobUrl(null);
    setReportLoading(true);
    setReportError("");
    setReportContent(null);
    setReportAudience(audience);
    setReportMeta({ property: r.property, period: r.period });
    setTab("reports");
    try {
      // Load review data if not already expanded
      let data = expandedReview?.blobUrl === r.blobUrl ? expandedReview.data : null;
      if (!data) {
        const res = await fetch(`/api/history?url=${encodeURIComponent(r.blobUrl)}`);
        data = await res.json();
      }
      if (!data?.findings?.length) throw new Error("No findings in this review.");
      // Fetch feedback (best effort)
      let feedback = null;
      try {
        const fbRes = await fetch(`/api/feedback?blobUrl=${encodeURIComponent(r.blobUrl)}`);
        if (fbRes.ok) feedback = await fbRes.json();
      } catch {}
      const isText  = data.csvs?.is     || "";
      const budText = data.csvs?.budget || "";
      const [yr, mo] = r.period.split("-");
      const periodLabel = new Date(+yr, +mo - 1).toLocaleString("en-US", { month: "long", year: "numeric" });
      const context = buildReportContext(data.findings, isText, budText, feedback, data.generalFindings || []);
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience, context, period: periodLabel, property: r.property || "Unknown Property" }),
      });
      const raw = await res.text();
      let result;
      try { result = JSON.parse(raw); } catch { throw new Error(`Server error: ${raw.slice(0, 300)}`); }
      if (!res.ok || result.error) throw new Error(result.error || `HTTP ${res.status}`);
      setReportContent(result.content);
    } catch(e) {
      setReportError(e.message || "Failed to generate report.");
    } finally {
      setReportLoading(false);
    }
  };

  const readIsCsv = (file, setter, setErr) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const raw = e.target.result;

      // ── Validation: Detect GL file ──
      if (/Posted Dt\./i.test(raw.slice(0, 2000))) {
        setErr("This appears to be a GL report, not an income statement. Please upload the income statement CSV.");
        return;
      }

      // ── Validation: Detect unsupported export format ──
      const first15 = raw.split("\n").slice(0, 15).join("\n");
      if (/Reporting Book:/i.test(first15) || /\bLocation:\s*\w/i.test(first15)) {
        setErr("Unsupported income statement format detected (Reporting Book / Location style). Please re-export using the standard T12 format with a \"Property:\" header.");
        return;
      }

      // ── Validation: Property name required ──
      const propMatch = raw.split("\n").slice(0, 10).join("\n").match(/Property:\s*([^,\r\n]+)/i);
      const propertyFromFile = propMatch?.[1]?.trim() ?? "";
      if (!propertyFromFile) {
        setErr("Could not detect property name. The income statement must contain a \"Property:\" line in the first 10 rows.");
        return;
      }
      setIsPropertyName(propertyFromFile);

      const [yr, mo] = reviewMonth.split("-");
      const reviewDate = new Date(+yr, +mo - 1, 1);

      const lines = raw.split("\n");

      // ── Validation: Date column structure ──
      let allDateCols = [];
      for (const line of lines) {
        const cols = line.split(",");
        const dates = [];
        cols.forEach((c, j) => {
          const t = c.trim();
          if (t.length === 10 && t[2] === "/" && t[5] === "/") {
            const p = t.split("/");
            dates.push({ idx: j, date: new Date(+p[2], +p[0] - 1, 1), label: t });
          }
        });
        if (dates.length >= 3) { allDateCols = dates; break; }
      }

      if (!allDateCols.length) {
        setErr("Could not detect date columns in income statement. Expected month-ending dates (e.g. 04/30/2025) as column headers.");
        return;
      }

      // Detect re-processed / trimmed file
      if (allDateCols.length < 6) {
        setErr("This file appears to be a previously trimmed income statement (" + allDateCols.length + " date columns). Please upload the original full T12 export.");
        return;
      }

      // Require at least 10 monthly columns (T12 = 12)
      if (allDateCols.length < 10) {
        setErr("Expected a T12 income statement with 12 monthly columns but found only " + allDateCols.length + ". Please upload the full T12 export.");
        return;
      }

      // Sequential months check
      for (let i = 1; i < allDateCols.length; i++) {
        const prev = allDateCols[i - 1].date;
        const curr = allDateCols[i].date;
        const expected = new Date(prev.getFullYear(), prev.getMonth() + 1, 1);
        if (curr.getTime() !== expected.getTime()) {
          setErr("Date columns are not sequential months (gap after " + allDateCols[i - 1].label + "). The file may be corrupted or hand-edited.");
          return;
        }
      }

      // Review period must exist in date columns
      const hasReviewPeriod = allDateCols.some(d =>
        d.date.getFullYear() === reviewDate.getFullYear() && d.date.getMonth() === reviewDate.getMonth()
      );
      if (!hasReviewPeriod) {
        const rvLabel = reviewDate.toLocaleString("en-US", { month: "long", year: "numeric" });
        setErr("Review period " + rvLabel + " not found in the income statement date columns. Check that the file covers the review period.");
        return;
      }

      // ── Validation: Minimum account rows ──
      let accountRowCount = 0;
      for (const line of lines) {
        const firstCol = line.split(",")[0]?.trim();
        if (/^\d{6}$/.test(firstCol)) accountRowCount++;
      }
      if (accountRowCount < 10) {
        setErr("Only " + accountRowCount + " account rows detected (expected at least 10). The file may be truncated or in the wrong format.");
        return;
      }

      // ── Period staleness warning ──
      const maxISDate = allDateCols[allDateCols.length - 1].date;
      const monthsAhead = (maxISDate.getFullYear() - reviewDate.getFullYear()) * 12
        + (maxISDate.getMonth() - reviewDate.getMonth());
      if (monthsAhead >= 2) {
        const isLabel = maxISDate.toLocaleString("en-US", { month: "long", year: "numeric" });
        const rvLabel = reviewDate.toLocaleString("en-US", { month: "long", year: "numeric" });
        setPeriodWarning(`Income statement runs through ${isLabel} but review period is set to ${rvLabel} — review period may be stale.`);
      } else {
        setPeriodWarning("");
      }

      // Capture full raw IS text for data store (pre-trim)
      setRawIsText(raw);

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

      // Target: review month and up to 2 prior months, oldest first
      const targetMonths = [-2, -1, 0].map(offset => {
        const d = new Date(+yr, +mo - 1 + offset, 1);
        return { year: d.getFullYear(), month: d.getMonth() + 1 };
      });

      const lines = raw.split("\n");

      // Find the date header row; collect column index + label for each target month
      let targetCols = []; // [{ colIdx, headerLabel }] in chronological order
      for (let i = 0; i < lines.length; i++) {
        const cols = lines[i].split(",");
        if (!cols.some(c => /^\d{1,2}\/\d{2}\/\d{4}$/.test(c.trim()))) continue;
        targetCols = targetMonths.map(({ year, month }) => {
          for (let j = 0; j < cols.length; j++) {
            const t = cols[j].trim();
            if (/^\d{1,2}\/\d{2}\/\d{4}$/.test(t)) {
              const p = t.split("/");
              if (parseInt(p[0]) === month && parseInt(p[2]) === year) return { colIdx: j, headerLabel: t };
            }
          }
          return null;
        }).filter(Boolean);
        break;
      }

      // Must have at least the review month column
      const reviewTarget = targetMonths[2];
      const hasReview = targetCols.some(({ headerLabel }) => {
        const p = headerLabel.split("/");
        return parseInt(p[0]) === reviewTarget.month && parseInt(p[2]) === reviewTarget.year;
      });
      if (!hasReview) {
        const label = new Date(+yr, +mo - 1).toLocaleString("en-US", { month: "long", year: "numeric" });
        setErr(`No column found for ${label} in this budget file. Check that the review period matches the file.`);
        return;
      }

      // Build IS-compatible format: AccountNumber,AccountName,MM/DD/YYYY,...
      const header = ["AccountNumber", "AccountName", ...targetCols.map(c => c.headerLabel)].join(",");
      const rows = [header];
      for (const line of lines) {
        const cols = line.split(",");
        const acct = (cols[0] ?? "").trim();
        if (/^\d{6}$/.test(acct)) {
          const name = (cols[1] ?? "").trim();
          const vals = targetCols.map(({ colIdx }) => (cols[colIdx] ?? "").trim());
          rows.push([acct, name, ...vals].join(","));
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

      // ── Validation: Detect IS file ──
      const earlyLines = raw.split("\n").slice(0, 15);
      const looksLikeIS = earlyLines.some(line => {
        const dateCols = line.split(",").filter(c => { const t = c.trim(); return t.length === 10 && t[2] === "/" && t[5] === "/"; });
        return dateCols.length >= 3;
      });
      if (looksLikeIS) {
        setErr("This appears to be an income statement, not a GL report. Please upload the GL report CSV.");
        return;
      }

      // ── Validation: Detect re-processed GL ──
      if (/^\/\/ GL:/m.test(raw.slice(0, 200)) || /^FORMAT:/m.test(raw.slice(0, 500))) {
        setErr("This file appears to be a previously processed GL (contains system FORMAT header). Please upload the original GL export.");
        return;
      }

      // ── Validation: Header row structure ──
      const glLines = raw.split("\n");
      const headerLine = glLines.find(l => /Posted Dt\./i.test(l));
      if (!headerLine) {
        setErr("Could not find \"Posted Dt.\" header row. This does not appear to be a standard GL export.");
        return;
      }
      const headerCols = headerLine.split(",").map(c => c.trim());
      if (headerCols.length < 10 || !/^Debit$/i.test(headerCols[headerCols.length - 3]) || !/^Credit$/i.test(headerCols[headerCols.length - 2]) || !/^Balance$/i.test(headerCols[headerCols.length - 1])) {
        setErr("GL header row does not match expected format (expected 10 columns ending with Debit, Credit, Balance). The file may be corrupted or in the wrong format.");
        return;
      }

      // ── Validation: Extract GL property name and cross-check ──
      const glFirst5 = glLines.slice(0, 5).join("\n");
      const glPropMatch = glFirst5.match(/--([^\r\n]+)/);
      const glPropertyName = glPropMatch?.[1]?.trim() ?? "";
      if (isPropertyName && glPropertyName && glPropertyName.toLowerCase() !== isPropertyName.toLowerCase()) {
        setErr("GL property mismatch: GL is for \"" + glPropertyName + "\" but the uploaded income statement is for \"" + isPropertyName + "\". Please upload the GL for the correct property.");
        return;
      }

      // Capture full raw GL text for data store (pre-trim)
      setRawGlText(raw);

      const [yr, mo] = reviewMonth.split("-");

      const keepMonths = new Set();
      for (let i = 0; i < 2; i++) {
        const d = new Date(+yr, +mo - 1 - i, 1);
        keepMonths.add(
          String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear()
        );
      }

      const lines = glLines;

      // Regex matching revenue (440001+) and expense (5xxxxx, 6xxxxx, 7xxxxx+) account headers
      const acctHdrRe = /^(?:4[4-9]\d{3,4}|[5-9]\d{4,5})\s+-/;

      // ── Validation: Account sections exist ──
      const hasAccounts = lines.some(l => acctHdrRe.test(l));
      if (!hasAccounts) {
        setErr("No revenue (44xxxx+) or expense (6xxxxx) accounts found. Check that a GL report with account sections was uploaded.");
        return;
      }

      // ── Validation: Minimum account sections ──
      const acctSectionCount = lines.filter(l => acctHdrRe.test(l)).length;
      if (acctSectionCount < 3) {
        setErr("Only " + acctSectionCount + " account sections detected (expected at least 3). The file may be truncated.");
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
    setReviewError(""); setReviewing(true); setFindings([]); setGeneralFindings([]); setDetailOpen({});
    setReviewBlobUrl(null); setFindingsFbMode(false); setFindingsFbSaved(false);
    setMemoryReviewResult(null); setMemoryReviewError("");
    setFindingsFbDraft({ findings: {}, accountNotes: [{ id: 1, accountNumber: "", note: "" }], general: "" });
    try {
      const [yr, mo] = reviewMonth.split("-");
      const label = new Date(+yr, +mo - 1).toLocaleString("en-US", { month: "long", year: "numeric" });

      let isFindings = [];
      let glFindings = [];

      // ── Fetch KB (parallel, fail-silent) ─────────────────────────────────────
      let globalKb = "", propertyKb = "";
      try {
        const kbFetches = [fetch("/api/kb?type=global").then(r => r.json()).catch(() => ({}))];
        if (isPropertyName) kbFetches.push(fetch(`/api/kb?type=property&name=${encodeURIComponent(isPropertyName)}`).then(r => r.json()).catch(() => ({})));
        const [globalData, propertyData] = await Promise.all(kbFetches);
        globalKb   = globalData?.compressed   || "";
        propertyKb = propertyData?.compressed || "";
      } catch {}

      const kbBlock = (() => {
        const parts = [];
        if (globalKb)   parts.push("FIRM-WIDE SOPs:\n" + globalKb);
        if (propertyKb) parts.push(isPropertyName + " PROPERTY-SPECIFIC RULES:\n" + propertyKb);
        if (!parts.length) return "";
        return "\n\nKNOWLEDGE BASE — Property-specific rules override Firm-Wide SOPs. Both override the checklist below. If a KB rule conflicts with or suppresses a checklist finding, follow the KB rule.\n\n" + parts.join("\n\n");
      })();

      // ── Call 1: Income Statement Review ──────────────────────────────────────
      if (incomeStatement.trim()) {
        setReviewStatus("Reviewing income statement...");
        const isSys ="You are a senior multifamily property accountant performing a monthly financial review.\n\nYou must work through EVERY category in the checklist systematically from top to bottom. Do not stop early. Do not skip categories. Every FLAG IF rule must be evaluated against the data.\n\nRULES FOR READING THE DATA:\n- The review period column is the column whose header date matches the review period. Use only that column for current month balances.\n- When calculating trailing averages, use the 3 months immediately prior to the review period only. Do not include the current review month in the average.\n- Do not reference YTD totals, TTM columns, or any future month columns.\n- Revenue accounts are in the 4xxxxx range (e.g. 411001–440032). Expense accounts are in the 6xxxxx range (e.g. 601001–640001).\n- Flag every expense account (6xxxxx) that shows a negative month-ending balance in the review period as a finding.\n\nFOR EACH FLAG IF RULE:\n- If the data is present and the condition is NOT met, skip it silently.\n- If the data is present and the condition IS met, include it as a finding.\n- Only skip a rule if the account numbers listed do not appear anywhere in the income statement data at all.\n\nOUTPUT RULES:\n- Return a JSON array only. No preamble, no explanation, no markdown backticks.\n- Each finding must be an object with exactly these fields:\n  - accountNumber: the specific account number as a string e.g. \"601005\"\n  - accountName: the specific account name e.g. \"Roof Supplies & Repairs\"\n  - issue: 1-2 sentences maximum. State the specific variance or anomaly with exact dollar amounts and the threshold breached. Nothing else.\n  - action: one directive sentence stating what to obtain or verify.\n- Order findings by accountNumber ascending.\n- Return an empty array [] if genuinely no issues are found.\n- Exception — PROCESS-LEVEL FINDINGS ONLY: if a finding cannot be attributed to any specific account number (e.g., a required accrual process appears to have not been run for the period), use accountNumber: \"GENERAL\" and accountName: \"General Finding\". Use this ONLY when there is truly no account to attach the issue to. Do not use GENERAL for any finding that can be linked to a specific account.";

        const isUsr = "REVIEW PERIOD: " + label + kbBlock + "\n\nCHECKLIST:\n" + serializeBySource(items, "IS") + "\n\nINCOME STATEMENT:\n" + incomeStatement + "\n\nReview the " + label + " income statement against the checklist.";

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

      const glSys = "You are a senior multifamily property accountant investigating GL journal entries.\n\nACCOUNT RANGES: Revenue accounts are in the 4xxxxx range (e.g. 411001–440032). Expense accounts are in the 6xxxxx range (e.g. 601001–640001). Debt service accounts are in the 7xxxxx range.\n\nYou will receive two things: (1) a list of issues already identified from the income statement, and (2) GL journal entries to investigate.\n\nYour job has two parts:\nPART 1 - For each income statement finding, look at the GL entries for that account and add only the specific entry-level detail that explains or confirms the anomaly (dates, amounts, descriptions). Do not describe entries that are functioning correctly.\nPART 2 - Apply the GL checklist rules to identify issues visible only in the GL that the income statement would not show.\n\nCRITICAL RULES:\n- Only create a finding if there is a specific problem, error, or pattern risk. Do not create findings where GL activity is normal and consistent.\n- Do not describe entries that are working correctly. State only what is wrong.\n- Do not include findings where your conclusion is that activity looks accurate. If the GL simply explains an IS variance with no anomaly, do not add a GL finding — let the IS finding stand alone.\n- Do NOT re-detect income statement variance issues. Do NOT recalculate month-ending balances or compare column totals. Only look at individual journal entry patterns: accruals, reversals, duplicate postings, missing pairs, suspicious descriptions, and timing anomalies.\n\nOUTPUT RULES:\n- Return a JSON array only. No preamble, no explanation, no markdown backticks.\n- Each finding must be an object with exactly these fields:\n  - accountNumber: the specific account number as a string e.g. \"601005\"\n  - accountName: the specific account name e.g. \"Roof Supplies & Repairs\"\n  - issue: 2-3 sentences maximum. State only the specific anomaly with the relevant entry dates and amounts. Do not narrate correct activity.\n  - action: one directive sentence stating what to obtain or verify.\n  - source: either \"IS\" if this augments an income statement finding, or \"GL\" if this is a new GL-only finding\n- If you cannot find the specific entries to evaluate a checklist rule, skip it entirely.\n- Order findings by accountNumber ascending.\n- Return an empty array [] if no issues are found.\n- Exception — PROCESS-LEVEL FINDINGS ONLY: if a finding cannot be attributed to any specific account number, use accountNumber: \"GENERAL\" and accountName: \"General Finding\". Use ONLY when no account number can be identified. Do not use GENERAL for any finding that can be linked to a specific account.";
      // Only pass IS findings to GL where the action specifically calls for GL investigation
      const glRelevantFindings = isFindings
        .filter(f => /gl|general ledger|journal|entr|invoice|posting/i.test(f.action || ""))
        .map(({ accountNumber, accountName, issue }) => ({ accountNumber, accountName, issue }));
      const glUsr = "REVIEW PERIOD: " + label + "\n\nINCOME STATEMENT FINDINGS REQUIRING GL INVESTIGATION:\n" + JSON.stringify(glRelevantFindings, null, 2) + kbBlock + "\n\nGL CHECKLIST:\n" + serializeBySource(items, "GL") + "\n\nGL ENTRIES:\n" + glEntries + "\n\nInvestigate the GL entries for " + label + ".";

      const budSys = "You are a senior multifamily property accountant performing a budget variance review. Apply exactly two checks to expense accounts (6xxxxx) only:\n\nCHECK 1 — UNBUDGETED EXPENSES: Any expense account where actual > $0 but budget is $0 or missing. Flag as potential miscoding.\n\nCHECK 2 — MATERIAL BUDGET OVERAGES: Any expense account where actual exceeds budget by more than 25% AND the dollar overage is greater than $500. Skip accounts where budget is $0 (caught by Check 1).\n\nOUTPUT RULES:\n- Return a JSON array only. No preamble, no explanation, no markdown backticks.\n- Each object: { accountNumber, accountName, issue, action, checkType } where checkType is \"UNBUDGETED\" or \"BUDGET_OVERAGE\"\n- Include exact actual amount, budget amount, and variance % in the issue field.\n- Keep action to one sentence.\n- Order by accountNumber ascending.\n- Return [] if no issues found.";
      // Filter budget to review month only for AI (display keeps all 3 months)
      const budgetForAI = (() => {
        if (!budgetData) return "";
        const lines = budgetData.split("\n");
        const [byr, bmo] = reviewMonth.split("-").map(Number);
        const hdrIdx = lines.findIndex(l => l.split(",").some(c => /^\d{1,2}\/\d{2}\/\d{4}$/.test(c.trim())));
        if (hdrIdx === -1) return budgetData;
        const hdrs = lines[hdrIdx].split(",").map(c => c.trim());
        const revCol = hdrs.findIndex(c => {
          const m = c.match(/^(\d{1,2})\/\d{2}\/(\d{4})$/);
          return m && parseInt(m[1]) === bmo && parseInt(m[2]) === byr;
        });
        if (revCol === -1) return budgetData;
        return lines.map(l => { const p = l.split(","); return [p[0]??"", p[1]??"", p[revCol]??""].join(","); }).join("\n");
      })();
      const budUsr = "REVIEW PERIOD: " + label + "\n\nACTUAL (from income statement, review month column only):\n" + incomeStatement + "\n\nBUDGET (review month only):\n" + budgetForAI + "\n\nApply the two budget checks for " + label + ".";

      const [glResult, budResult] = await Promise.all([
        glEntries.trim()
          ? callClaude(glSys, glUsr, { thinking: { type: "enabled", budget_tokens: 2500 }, max_tokens: 16000 })
              .then(raw => { const match = raw.match(/\[[\s\S]*\]/); return JSON.parse(match ? match[0] : raw); })
              .catch(e => { setReviewError("GL error: " + e.message.slice(0, 300)); return []; })
          : Promise.resolve([]),
        budgetData.trim()
          ? callClaude(budSys, budUsr, { thinking: { type: "enabled", budget_tokens: 2000 }, max_tokens: 16000 })
              .then(raw => { const match = raw.match(/\[[\s\S]*\]/); return JSON.parse(match ? match[0] : raw); })
              .catch(e => { setReviewError("Budget error: " + e.message.slice(0, 300)); return []; })
          : Promise.resolve([]),
      ]);

      glFindings = glResult;

      // ── Consolidate UNBUDGETED budget findings into a single GENERAL card ─────
      const rawBudgetFindings = budResult;
      const isUnbudgeted = (f) => f.checkType === "UNBUDGETED" || /not budgeted|budget.{0,5}\$0|no.{0,10}budget/i.test(f.issue || "");
      const unbudgeted = rawBudgetFindings.filter(isUnbudgeted);
      const overages   = rawBudgetFindings.filter(f => !isUnbudgeted(f));
      const budgetFindings = unbudgeted.length > 0
        ? [
            {
              accountNumber: "GENERAL",
              accountName: "Unbudgeted Expenses",
              issue: unbudgeted.map(f => `- ${f.accountNumber} ${f.accountName}: ${f.issue}`).join("\n"),
              action: "Review each account for coding accuracy and establish budget lines where spend is recurring.",
              checkType: "UNBUDGETED",
            },
            ...overages,
          ]
        : overages;

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
      const generalArr  = mergedArray.filter(f => f.accountNumber === "GENERAL");
      const accountArr  = mergedArray.filter(f => f.accountNumber !== "GENERAL");
      setGeneralFindings(generalArr);
      setFindings(accountArr);
      setTab("findings");

      const propertyName = isPropertyName
        || (glFileName ? glFileName.replace(/\.[^.]+$/, "").split("_").pop() : "");
      setReviewPropertyName(propertyName);

      // Fire-and-forget email notification
      fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findings: accountArr, label, propertyName })
      }).catch(() => {});

      // Fire-and-forget history save
      fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property:          propertyName,
          period:            reviewMonth,
          timestamp:         new Date().toISOString(),
          generalFindings:   generalArr,
          findings:          accountArr,
          checklistSnapshot: items,
          csvs: {
            is:     incomeStatement,
            gl:     glEntries,
            budget: budgetData,
          },
        }),
      }).then(r => r.json())
        .then(d => {
          if (d.ok) { setHistoryLoaded(false); setReviewBlobUrl(d.blobUrl); }
        })
        .catch(() => {});

      // Fire-and-forget data store ingestion (raw IS → time series, raw GL → transactions)
      if (rawIsText && propertyName) {
        fetch("/api/data-store", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ property: propertyName, period: reviewMonth, action: "ingest-is", rawIs: rawIsText }),
        }).catch(() => {});
      }
      if (rawGlText && propertyName) {
        fetch("/api/data-store", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ property: propertyName, period: reviewMonth, action: "ingest-gl", rawGl: rawGlText }),
        }).catch(() => {});
      }

    } catch(e) { setReviewError("Error: " + (e.message || "Please try again.")); }
    setReviewStatus("");
    setReviewing(false);
  };

  // ── Stage 2: Memory-enriched review ────────────────────────────────────────
  const runMemoryReview = async () => {
    if (!findings.length && !generalFindings.length) return;
    setMemoryReviewRunning(true);
    setMemoryReviewError("");
    setMemoryReviewResult(null);
    try {
      // Combine all findings into a flat array for the memory review
      const allFindings = [
        ...findings.map(f => ({
          accountNumber: f.accountNumber, accountName: f.accountName,
          issue: [f.isIssue, f.glIssue].filter(Boolean).join(" | "),
          action: f.action, source: f.source || "IS+GL",
        })),
        ...generalFindings.map(f => ({
          accountNumber: f.accountNumber || "", accountName: f.accountName || "",
          issue: f.issue || f.isIssue || f.glIssue || "",
          action: f.action || "", source: f.source || "general",
        })),
      ];

      const res = await fetch("/api/memory-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property: isPropertyName || reviewPropertyName || "Unknown",
          month: reviewMonth,
          findings: allFindings,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Memory review failed (${res.status})`);
      }

      const result = await res.json();
      setMemoryReviewResult(result);
    } catch (e) {
      setMemoryReviewError(e.message || "Memory review failed");
    }
    setMemoryReviewRunning(false);
  };

  const sendMemoryChat = async () => {
    const q = memoryChatInput.trim();
    if (!q || memoryChatLoading) return;
    const newMsg = { role: "user", content: q };
    const updated = [...memoryChatMessages, newMsg];
    setMemoryChatMessages(updated);
    setMemoryChatInput("");
    setMemoryChatLoading(true);
    try {
      const res = await fetch("/api/memory-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property: isPropertyName || reviewPropertyName || "Unknown",
          month: reviewMonth,
          messages: updated,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Chat failed (${res.status})`);
      }
      const data = await res.json();
      setMemoryChatMessages(m => [...m, { role: "assistant", content: data.response }]);
    } catch (e) {
      setMemoryChatMessages(m => [...m, { role: "assistant", content: `Error: ${e.message}` }]);
    }
    setMemoryChatLoading(false);
  };

  const RATING_LABELS = { correct: "Review Correct: No Actions", false_positive: "Review Error Present", needs_review: "Review Correct: Actions Required" };

  const buildXlsxRows = (findingsArr, fbObj) => {
    const rows = findingsArr.map(item => {
      const itemFb = fbObj?.findings?.[item.accountNumber] || {};
      return {
        "Account Number": item.accountNumber,
        "Account Name":   item.accountName,
        "IS Finding":     item.isIssue     || "",
        "GL Finding":     item.glIssue     || "",
        "Action":         item.action      || "",
        "Feedback":       RATING_LABELS[itemFb.rating] || "",
        "Comments":       itemFb.note      || "",
      };
    });
    (fbObj?.accountNotes || []).forEach(row => {
      if (!row.accountNumber?.trim() && !row.note?.trim()) return;
      rows.push({
        "Account Number": row.accountNumber || "",
        "Account Name":   "",
        "IS Finding":     "",
        "GL Finding":     "",
        "Action":         "",
        "Feedback":       "",
        "Comments":       row.note || "",
      });
    });
    return rows;
  };

  const downloadXlsx = () => {
    const rows = buildXlsxRows(findings, findingsFbDraft);
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch:16 },{ wch:36 },{ wch:60 },{ wch:60 },{ wch:50 },{ wch:16 },{ wch:50 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Findings");
    XLSX.writeFile(wb, "Accounting_Review_" + reviewMonth + ".xlsx");
  };

  const downloadHistoryXlsx = async (r) => {
    try {
      let data = expandedReview?.blobUrl === r.blobUrl ? expandedReview.data : null;
      if (!data) {
        const res = await fetch(`/api/history?url=${encodeURIComponent(r.blobUrl)}`);
        data = await res.json();
      }
      if (!data?.findings?.length) { alert("No findings to download."); return; }
      let fb = null;
      try {
        const fbRes = await fetch(`/api/feedback?blobUrl=${encodeURIComponent(r.blobUrl)}`);
        if (fbRes.ok) fb = await fbRes.json();
      } catch {}
      const rows = buildXlsxRows(data.findings, fb);
      const ws = XLSX.utils.json_to_sheet(rows);
      ws["!cols"] = [{ wch:16 },{ wch:36 },{ wch:60 },{ wch:60 },{ wch:50 },{ wch:16 },{ wch:50 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Findings");
      const [yr, mo] = r.period.split("-");
      XLSX.writeFile(wb, `Accounting_Review_${r.property || "Review"}_${r.period}.xlsx`);
    } catch { alert("Download failed — please try again."); }
  };

  // ── Knowledge Base helpers ────────────────────────────────────────────────────
  const loadKb = async (scope, propertyName) => {
    setKbLoading(true); setKbError("");
    try {
      const url = scope === "global"
        ? "/api/kb?type=global"
        : `/api/kb?type=property&name=${encodeURIComponent(propertyName)}`;
      const res = await fetch(url);
      const data = await res.json();
      setKbSource(data.source || "");
      setKbCompressed(data.compressed || "");
      setKbTokenCount(data.tokenCount || 0);
    } catch { setKbError("Failed to load knowledge base."); }
    finally { setKbLoading(false); }
  };

  const loadKbPropertyList = async () => {
    try {
      const [kbRes, histRes] = await Promise.all([
        fetch("/api/kb?type=property-list"),
        fetch("/api/history"),
      ]);
      const kbList   = await kbRes.json().catch(() => []);
      const histData = await histRes.json().catch(() => []);
      const histProps = [...new Set((Array.isArray(histData) ? histData : []).map(r => r.property).filter(Boolean))];
      const merged = [...new Set([...(Array.isArray(kbList) ? kbList : []), ...histProps])].sort();
      setKbPropertyList(merged);
    } catch {}
  };

  const saveKbSource = async (source, triggerCompress = true) => {
    setKbSaving(true); setKbError("");
    try {
      await fetch("/api/kb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: kbScope, name: kbPropertyName, source }),
      });
      setKbSource(source);
      setKbClarifyQuestions([]);
      if (!source.trim()) { setKbCompressed(""); setKbTokenCount(0); }
      if (triggerCompress && source.trim()) {
        setKbCompressing(true);
        fetch("/api/kb-compress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: kbScope, name: kbPropertyName, source }),
        })
          .then(r => r.json())
          .then(d => { setKbCompressed(d.compressed || ""); setKbTokenCount(d.tokenCount || 0); })
          .finally(() => setKbCompressing(false));
      }
    } catch { setKbError("Failed to save."); }
    finally { setKbSaving(false); }
  };

  const sendKbChat = async () => {
    if (!kbChatInput.trim()) return;
    setKbChatLoading(true); setKbError(""); setKbClarifyQuestions([]);
    try {
      const res = await fetch("/api/kb-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userMessage: kbChatInput, currentSource: kbSource, scope: kbScope, clarifyQuestions: kbClarifyQuestions.length > 0 ? kbClarifyQuestions : undefined }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setKbPending(data);
      setKbChatInput("");
    } catch(e) { setKbError(e.message || "Chat failed."); }
    finally { setKbChatLoading(false); }
  };

  const askKbClarify = async () => {
    setKbClarifyLoading(true); setKbError(""); setKbClarifyQuestions([]);
    try {
      const res = await fetch("/api/kb-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "clarify", currentSource: kbSource, scope: kbScope }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setKbClarifyQuestions(data.questions || []);
    } catch(e) { setKbError(e.message || "Clarify failed."); }
    finally { setKbClarifyLoading(false); }
  };

  const confirmKbPending = async () => {
    if (!kbPending) return;
    await saveKbSource(kbPending.proposedSource);
    setKbPending(null);
  };

  const deletePropertyKb = async (name) => {
    if (!window.confirm(`Delete the entire knowledge base for "${name}"? This cannot be undone.`)) return;
    try {
      await fetch("/api/kb", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setKbPropertyList(prev => prev.filter(p => p !== name));
      if (kbPropertyName === name) { setKbPropertyName(""); setKbSource(""); setKbCompressed(""); setKbTokenCount(0); }
    } catch { setKbError("Failed to delete."); }
  };

  const loadKbFeedbackQueue = async () => {
    setKbFeedbackLoading(true);
    try {
      const committed = historyIndex.filter(r => r.feedbackCommitted);
      const queue = await Promise.all(committed.map(async r => {
        try {
          const res = await fetch(`/api/feedback?blobUrl=${encodeURIComponent(r.blobUrl)}`);
          const fb = await res.json();
          return { ...r, feedback: fb };
        } catch { return null; }
      }));
      setKbFeedbackQueue(queue.filter(Boolean));
    } catch {}
    finally { setKbFeedbackLoading(false); }
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
              {key:"reports",   label:"05 · Reports",    dot: !!reportContent},
              {key:"kb",        label:"06 · Knowledge Base"},
              {key:"portfolio", label:"07 · Portfolio",    dot: !!portfolioData?.properties?.length},
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
                if (t.key === "kb" && kbAuthed) {
                  loadKbPropertyList();
                  if (kbScope === "global" && !kbSource) loadKb("global", "");
                }
                if (t.key === "portfolio" && !portfolioData && !portfolioLoading) {
                  setPortfolioLoading(true);
                  fetch("/api/history")
                    .then(r => r.json())
                    .then(data => {
                      if (!Array.isArray(data)) { setPortfolioData({ properties: [] }); return; }
                      // Group by property, compute stats
                      const byProp = {};
                      data.forEach(r => {
                        const name = r.property || "Unknown";
                        if (!byProp[name]) byProp[name] = { reviews: [], totalFindings: 0 };
                        byProp[name].reviews.push(r);
                        byProp[name].totalFindings += r.findingCount || 0;
                      });
                      const properties = Object.entries(byProp).map(([name, d]) => {
                        const sorted = d.reviews.sort((a,b) => b.timestamp?.localeCompare(a.timestamp));
                        const latest = sorted[0];
                        const avgFindings = Math.round(d.totalFindings / d.reviews.length);
                        const trend = sorted.length >= 2
                          ? (sorted[0].findingCount || 0) - (sorted[1].findingCount || 0)
                          : 0;
                        return { name, reviewCount: d.reviews.length, latestPeriod: latest.period, latestDate: latest.timestamp, latestFindings: latest.findingCount || 0, avgFindings, trend };
                      }).sort((a,b) => a.name.localeCompare(b.name));
                      setPortfolioData({ properties });
                    })
                    .catch(() => setPortfolioData({ properties: [] }))
                    .finally(() => setPortfolioLoading(false));
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
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8,marginBottom:6}}>
                <h2 style={{...s.panelTitle,marginBottom:0}}>Run a Review</h2>
                {claudeStatus !== null && (() => {
                  const cfg = claudeStatus === "none"
                    ? { color:"#4ade80", bg:"#052e16", border:"#166534", label:"Claude API: Operational" }
                    : claudeStatus === "minor"
                    ? { color:"#e8c468", bg:"#2a1f00", border:"#7a5800", label:"Claude API: Degraded" }
                    : { color:"#f87171", bg:"#1a0a0a", border:"#7f1d1d", label:"Claude API: Disruption" };
                  return (
                    <span style={{fontFamily:"'Fira Code',monospace",fontSize:10,padding:"3px 10px",
                      background:cfg.bg,border:`1px solid ${cfg.border}`,borderRadius:20,color:cfg.color,
                      letterSpacing:0.3}}>
                      ● {cfg.label}
                    </span>
                  );
                })()}
              </div>
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
                <div style={{fontFamily:"'Fira Code',monospace",fontSize:10,color:"#4b5563",marginBottom:6,letterSpacing:0.3}}>
                  T12.2 T12 Income Statement – Detail Level
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
                <div style={{fontFamily:"'Fira Code',monospace",fontSize:10,color:"#4b5563",marginBottom:6,letterSpacing:0.3}}>
                  General Ledger Report – 3 months
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
                <div style={{fontFamily:"'Fira Code',monospace",fontSize:10,color:"#4b5563",marginBottom:6,letterSpacing:0.3}}>
                  OS.9 Operating Statement – Budget
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
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <button className="btn" onClick={runMemoryReview}
                    disabled={memoryReviewRunning || (!findings.length && !generalFindings.length)}
                    style={{...s.btnOutline, fontSize:11, padding:"5px 14px",
                      borderColor: memoryReviewResult ? "#4ade80" : "#a78bfa",
                      color: memoryReviewResult ? "#4ade80" : "#a78bfa",
                      opacity: memoryReviewRunning ? 0.6 : 1}}>
                    {memoryReviewRunning ? "Running Memory Review…" : memoryReviewResult ? "Re-run Memory Review" : "Memory Review ⚡"}
                  </button>
                  {reviewBlobUrl && (
                    <button className="btn" onClick={() => { setFindingsFbMode(m => !m); setFindingsFbSaved(false); }}
                      style={{...s.btnOutline, fontSize:11, padding:"5px 14px",
                        borderColor: findingsFbMode ? "#e8c468" : "#4b5563",
                        color:       findingsFbMode ? "#e8c468" : "#d1d5db"}}>
                      {findingsFbMode ? "Cancel Feedback" : "Add Feedback"}
                    </button>
                  )}
                  <button className="btn" onClick={downloadXlsx} style={s.btnOutline}>
                    Download .xlsx
                  </button>
                </div>
              )}
            </div>
            {(findings.length > 0 || generalFindings.length > 0) ? (
              <div style={s.findingsBox}>
                {generalFindings.length > 0 && (
                  <div style={{borderBottom:"1px solid #1e1e1e", padding:"16px 0 16px 0", marginBottom:4}}>
                    <div style={{fontFamily:"'Fira Code',monospace",fontSize:10,color:"#a78bfa",letterSpacing:0.5,marginBottom:10}}>GENERAL FINDINGS</div>
                    {generalFindings.map((gf, i) => (
                      <div key={i} style={{marginBottom: i < generalFindings.length - 1 ? 12 : 0}}>
                        {gf.isIssue && <div style={{fontFamily:"'Lora',serif",fontSize:13,lineHeight:1.7,color:"#9ca3af",whiteSpace:"pre-line"}}>{gf.isIssue}</div>}
                        {gf.glIssue && <div style={{fontFamily:"'Lora',serif",fontSize:13,lineHeight:1.7,color:"#9ca3af",whiteSpace:"pre-line"}}>{gf.glIssue}</div>}
                        {gf.budgetIssue && <div style={{fontFamily:"'Lora',serif",fontSize:13,lineHeight:1.7,color:"#9ca3af",whiteSpace:"pre-line"}}>{gf.budgetIssue}</div>}
                        {!gf.isIssue && !gf.glIssue && !gf.budgetIssue && <div style={{fontFamily:"'Lora',serif",fontSize:13,color:"#6b7280",fontStyle:"italic"}}>No details</div>}
                        {gf.action && <div style={{marginTop:4}}>
                          <span style={{fontFamily:"'Fira Code',monospace",fontSize:10,color:"#6ee7a0",letterSpacing:0.5}}>Action · </span>
                          <span style={{fontFamily:"'Lora',serif",fontSize:13,lineHeight:1.7,color:"#9ca3af"}}>{gf.action}</span>
                        </div>}
                      </div>
                    ))}
                  </div>
                )}
                {findings.map((item, i) => {
                  // Look up memory review disposition for this finding by account number
                  const memEntry = memoryReviewResult?.enrichedFindings?.find(
                    ef => ef.original?.accountNumber === item.accountNumber
                  );
                  const dColor = memEntry ? ({keep:"#9ca3af", suppress:"#ef4444", elevate:"#f59e0b", context:"#60a5fa"}[memEntry.disposition] || "#9ca3af") : null;
                  const dLabel = memEntry ? ({keep:"KEEP", suppress:"SUPPRESS", elevate:"ELEVATE", context:"CONTEXT"}[memEntry.disposition] || memEntry.disposition) : null;
                  return (
                  <div key={i} style={{borderBottom:"1px solid #1e1e1e", padding:"16px 0"}}>
                    <div style={{display:"flex", alignItems:"center", gap:10, marginBottom:8}}>
                      <span style={{fontFamily:"'Syne',sans-serif", fontWeight:600, fontSize:14, color:"#f5f5f5"}}>
                        {item.accountName} ({item.accountNumber})
                      </span>
                      {memEntry && (
                        <span style={{fontFamily:"'Fira Code',monospace", fontSize:9, padding:"2px 8px", borderRadius:10, background:`${dColor}22`, color:dColor, fontWeight:600, flexShrink:0}}>
                          {dLabel}
                        </span>
                      )}
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

                    {/* Inline memory review note */}
                    {memEntry?.memory_note && (
                      <div style={{marginTop:8, padding:"8px 12px", borderRadius:6, borderLeft:`3px solid ${dColor}`, background:"#0d0b1a"}}>
                        <span style={{fontFamily:"'Fira Code',monospace", fontSize:10, color:"#a78bfa", letterSpacing:0.5}}>MEMORY · </span>
                        <span style={{fontFamily:"'Lora',serif", fontSize:12, lineHeight:1.7, color:"#c4b5fd"}}>{memEntry.memory_note}</span>
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
                      {budgetData && (
                        <button className="btn" onClick={() => toggleDetail(item.accountNumber, "bud")}
                          style={{...s.btnOutline,fontSize:10,padding:"2px 10px",
                            color: detailOpen[item.accountNumber]?.bud ? "#f97316" : "#4b5563",
                            borderColor: detailOpen[item.accountNumber]?.bud ? "#f97316" : "#2a2a2a"}}>
                          BUD {detailOpen[item.accountNumber]?.bud ? "▲" : "▼"}
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

                    {/* Budget detail table */}
                    {detailOpen[item.accountNumber]?.bud && (() => {
                      const d = parseIsDetail(budgetData, item.accountNumber);
                      if (!d) return <div style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#4b5563",marginTop:8}}>No budget data found for {item.accountNumber}.</div>;
                      const tblCell = (align, extra) => ({
                        padding:"4px 10px", textAlign:align, borderBottom:"1px solid #141414",
                        fontFamily:"'Fira Code',monospace", fontSize:11, whiteSpace:"nowrap", ...extra
                      });
                      return (
                        <div style={{marginTop:10,overflowX:"auto",borderRadius:6,border:"1px solid #2a1a0a"}}>
                          <table style={{borderCollapse:"collapse",width:"100%"}}>
                            <thead>
                              <tr style={{background:"#111"}}>
                                {d.headers.map((h,hi) => (
                                  <th key={hi} style={tblCell(hi<=1?"left":"right",{color:"#4b5563",fontWeight:400})}>{h}</th>
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
                                <tr style={{background:"#1a0d00",borderTop:"1px solid #3a2a0a"}}>
                                  {d.sumRow.map((v,vi) => {
                                    const num = vi>=2 ? parseFloat(v) : NaN;
                                    const fmt = !isNaN(num) ? num.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}) : v;
                                    return <td key={vi} style={tblCell(vi<=1?"left":"right",{color:vi<2?"#f97316":num<0?"#f87171":num===0?"#374151":"#f97316",fontWeight:600})}>{fmt}</td>;
                                  })}
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      );
                    })()}

                    {/* Per-finding feedback (findings tab) */}
                    {findingsFbMode && (() => {
                      const fb = findingsFbDraft.findings[item.accountNumber] || {};
                      return (
                        <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid #1a1a1a"}}>
                          <div style={{display:"flex",gap:6,marginBottom:8}}>
                            {[
                              {val:"correct",        label:"✓ Review Correct: No Actions",     color:"#4ade80"},
                              {val:"false_positive", label:"✗ Review Error Present",            color:"#f87171"},
                              {val:"needs_review",   label:"? Review Correct: Actions Required",color:"#e8c468"},
                            ].map(opt => (
                              <button key={opt.val} className="btn"
                                onClick={() => setFindingsFbDraft(d => ({
                                  ...d, findings: { ...d.findings,
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
                            onChange={e => setFindingsFbDraft(d => ({
                              ...d, findings: { ...d.findings,
                                [item.accountNumber]: { ...fb, note: e.target.value }
                              }
                            }))}
                            style={{...s.textarea,minHeight:44,fontSize:12,width:"100%",marginTop:2}}
                          />
                        </div>
                      );
                    })()}
                  </div>
                  );
                })}

                {/* New signals from memory (not matched to existing findings) */}
                {memoryReviewResult?.newSignals?.length > 0 && (
                  <div style={{borderTop:"1px solid #2d1f5e", padding:"16px 0"}}>
                    <div style={{fontFamily:"'Fira Code',monospace", fontSize:10, color:"#4ade80", letterSpacing:0.5, marginBottom:10}}>NEW SIGNALS FROM MEMORY</div>
                    {memoryReviewResult.newSignals.map((ns, i) => (
                      <div key={i} style={{marginBottom:10, padding:"8px 12px", borderRadius:6, borderLeft:"3px solid #4ade80", background:"#0d0b1a"}}>
                        <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:4}}>
                          <span style={{fontFamily:"'Fira Code',monospace", fontSize:9, padding:"2px 8px", borderRadius:10, background:"#4ade8022", color:"#4ade80", fontWeight:600}}>NEW</span>
                          <span style={{fontFamily:"'Fira Code',monospace", fontSize:11, color:"#e8c468"}}>{ns.accountNumber} {ns.accountName || ""}</span>
                          {ns.severity && <span style={{fontFamily:"'Fira Code',monospace", fontSize:10, color: ns.severity === "high" ? "#ef4444" : "#f59e0b"}}>{ns.severity}</span>}
                        </div>
                        <div style={{fontFamily:"'Lora',serif", fontSize:12, lineHeight:1.7, color:"#9ca3af"}}>{ns.issue}</div>
                        {ns.memory_note && <div style={{fontFamily:"'Lora',serif", fontSize:12, color:"#c4b5fd", lineHeight:1.6}}>↳ {ns.memory_note}</div>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Memory review summary bar */}
                {memoryReviewResult && (
                  <div style={{padding:"8px 12px", borderTop:"1px solid #1a1a2e", fontFamily:"'Fira Code',monospace", fontSize:10, color:"#4b5563", display:"flex", justifyContent:"space-between"}}>
                    <span>
                      {memoryReviewResult.summary?.suppressed || 0} suppressed · {memoryReviewResult.summary?.elevated || 0} elevated · {memoryReviewResult.summary?.new || 0} new signals
                    </span>
                    <span>
                      {memoryReviewResult.memoryAvailable?.hasBrief ? "brief ✓" : "brief ✗"}
                      {" · "}{memoryReviewResult.memoryAvailable?.counterHeuristicCount || 0} CH
                      {" · "}{memoryReviewResult.memoryAvailable?.signalMonths || 0} signal months
                    </span>
                  </div>
                )}

                {memoryReviewError && (
                  <div style={{margin:"16px 0", padding:"12px 16px", borderRadius:6, border:"1px solid #7f1d1d", background:"#1a0505", fontFamily:"'Fira Code',monospace", fontSize:12, color:"#fca5a5"}}>
                    Memory Review Error: {memoryReviewError}
                  </div>
                )}

                {/* ── Memory Chat ───────────────────────────────────────── */}
                {memoryReviewResult && (
                  <div style={{margin:"12px 0", border:"1px solid #2d1f5e", borderRadius:8, background:"#0d0b1a", overflow:"hidden"}}>
                    <div onClick={() => setMemoryChatOpen(o => !o)}
                      style={{padding:"10px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer", borderBottom: memoryChatOpen ? "1px solid #2d1f5e" : "none"}}>
                      <span style={{fontFamily:"'Fira Code',monospace", fontSize:11, color:"#a78bfa", letterSpacing:0.5}}>
                        ASK MEMORY
                      </span>
                      <span style={{color:"#6b7280", fontSize:12}}>{memoryChatOpen ? "▾" : "▸"}</span>
                    </div>
                    {memoryChatOpen && (
                      <div style={{padding:"12px 16px"}}>
                        {memoryChatMessages.length === 0 && (
                          <div style={{fontFamily:"'Lora',serif", fontSize:12, color:"#4b5563", marginBottom:12, lineHeight:1.6}}>
                            Ask questions about any account, vendor, or pattern. Memory has 12+ months of history for this property.
                          </div>
                        )}
                        <div style={{maxHeight:300, overflowY:"auto", marginBottom:10}}>
                          {memoryChatMessages.map((msg, i) => (
                            <div key={i} style={{marginBottom:10, padding:"8px 12px", borderRadius:6,
                              background: msg.role === "user" ? "#1a1a2e" : "#0d1a0d",
                              borderLeft: `3px solid ${msg.role === "user" ? "#a78bfa" : "#4ade80"}`}}>
                              <div style={{fontFamily:"'Fira Code',monospace", fontSize:9, color: msg.role === "user" ? "#a78bfa" : "#4ade80", marginBottom:4, letterSpacing:0.5}}>
                                {msg.role === "user" ? "YOU" : "MEMORY"}
                              </div>
                              <div style={{fontFamily:"'Lora',serif", fontSize:12, color:"#d1d5db", lineHeight:1.7, whiteSpace:"pre-wrap"}}>
                                {msg.content}
                              </div>
                            </div>
                          ))}
                          {memoryChatLoading && (
                            <div style={{fontFamily:"'Fira Code',monospace", fontSize:11, color:"#a78bfa", padding:"8px 12px"}}>
                              Thinking...
                            </div>
                          )}
                        </div>
                        <div style={{display:"flex", gap:8}}>
                          <input
                            type="text"
                            value={memoryChatInput}
                            onChange={e => setMemoryChatInput(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMemoryChat(); }}}
                            placeholder="e.g., What's the typical baseline for 601004? Any duplicate signals on 607018?"
                            style={{flex:1, background:"#0e0e0e", border:"1px solid #2a2a2a", borderRadius:6, color:"#d1d5db",
                              fontFamily:"'Fira Code',monospace", fontSize:11, padding:"8px 12px"}}
                          />
                          <button className="btn" onClick={sendMemoryChat} disabled={memoryChatLoading || !memoryChatInput.trim()}
                            style={{background:"#a78bfa", color:"#0e0e0e", border:"none", borderRadius:6, padding:"8px 14px",
                              fontFamily:"'Fira Code',monospace", fontSize:11, fontWeight:600, opacity: memoryChatLoading ? 0.5 : 1}}>
                            Ask
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Account-specific notes + general + submit (findings tab) */}
                {findingsFbMode && (
                  <>
                    <div style={{marginTop:20,paddingTop:16,borderTop:"1px solid #1e1e1e"}}>
                      <div style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#e8c468",marginBottom:12,letterSpacing:0.5}}>
                        ACCOUNT-SPECIFIC FEEDBACK
                      </div>
                      {findingsFbDraft.accountNotes.map(row => (
                        <div key={row.id} style={{display:"flex",gap:8,alignItems:"flex-start",marginBottom:8}}>
                          <input type="text" placeholder="Account #" value={row.accountNumber}
                            onChange={e => setFindingsFbDraft(d => ({
                              ...d, accountNotes: d.accountNotes.map(r => r.id === row.id ? {...r, accountNumber: e.target.value} : r)
                            }))}
                            style={{...s.textarea,minHeight:0,height:36,fontSize:12,width:110,flexShrink:0,padding:"6px 10px"}}
                          />
                          <textarea
                            placeholder="Account-specific feedback not mentioned above: be as specific as possible"
                            value={row.note}
                            onChange={e => setFindingsFbDraft(d => ({
                              ...d, accountNotes: d.accountNotes.map(r => r.id === row.id ? {...r, note: e.target.value} : r)
                            }))}
                            style={{...s.textarea,minHeight:36,fontSize:12,flex:1}}
                          />
                          {findingsFbDraft.accountNotes.length > 1 && (
                            <button className="btn" onClick={() => setFindingsFbDraft(d => ({
                              ...d, accountNotes: d.accountNotes.filter(r => r.id !== row.id)
                            }))}
                              style={{fontFamily:"'Fira Code',monospace",fontSize:12,padding:"6px 10px",
                                color:"#4b5563",border:"1px solid #1e1e1e",borderRadius:4,
                                background:"transparent",flexShrink:0,cursor:"pointer"}}>
                              ✕
                            </button>
                          )}
                        </div>
                      ))}
                      <button className="btn" onClick={() => setFindingsFbDraft(d => ({
                        ...d, accountNotes: [...d.accountNotes, { id: Date.now(), accountNumber: "", note: "" }]
                      }))}
                        style={{fontFamily:"'Fira Code',monospace",fontSize:11,padding:"4px 14px",
                          color:"#4b5563",border:"1px solid #1e1e1e",borderRadius:4,
                          background:"transparent",cursor:"pointer",marginTop:2}}>
                        + Add Account
                      </button>
                    </div>
                    <div style={{marginTop:16,paddingTop:16,borderTop:"1px solid #1e1e1e"}}>
                      <div style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#e8c468",marginBottom:8,letterSpacing:0.5}}>
                        GENERAL FEEDBACK
                      </div>
                      <textarea
                        placeholder="Additional observations, missed issues, context, or suggestions for improving future reviews…"
                        value={findingsFbDraft.general}
                        onChange={e => setFindingsFbDraft(d => ({...d, general: e.target.value}))}
                        style={{...s.textarea,minHeight:90,width:"100%",marginBottom:12}}
                      />
                      <div style={{display:"flex",alignItems:"center",gap:12}}>
                        <button className="btn" disabled={findingsFbSaving}
                          onClick={async () => {
                            setFindingsFbSaving(true);
                            try {
                              const res = await fetch("/api/feedback", {
                                method: "POST",
                                headers: {"Content-Type":"application/json"},
                                body: JSON.stringify({
                                  blobUrl: reviewBlobUrl,
                                  feedback: {
                                    ...findingsFbDraft,
                                    reviewMeta: { property: reviewPropertyName, period: reviewMonth, timestamp: new Date().toISOString() },
                                  },
                                }),
                              });
                              if (!res.ok) throw new Error();
                              setFindingsFbSaved(true);
                              setFindingsFbMode(false);
                              setHistoryIndex(prev => prev.map(e =>
                                e.blobUrl === reviewBlobUrl ? { ...e, hasFeedback: true } : e
                              ));
                            } catch { alert("Failed to save feedback — please try again."); }
                            finally { setFindingsFbSaving(false); }
                          }}
                          style={{...s.btnGold,fontSize:12,padding:"6px 20px"}}>
                          {findingsFbSaving ? "Saving…" : "Submit Feedback"}
                        </button>
                        {findingsFbSaved && <span style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#4ade80"}}>Saved ✓</span>}
                      </div>
                    </div>
                  </>
                )}


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
              {historyIndex.length > 0 && (() => {
                const props = [...new Set(historyIndex.map(r => r.property || "Unknown Property"))].sort();
                if (props.length <= 1) return null;
                return (
                  <div style={{marginTop:12}}>
                    <select value={historyPropertyFilter}
                      onChange={e => setHistoryPropertyFilter(e.target.value)}
                      style={{...s.select, fontSize:11, padding:"5px 10px", minWidth:220}}>
                      <option value="">All Properties</option>
                      {props.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                );
              })()}
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
              // Apply property filter then group by property
              const visible = historyPropertyFilter
                ? historyIndex.filter(r => (r.property || "Unknown Property") === historyPropertyFilter)
                : historyIndex;
              const grouped = {};
              visible.forEach(r => {
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
                      <div key={i} ref={isExpanded ? expandedReviewRef : null} style={{borderBottom:"1px solid #1a1a1a",paddingBottom:12,marginBottom:12}}>
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
                            <div style={{position:"relative"}}>
                              <button className="btn"
                                style={{...s.btnOutline,fontSize:11,padding:"4px 12px",
                                  borderColor: reportPickerBlobUrl === r.blobUrl ? "#e8c468" : "#4b5563",
                                  color:       reportPickerBlobUrl === r.blobUrl ? "#e8c468" : "#d1d5db"}}
                                onClick={() => setReportPickerBlobUrl(reportPickerBlobUrl === r.blobUrl ? null : r.blobUrl)}>
                                Report ▾
                              </button>
                              {reportPickerBlobUrl === r.blobUrl && (
                                <div style={{position:"absolute",right:0,top:"calc(100% + 4px)",
                                  background:"#111",border:"1px solid #2a2a2a",borderRadius:8,
                                  padding:8,zIndex:50,whiteSpace:"nowrap",display:"flex",flexDirection:"column",gap:4,minWidth:180}}>
                                  {Object.entries(AUDIENCE_LABELS).map(([key, label]) => (
                                    <button key={key} className="btn"
                                      onClick={() => generateReport(r, key)}
                                      style={{fontFamily:"'Fira Code',monospace",fontSize:11,padding:"5px 14px",
                                        background:"transparent",border:"1px solid #1e1e1e",borderRadius:6,
                                        color:"#d1d5db",cursor:"pointer",textAlign:"left"}}>
                                      {label}
                                    </button>
                                  ))}
                                  <div style={{borderTop:"1px solid #1e1e1e",margin:"4px 0"}} />
                                  <button className="btn"
                                    onClick={() => { setReportPickerBlobUrl(null); downloadHistoryXlsx(r); }}
                                    style={{fontFamily:"'Fira Code',monospace",fontSize:11,padding:"5px 14px",
                                      background:"transparent",border:"1px solid #1e1e1e",borderRadius:6,
                                      color:"#9ca3af",cursor:"pointer",textAlign:"left"}}>
                                    ↓ Download .xlsx
                                  </button>
                                </div>
                              )}
                            </div>
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

                        {isExpanded && expandedReview.data?.generalFindings?.length > 0 && (
                          <div style={{marginTop:16, marginBottom:4, paddingBottom:12, borderBottom:"1px solid #1a1a1a"}}>
                            <div style={{fontFamily:"'Fira Code',monospace",fontSize:10,color:"#a78bfa",letterSpacing:0.5,marginBottom:8}}>GENERAL FINDINGS</div>
                            {expandedReview.data.generalFindings.map((gf, i) => (
                              <div key={i} style={{marginBottom: i < expandedReview.data.generalFindings.length - 1 ? 10 : 0}}>
                                {gf.isIssue && <div style={{fontFamily:"'Lora',serif",fontSize:12,lineHeight:1.7,color:"#9ca3af",whiteSpace:"pre-line"}}>{gf.isIssue}</div>}
                                {gf.glIssue && <div style={{fontFamily:"'Lora',serif",fontSize:12,lineHeight:1.7,color:"#9ca3af",whiteSpace:"pre-line"}}>{gf.glIssue}</div>}
                                {gf.budgetIssue && <div style={{fontFamily:"'Lora',serif",fontSize:12,lineHeight:1.7,color:"#9ca3af",whiteSpace:"pre-line"}}>{gf.budgetIssue}</div>}
                                {gf.action && <div>
                                  <span style={{fontFamily:"'Fira Code',monospace",fontSize:10,color:"#6ee7a0",letterSpacing:0.5}}>Action · </span>
                                  <span style={{fontFamily:"'Lora',serif",fontSize:12,lineHeight:1.7,color:"#9ca3af"}}>{gf.action}</span>
                                </div>}
                              </div>
                            ))}
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
                                    const isCs  = expandedReview.data.csvs?.is;
                                    const glCs  = expandedReview.data.csvs?.gl;
                                    const budCs = expandedReview.data.csvs?.budget;
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
                                          {budCs && (
                                            <button className="btn"
                                              onClick={() => toggleHistoryDetail(hKey,"bud")}
                                              style={{...s.btnOutline,fontSize:10,padding:"2px 10px",
                                                color: hd.bud ? "#f97316" : "#4b5563",
                                                borderColor: hd.bud ? "#f97316" : "#2a2a2a"}}>
                                              BUD {hd.bud ? "▲" : "▼"}
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

                                        {hd.bud && (() => {
                                          const d = parseIsDetail(budCs, item.accountNumber);
                                          if (!d) return <div style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#4b5563",marginTop:8}}>No budget data for {item.accountNumber}.</div>;
                                          return (
                                            <div style={{marginTop:10,overflowX:"auto",borderRadius:6,border:"1px solid #2a1a0a"}}>
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
                                                    <tr style={{background:"#1a0d00",borderTop:"1px solid #3a2a0a"}}>
                                                      {d.sumRow.map((v,vi) => {
                                                        const num = vi>=2 ? parseFloat(v) : NaN;
                                                        const fmt = !isNaN(num) ? num.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}) : v;
                                                        return <td key={vi} style={tblCell(vi<=1?"left":"right",{color:vi<2?"#f97316":num<0?"#f87171":num===0?"#374151":"#f97316",fontWeight:600})}>{fmt}</td>;
                                                      })}
                                                    </tr>
                                                  )}
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
                                          {val:"correct",        label:"✓ Review Correct: No Actions",      color:"#4ade80"},
                                          {val:"false_positive", label:"✗ Review Error Present",            color:"#f87171"},
                                          {val:"needs_review",   label:"? Review Correct: Actions Required",color:"#e8c468"},
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

        {tab === "reports" && (
          <div className="fade-up" style={s.panel}>
            <div style={s.panelHead}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:16}}>
                <div>
                  <h2 style={s.panelTitle}>
                    {reportMeta
                      ? `${reportMeta.property} — ${AUDIENCE_LABELS[reportAudience] || reportAudience}`
                      : "Reports"}
                  </h2>
                  {reportMeta && (() => {
                    const [yr, mo] = reportMeta.period.split("-");
                    const lbl = new Date(+yr, +mo - 1).toLocaleString("en-US", { month: "long", year: "numeric" });
                    return <p style={s.panelDesc}>{lbl}</p>;
                  })()}
                </div>
                {reportContent && !reportLoading && (
                  <div style={{display:"flex",gap:8,flexShrink:0}}>
                    <button className="btn" style={{...s.btnOutline,fontSize:11,padding:"5px 14px"}}
                      onClick={() => { setReportContent(null); setTab("history"); }}>
                      ← History
                    </button>
                    {Object.entries(AUDIENCE_LABELS).filter(([k]) => k !== reportAudience).map(([key, label]) => (
                      <button key={key} className="btn" style={{...s.btnOutline,fontSize:11,padding:"5px 14px"}}
                        onClick={() => generateReport({ blobUrl: expandedReview?.blobUrl || "", property: reportMeta?.property, period: reportMeta?.period }, key)}>
                        {label}
                      </button>
                    ))}
                    <button className="btn" style={{...s.btnGold,fontSize:11,padding:"5px 14px"}}
                      onClick={async () => {
                        try {
                          const [yr, mo] = (reportMeta?.period || "").split("-");
                          const periodLabel = yr && mo
                            ? new Date(+yr, +mo - 1).toLocaleString("en-US", { month: "long", year: "numeric" })
                            : reportMeta?.period || "";
                          const res = await fetch("/api/export-report", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              reportText: reportContent,
                              audience:   reportAudience,
                              property:   reportMeta?.property || "",
                              period:     periodLabel,
                            }),
                          });
                          if (!res.ok) { alert("Export failed: " + (await res.text())); return; }
                          const blob = await res.blob();
                          const url  = URL.createObjectURL(blob);
                          const a    = document.createElement("a");
                          const safeProp   = (reportMeta?.property || "Report").replace(/[^a-zA-Z0-9 _-]/g, "").trim().replace(/ +/g, "_");
                          const safePeriod = periodLabel.replace(/[^a-zA-Z0-9 _-]/g, "").trim().replace(/ +/g, "_");
                          a.href = url;
                          a.download = `${safeProp}_${safePeriod}_${reportAudience}.docx`;
                          a.click();
                          URL.revokeObjectURL(url);
                        } catch (e) {
                          alert("Export failed: " + e.message);
                        }
                      }}>
                      ↓ Download .docx
                    </button>
                  </div>
                )}
              </div>
            </div>

            {reportLoading && (
              <div style={{textAlign:"center",padding:"60px 0"}}>
                <div style={{fontFamily:"'Fira Code',monospace",fontSize:12,color:"#e8c468",marginBottom:8,letterSpacing:0.5}}>
                  GENERATING REPORT
                </div>
                <div style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#4b5563"}}>
                  Preparing {AUDIENCE_LABELS[reportAudience] || ""} view…
                </div>
              </div>
            )}

            {reportError && !reportLoading && (
              <div style={s.error}>{reportError}</div>
            )}

            {reportContent && !reportLoading && (
              <SimpleMarkdown content={reportContent} />
            )}

            {!reportContent && !reportLoading && !reportError && (
              <div style={s.empty}>
                <div style={{fontSize:28,color:"#2a2a2a",marginBottom:12}}>◈</div>
                <div style={{fontFamily:"'Lora',serif",fontSize:14,fontStyle:"italic",color:"#4b5563",marginBottom:16}}>
                  Generate a report from a saved review in the History tab.
                </div>
                <button className="btn" onClick={() => setTab("history")} style={s.btnGold}>
                  Go to History →
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── 06 · Knowledge Base ─────────────────────────────────────────────── */}
        {tab === "kb" && (
          <div className="fade-up">
            {!kbAuthed ? (
              <div style={{...s.panel, maxWidth:380, margin:"60px auto"}}>
                <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:18,color:"#f5f5f5",marginBottom:6}}>Knowledge Base</div>
                <div style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#4b5563",marginBottom:24}}>Manager access required</div>
                <input type="password" placeholder="Password" value={kbPw}
                  onChange={e => { setKbPw(e.target.value); setKbPwErr(false); }}
                  onKeyDown={e => { if (e.key === "Enter") attemptKbAuth(); }}
                  autoFocus
                  style={{...s.input, marginBottom:8, border:`1px solid ${kbPwErr ? "#f87171" : "#2a2a2a"}`}} />
                {kbPwErr && <div style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#f87171",marginBottom:8}}>Incorrect password</div>}
                <button className="btn" style={{...s.btnGold, width:"100%", marginTop:4}}
                  onClick={attemptKbAuth}>
                  Sign In
                </button>
              </div>
            ) : (
              <>
                {/* Scope selector */}
                <div style={{...s.panel, marginBottom:20}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
                    <div style={{display:"flex",gap:8}}>
                      {["global","property"].map(sc => (
                        <button key={sc} className="btn"
                          onClick={() => { setKbScope(sc); setKbPending(null); setKbError(""); setKbSource(""); setKbCompressed(""); setKbTokenCount(0); if (sc === "global") loadKb("global",""); }}
                          style={{fontFamily:"'Fira Code',monospace",fontSize:11,padding:"5px 14px",
                            background: kbScope === sc ? "#1a1a1a" : "transparent",
                            border:`1px solid ${kbScope === sc ? "#e8c468" : "#2a2a2a"}`,
                            borderRadius:6, color: kbScope === sc ? "#e8c468" : "#4b5563"}}>
                          {sc === "global" ? "Global SOPs" : "Property"}
                        </button>
                      ))}
                    </div>
                    {kbScope === "property" && (
                      <div style={{display:"flex",gap:8,alignItems:"center"}}>
                        <select value={kbPropertyName}
                          onChange={e => { const n = e.target.value; setKbPropertyName(n); setKbPending(null); setKbSource(""); setKbCompressed(""); setKbTokenCount(0); if (n) loadKb("property", n); }}
                          style={{...s.select, width:"auto", minWidth:220}}>
                          <option value="">Select property…</option>
                          {kbPropertyList.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                        {kbPropertyName && (
                          <button className="btn"
                            onClick={() => deletePropertyKb(kbPropertyName)}
                            style={{...s.btnOutline,fontSize:11,padding:"5px 12px",borderColor:"#7f1d1d",color:"#f87171"}}>
                            Delete KB
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {(kbScope === "global" || kbPropertyName) && (
                  <>
                    {/* Committed feedback queue — property only */}
                    {kbScope === "property" && kbPropertyName && (
                    <div style={{...s.panel, marginBottom:20}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
                        <div style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#e8c468",letterSpacing:0.5}}>
                          COMMITTED FEEDBACK QUEUE
                        </div>
                        <button className="btn" style={{...s.btnOutline,fontSize:11,padding:"4px 12px"}}
                          disabled={kbFeedbackLoading} onClick={loadKbFeedbackQueue}>
                          {kbFeedbackLoading ? "Loading…" : "Load Queue"}
                        </button>
                      </div>
                      {kbFeedbackQueue.length === 0
                        ? <div style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#4b5563"}}>
                            Click "Load Queue" to see committed feedback not yet added to the knowledge base.
                          </div>
                        : kbFeedbackQueue.map((item, i) => {
                            const [y,m] = item.period.split("-");
                            const periodLabel = new Date(+y,+m-1).toLocaleString("en-US",{month:"long",year:"numeric"});
                            const fb = item.feedback;
                            const findingNotes = Object.entries(fb?.findings || {}).filter(([,v]) => v?.note?.trim());
                            const accountNotes = (fb?.accountNotes || []).filter(n => n.note?.trim());
                            const general = fb?.general?.trim();
                            return (
                              <div key={i} style={{borderBottom:"1px solid #1a1a1a",paddingBottom:16,marginBottom:16}}>
                                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                                  <div>
                                    <span style={{fontFamily:"'Syne',sans-serif",fontWeight:600,fontSize:13,color:"#f5f5f5"}}>{item.property}</span>
                                    <span style={{fontFamily:"'Fira Code',monospace",fontSize:10,color:"#4b5563",marginLeft:10}}>{periodLabel}</span>
                                  </div>
                                  <button className="btn" style={{...s.btnOutline,fontSize:10,padding:"3px 10px"}}
                                    onClick={() => {
                                      const lines = [];
                                      if (general) lines.push(`General: ${general}`);
                                      findingNotes.forEach(([acct,v]) => lines.push(`Account ${acct}: ${v.note}`));
                                      accountNotes.forEach(n => lines.push(`Account ${n.accountNumber}: ${n.note}`));
                                      setKbChatInput(lines.join("\n"));
                                    }}>
                                    Add to KB →
                                  </button>
                                </div>
                                {general && <div style={{fontFamily:"'Lora',serif",fontSize:12,color:"#9ca3af",marginBottom:4}}>{general}</div>}
                                {findingNotes.map(([acct,v]) => (
                                  <div key={acct} style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#6b7280",marginBottom:2}}>
                                    <span style={{color:"#e8c468"}}>{acct}</span> — {v.note}
                                  </div>
                                ))}
                                {accountNotes.map((n,ni) => (
                                  <div key={ni} style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#6b7280",marginBottom:2}}>
                                    <span style={{color:"#e8c468"}}>{n.accountNumber}</span> — {n.note}
                                  </div>
                                ))}
                              </div>
                            );
                          })
                      }
                    </div>
                    )}

                    {/* Chat input */}
                    <div style={{...s.panel, marginBottom:20}}>
                      <div style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#e8c468",letterSpacing:0.5,marginBottom:12}}>
                        ADD / UPDATE KNOWLEDGE
                      </div>
                      <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                        <textarea
                          placeholder={`Describe what you want to add, update, or remove from the ${kbScope === "global" ? "global" : kbPropertyName} knowledge base…`}
                          value={kbChatInput}
                          onChange={e => setKbChatInput(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendKbChat(); }}
                          style={{...s.textarea, flex:1, minHeight:72, resize:"vertical"}}
                        />
                        <div style={{display:"flex",flexDirection:"column",gap:6,alignSelf:"flex-end"}}>
                          <button className="btn" style={{...s.btnGold, fontSize:12, padding:"10px 18px", whiteSpace:"nowrap"}}
                            disabled={kbChatLoading || !kbChatInput.trim()}
                            onClick={sendKbChat}>
                            {kbChatLoading ? "Thinking…" : "Send →"}
                          </button>
                          <button className="btn" style={{fontSize:11, padding:"8px 14px", whiteSpace:"nowrap", background:"transparent", border:"1px solid #3a3a3a", color:"#9ca3af", borderRadius:6, cursor: kbClarifyLoading || !kbSource.trim() ? "not-allowed" : "pointer", opacity: kbClarifyLoading || !kbSource.trim() ? 0.5 : 1}}
                            disabled={kbClarifyLoading || !kbSource.trim()}
                            onClick={askKbClarify}>
                            {kbClarifyLoading ? "Reviewing…" : "Clarify →"}
                          </button>
                        </div>
                      </div>

                      {/* Clarifying questions */}
                      {kbClarifyQuestions.length > 0 && (
                        <div style={{marginTop:12,padding:"14px 16px",background:"#0d1117",border:"1px solid #2a3a2a",borderRadius:8}}>
                          <div style={{fontFamily:"'Fira Code',monospace",fontSize:10,color:"#6ee7a0",marginBottom:10,letterSpacing:0.5}}>
                            CLARIFYING QUESTIONS — review and answer any that apply
                          </div>
                          <ol style={{margin:0,paddingLeft:18,display:"flex",flexDirection:"column",gap:8}}>
                            {kbClarifyQuestions.map((q,i) => (
                              <li key={i} style={{fontFamily:"'Lora',serif",fontSize:13,color:"#d1d5db",lineHeight:1.6}}>{q}</li>
                            ))}
                          </ol>
                          <button style={{marginTop:10,fontSize:11,background:"none",border:"none",color:"#6b7280",cursor:"pointer",padding:0}} onClick={()=>setKbClarifyQuestions([])}>Dismiss</button>
                        </div>
                      )}
                      {/* Pending change preview */}
                      {kbPending && (
                        <div style={{marginTop:16,padding:"14px 16px",background:"#0e0e0e",border:"1px solid #2a2a2a",borderRadius:8}}>
                          <div style={{fontFamily:"'Fira Code',monospace",fontSize:10,color:"#e8c468",marginBottom:6,letterSpacing:0.5}}>
                            PROPOSED CHANGE — {kbPending.action.toUpperCase()}
                          </div>
                          <div style={{fontFamily:"'Lora',serif",fontSize:13,color:"#d1d5db",lineHeight:1.6,marginBottom:12}}>
                            {kbPending.preview}
                          </div>
                          <div style={{display:"flex",gap:8}}>
                            <button className="btn" style={{...s.btnGold,fontSize:11,padding:"5px 14px"}}
                              disabled={kbSaving} onClick={confirmKbPending}>
                              {kbSaving ? "Saving…" : "Confirm"}
                            </button>
                            <button className="btn" style={{...s.btnOutline,fontSize:11,padding:"5px 14px"}}
                              onClick={() => setKbPending(null)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {kbError && <div style={{...s.error,marginTop:12}}>{kbError}</div>}
                    </div>

                    {/* Source viewer */}
                    <div style={{...s.panel, marginBottom:20}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                        <div style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#e8c468",letterSpacing:0.5}}>
                          FULL SOURCE
                        </div>
                        <button className="btn" style={{...s.btnOutline,fontSize:11,padding:"4px 12px"}}
                          disabled={kbSaving} onClick={() => saveKbSource(kbSource)}>
                          {kbSaving ? "Saving…" : "Save"}
                        </button>
                      </div>
                      {kbLoading
                        ? <div style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#4b5563"}}>Loading…</div>
                        : <textarea value={kbSource} onChange={e => setKbSource(e.target.value)}
                            placeholder="No knowledge base content yet. Use the chat above to add knowledge."
                            style={{...s.textarea, minHeight:280, resize:"vertical", width:"100%"}} />
                      }
                    </div>

                    {/* Compressed preview */}
                    <div style={{...s.panel, marginBottom:20}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                        <div style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#e8c468",letterSpacing:0.5}}>
                          COMPRESSED PREVIEW
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:12}}>
                          <span style={{fontFamily:"'Fira Code',monospace",fontSize:10,
                            color: kbTokenCount > (kbScope === "global" ? 1500 : 500) ? "#f87171" : "#4ade80"}}>
                            {kbCompressing ? "Compressing…" : `~${kbTokenCount} / ${kbScope === "global" ? 1500 : 500} tokens`}
                          </span>
                          <button className="btn" style={{...s.btnOutline,fontSize:11,padding:"4px 12px"}}
                            disabled={kbCompressing || !kbSource.trim()}
                            onClick={() => {
                              setKbCompressing(true);
                              fetch("/api/kb-compress", {
                                method:"POST", headers:{"Content-Type":"application/json"},
                                body: JSON.stringify({ type: kbScope, name: kbPropertyName, source: kbSource }),
                              }).then(r=>r.json()).then(d=>{setKbCompressed(d.compressed||"");setKbTokenCount(d.tokenCount||0);}).finally(()=>setKbCompressing(false));
                            }}>
                            Recompress
                          </button>
                        </div>
                      </div>
                      <textarea readOnly value={kbCompressed}
                        placeholder="Compressed version will appear here after saving."
                        style={{...s.textarea, minHeight:180, resize:"vertical", width:"100%", color:"#6b7280"}} />
                    </div>

                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* ── 08 · Portfolio ─────────────────────────────────────────────── */}
        {tab === "portfolio" && (
          <div className="fade-up" style={s.panel}>
            <div style={s.panelHead}>
              <h2 style={{...s.panelTitle,marginBottom:0}}>Portfolio Overview</h2>
              <p style={s.panelDesc}>Aggregated review data across all properties. Click a property to jump to its history.</p>
            </div>

            {portfolioLoading && (
              <div style={{fontFamily:"'Fira Code',monospace",fontSize:12,color:"#6b7280",padding:"20px 0"}}>Loading portfolio data...</div>
            )}

            {portfolioData && portfolioData.properties.length === 0 && (
              <div style={s.empty}>
                <div style={{fontSize:28,color:"#2a2a2a",marginBottom:12}}>◈</div>
                <div style={{fontFamily:"'Lora',serif",fontSize:14,fontStyle:"italic",color:"#4b5563",marginBottom:16}}>
                  No reviews found. Run reviews on properties to populate the portfolio view.
                </div>
                <button className="btn" onClick={() => setTab("review")} style={s.btnGold}>Run a Review</button>
              </div>
            )}

            {portfolioData && portfolioData.properties.length > 0 && (
              <div style={{display:"flex",flexDirection:"column",gap:2}}>
                {/* Header row */}
                <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr",gap:8,padding:"8px 14px",borderBottom:"1px solid #1e1e1e"}}>
                  <span style={{fontFamily:"'Fira Code',monospace",fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:0.6}}>Property</span>
                  <span style={{fontFamily:"'Fira Code',monospace",fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:0.6,textAlign:"center"}}>Reviews</span>
                  <span style={{fontFamily:"'Fira Code',monospace",fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:0.6,textAlign:"center"}}>Latest Period</span>
                  <span style={{fontFamily:"'Fira Code',monospace",fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:0.6,textAlign:"center"}}>Findings</span>
                  <span style={{fontFamily:"'Fira Code',monospace",fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:0.6,textAlign:"center"}}>Trend</span>
                </div>

                {portfolioData.properties.map(prop => {
                  const severity = prop.latestFindings >= 10 ? "#f87171" : prop.latestFindings >= 5 ? "#fbbf24" : "#4ade80";
                  const trendIcon = prop.trend > 0 ? "▲" : prop.trend < 0 ? "▼" : "—";
                  const trendColor = prop.trend > 0 ? "#f87171" : prop.trend < 0 ? "#4ade80" : "#6b7280";
                  const [y, m] = (prop.latestPeriod || "").split("-");
                  const periodLabel = y && m ? new Date(+y, +m - 1).toLocaleString("en-US", { month: "short", year: "numeric" }) : "—";

                  return (
                    <div key={prop.name}
                      onClick={() => { setHistoryPropertyFilter(prop.name); setTab("history"); if (!historyLoaded && !historyLoading) { setHistoryLoading(true); fetch("/api/history").then(r=>r.json()).then(data=>{if(Array.isArray(data))setHistoryIndex(data);setHistoryLoaded(true);}).catch(()=>setHistoryLoaded(true)).finally(()=>setHistoryLoading(false)); }}}
                      style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr",gap:8,padding:"10px 14px",background:"#0a0a0a",borderRadius:6,border:"1px solid #1e1e1e",cursor:"pointer",transition:"border-color 0.15s"}}
                      onMouseEnter={e => e.currentTarget.style.borderColor = "#333"}
                      onMouseLeave={e => e.currentTarget.style.borderColor = "#1e1e1e"}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <div style={{width:8,height:8,borderRadius:"50%",background:severity,flexShrink:0}} />
                        <span style={{fontFamily:"'Syne',sans-serif",fontWeight:600,fontSize:13,color:"#f5f5f5",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{prop.name}</span>
                      </div>
                      <span style={{fontFamily:"'Fira Code',monospace",fontSize:12,color:"#d1d5db",textAlign:"center"}}>{prop.reviewCount}</span>
                      <span style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#9ca3af",textAlign:"center"}}>{periodLabel}</span>
                      <span style={{fontFamily:"'Fira Code',monospace",fontSize:12,color:severity,textAlign:"center",fontWeight:600}}>{prop.latestFindings}</span>
                      <div style={{textAlign:"center"}}>
                        <span style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:trendColor}}>
                          {trendIcon} {prop.trend !== 0 ? Math.abs(prop.trend) : ""}
                        </span>
                      </div>
                    </div>
                  );
                })}

                {/* Summary row */}
                <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr",gap:8,padding:"10px 14px",marginTop:8,borderTop:"1px solid #1e1e1e"}}>
                  <span style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:12,color:"#e8c468"}}>{portfolioData.properties.length} Properties</span>
                  <span style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#6b7280",textAlign:"center"}}>{portfolioData.properties.reduce((s,p) => s + p.reviewCount, 0)} total</span>
                  <span />
                  <span style={{fontFamily:"'Fira Code',monospace",fontSize:11,color:"#6b7280",textAlign:"center"}}>{Math.round(portfolioData.properties.reduce((s,p) => s + p.avgFindings, 0) / portfolioData.properties.length)} avg</span>
                  <span />
                </div>
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  );
}


export default function App() {
  const [authed, setAuthed] = useState(() => sessionStorage.getItem("ar_auth") === "1");
  if (!authed) return <PasswordGate onAuth={() => setAuthed(true)} />;
  return <AppInner />;
}