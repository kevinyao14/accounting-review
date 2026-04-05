import { put } from "@vercel/blob";
import { kvGet, kvSet, encodePropertyName, slugify } from "../lib/storage.js";

// maxDuration: 60s to handle large GL files with many months (each month is a
// separate Blob write). The default 30s can be tight for 12+ month GL ingestion.
export const config = { maxDuration: 60 };

// ── Namespace: "datastore:" ───────────────────────────────────────────────
// This endpoint manages RAW FINANCIAL DATA (IS time-series, GL transactions,
// budget allocations). These are the source-of-truth numbers uploaded directly
// from property management system exports.
//
// The separate "memory:" namespace (managed by /api/memory-store.js) stores
// PRE-COMPUTED INTELLIGENCE derived from this data — things like IS baselines,
// counter-heuristics, error patterns, and memory briefs. The memory layer is
// populated via scripts/upload-memory.js after running the dream_engine and
// gl_error_miner analysis scripts locally. In the future, a compute step
// could automatically derive memory-layer updates from data-store changes,
// but today they are updated independently.
//
// KV keys used by this endpoint:
//   datastore:{enc}:timeseries    — merged IS account balances by month
//   datastore:{enc}:budget        — merged budget allocations by month
//   datastore:{enc}:budget:index  — fiscal year tracking for budgets
//   datastore:{enc}:gl:index      — GL month index with Blob URLs
//   datastore:{enc}:meta          — property metadata (dates, counts, URLs)
//   datastore:property:index      — global list of all ingested properties

// ── IS Time-Series Extraction ──────────────────────────────────────────────
// Parses a raw T12 income statement CSV and returns:
// { accounts: { "440001": { name, balances: { "2025-04": 12345.67, ... } } }, dateRange: { from, to } }
function extractIsTimeSeries(rawCsv) {
  const lines = rawCsv.split("\n");

  // Find the date header row
  let dateCols = []; // [{ idx, year, month, key: "YYYY-MM" }]
  for (const line of lines) {
    const cols = line.split(",");
    const found = [];
    cols.forEach((c, j) => {
      const t = c.trim();
      if (t.length === 10 && t[2] === "/" && t[5] === "/") {
        const p = t.split("/");
        const month = parseInt(p[0], 10);
        const year  = parseInt(p[2], 10);
        const key   = year + "-" + String(month).padStart(2, "0");
        found.push({ idx: j, year, month, key });
      }
    });
    if (found.length >= 3) { dateCols = found; break; }
  }

  if (!dateCols.length) return null;

  // Extract account rows
  const accounts = {};
  for (const line of lines) {
    const cols = line.split(",");
    const acctNum = (cols[0] ?? "").trim();
    if (!/^\d{6}$/.test(acctNum)) continue;

    const acctName = (cols[1] ?? "").trim();
    const balances = {};
    for (const dc of dateCols) {
      const val = (cols[dc.idx] ?? "").trim().replace(/[",]/g, "");
      const num = parseFloat(val);
      if (!isNaN(num)) balances[dc.key] = num;
    }

    // Only store if we have at least one balance
    if (Object.keys(balances).length > 0) {
      accounts[acctNum] = { name: acctName, balances };
    }
  }

  const keys = dateCols.map(d => d.key).sort();
  return {
    accounts,
    dateRange: { from: keys[0], to: keys[keys.length - 1] },
    totalAccounts: Object.keys(accounts).length,
  };
}

// ── GL Transaction Extraction ──────────────────────────────────────────────
// Parses a raw GL CSV and returns transactions grouped by posted month.
// Output: { months: { "2026-03": { accounts: [...], totalEntries, vendors }, ... } }
function extractGlTransactions(rawCsv) {
  const lines = rawCsv.split("\n");

  // Find header row
  const headerIdx = lines.findIndex(l => /Posted Dt\./i.test(l));
  if (headerIdx < 0) return null;

  const headerCols = lines[headerIdx].split(",").map(c => c.trim());
  const postedIdx  = headerCols.findIndex(c => /Posted Dt\./i.test(c));
  const docIdx     = headerCols.findIndex(c => /^Doc$/i.test(c));
  const descIdx    = headerCols.findIndex(c => /Description/i.test(c));
  const vendorIdx  = headerCols.findIndex(c => /Vendor/i.test(c));
  const jnlIdx     = headerCols.findIndex(c => /^JNL$/i.test(c));
  const debitIdx   = headerCols.length - 3;
  const creditIdx  = headerCols.length - 2;

  // Revenue (4[4-9]xxxx) and expense (5-9xxxxx) account header pattern
  const acctHdrRe = /^(?:4[4-9]\d{3,4}|[5-9]\d{4,5})\s+-/;

  // Parse all entries with their account context
  const allEntries = []; // { account, accountName, month, entry }
  let currentAccount = null;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (acctHdrRe.test(line)) {
      const match = line.match(/^(\d+)\s+-\s+(.+)/);
      if (match) currentAccount = { number: match[1].trim(), name: match[2].trim() };
      continue;
    }

    if (currentAccount) {
      const cols = lines[i].split(",");
      const posted = (cols[postedIdx] ?? "").trim();
      if (!posted || !/\d/.test(posted)) continue;

      const debit  = parseFloat((cols[debitIdx] ?? "").replace(/[",]/g, "")) || 0;
      const credit = parseFloat((cols[creditIdx] ?? "").replace(/[",]/g, "")) || 0;
      if (debit === 0 && credit === 0) continue;

      // Derive month key from posted date (MM/DD/YYYY → YYYY-MM)
      const dateParts = posted.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      const monthKey = dateParts
        ? dateParts[3] + "-" + dateParts[1].padStart(2, "0")
        : null;
      if (!monthKey) continue;

      allEntries.push({
        account: currentAccount.number,
        accountName: currentAccount.name,
        monthKey,
        entry: {
          date: posted,
          doc: docIdx >= 0 ? (cols[docIdx] ?? "").trim() : "",
          description: descIdx >= 0 ? (cols[descIdx] ?? "").trim() : "",
          vendor: vendorIdx >= 0 ? (cols[vendorIdx] ?? "").trim() : "",
          jnl: jnlIdx >= 0 ? (cols[jnlIdx] ?? "").trim() : "",
          debit,
          credit,
        },
      });
    }
  }

  if (!allEntries.length) return null;

  // Group by month, then by account within each month
  const months = {};
  for (const { account, accountName, monthKey, entry } of allEntries) {
    if (!months[monthKey]) months[monthKey] = {};
    if (!months[monthKey][account]) months[monthKey][account] = { name: accountName, entries: [] };
    months[monthKey][account].entries.push(entry);
  }

  // Filter out partial months — only keep months where the earliest entry is the 1st
  for (const monthKey of Object.keys(months)) {
    const allDays = Object.values(months[monthKey])
      .flatMap(a => a.entries.map(e => {
        const m = e.date.match(/^\d{1,2}\/(\d{1,2})\//);
        return m ? parseInt(m[1], 10) : 99;
      }));
    const earliestDay = Math.min(...allDays);
    if (earliestDay > 1) delete months[monthKey];
  }

  // Shape each month's data into the storage format
  const result = {};
  for (const [monthKey, acctMap] of Object.entries(months)) {
    const accounts = Object.entries(acctMap).map(([number, data]) => ({
      number,
      name: data.name,
      entryCount: data.entries.length,
      entries: data.entries,
    }));
    const vendors = [...new Set(accounts.flatMap(a => a.entries.map(e => e.vendor)).filter(Boolean))];
    result[monthKey] = {
      accounts,
      totalEntries: accounts.reduce((s, a) => s + a.entries.length, 0),
      totalAccounts: accounts.length,
      vendors,
    };
  }

  return { months: result, monthKeys: Object.keys(result).sort() };
}

// ── Budget Extraction ─────────────────────────────────────────────────────
// Parses a raw budget CSV and returns monthly budget allocations by account.
// Output: { accounts: { "440001": { name, budgets: { "2025-04": 12345.67, ... } } }, dateRange, fiscalYear }
function extractBudgetData(rawCsv) {
  const lines = rawCsv.split("\n");

  // Find the date/month header row (same format as IS: MM/DD/YYYY columns)
  let dateCols = [];
  for (const line of lines) {
    const cols = line.split(",");
    const found = [];
    cols.forEach((c, j) => {
      const t = c.trim();
      // Match MM/DD/YYYY format
      if (t.length === 10 && t[2] === "/" && t[5] === "/") {
        const p = t.split("/");
        const month = parseInt(p[0], 10);
        const year  = parseInt(p[2], 10);
        const key   = year + "-" + String(month).padStart(2, "0");
        found.push({ idx: j, year, month, key });
      }
      // Also match "Jan-25", "Feb-26" style headers
      const monthNames = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
      const abbr = t.toLowerCase().match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[- ](\d{2,4})$/);
      if (abbr) {
        const month = monthNames[abbr[1]];
        const year  = abbr[2].length === 2 ? 2000 + parseInt(abbr[2]) : parseInt(abbr[2]);
        const key   = year + "-" + String(month).padStart(2, "0");
        found.push({ idx: j, year, month, key });
      }
    });
    if (found.length >= 3) { dateCols = found; break; }
  }

  if (!dateCols.length) return null;

  // Extract account rows
  const accounts = {};
  for (const line of lines) {
    const cols = line.split(",");
    const acctNum = (cols[0] ?? "").trim();
    if (!/^\d{6}$/.test(acctNum)) continue;

    const acctName = (cols[1] ?? "").trim();
    const budgets = {};
    for (const dc of dateCols) {
      const val = (cols[dc.idx] ?? "").trim().replace(/[",]/g, "");
      const num = parseFloat(val);
      if (!isNaN(num)) budgets[dc.key] = num;
    }

    if (Object.keys(budgets).length > 0) {
      accounts[acctNum] = { name: acctName, budgets };
    }
  }

  const keys = dateCols.map(d => d.key).sort();
  const years = [...new Set(dateCols.map(d => d.year))];

  return {
    accounts,
    dateRange: { from: keys[0], to: keys[keys.length - 1] },
    totalAccounts: Object.keys(accounts).length,
    fiscalYear: years.length === 1 ? years[0] : `${Math.min(...years)}-${Math.max(...years)}`,
  };
}

// ── Merge budget data: existing + new → combined (new months overwrite) ───
function mergeBudgetData(existing, incoming) {
  if (!existing) return incoming;
  if (!incoming) return existing;

  const merged = { ...existing, accounts: { ...existing.accounts } };

  for (const [acctNum, acctData] of Object.entries(incoming.accounts)) {
    if (!merged.accounts[acctNum]) {
      merged.accounts[acctNum] = acctData;
    } else {
      merged.accounts[acctNum] = {
        name: acctData.name || merged.accounts[acctNum].name,
        budgets: { ...merged.accounts[acctNum].budgets, ...acctData.budgets },
      };
    }
  }

  const allKeys = Object.values(merged.accounts).flatMap(a => Object.keys(a.budgets)).sort();
  if (allKeys.length) {
    merged.dateRange = { from: allKeys[0], to: allKeys[allKeys.length - 1] };
  }
  merged.totalAccounts = Object.keys(merged.accounts).length;

  return merged;
}

// ── Merge IS time series: existing + new → combined ────────────────────────
function mergeTimeSeries(existing, incoming) {
  if (!existing) return incoming;
  if (!incoming) return existing;

  const merged = { ...existing, accounts: { ...existing.accounts } };

  for (const [acctNum, acctData] of Object.entries(incoming.accounts)) {
    if (!merged.accounts[acctNum]) {
      merged.accounts[acctNum] = acctData;
    } else {
      // Merge balances — incoming overwrites existing for same period (fresher data)
      merged.accounts[acctNum] = {
        name: acctData.name || merged.accounts[acctNum].name,
        balances: { ...merged.accounts[acctNum].balances, ...acctData.balances },
      };
    }
  }

  // Update date range
  const allKeys = Object.values(merged.accounts).flatMap(a => Object.keys(a.balances)).sort();
  if (allKeys.length) {
    merged.dateRange = { from: allKeys[0], to: allKeys[allKeys.length - 1] };
  }
  merged.totalAccounts = Object.keys(merged.accounts).length;

  return merged;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // ── GET /api/data-store?property={name} — retrieve property data index ──
    if (req.method === "GET") {
      const { property, type } = req.query;

      if (type === "property-list") {
        const raw = await kvGet("datastore:property:index");
        return res.status(200).json(raw ? JSON.parse(raw) : []);
      }

      if (!property) return res.status(400).json({ error: "property required" });
      const enc = encodePropertyName(property);

      if (type === "timeseries") {
        const raw = await kvGet(`datastore:${enc}:timeseries`);
        return res.status(200).json(raw ? JSON.parse(raw) : null);
      }

      if (type === "gl-periods") {
        const raw = await kvGet(`datastore:${enc}:gl:index`);
        return res.status(200).json(raw ? JSON.parse(raw) : []);
      }

      if (type === "budget") {
        const raw = await kvGet(`datastore:${enc}:budget`);
        return res.status(200).json(raw ? JSON.parse(raw) : null);
      }

      if (type === "budget-periods") {
        const raw = await kvGet(`datastore:${enc}:budget:index`);
        return res.status(200).json(raw ? JSON.parse(raw) : []);
      }

      // Default: return property metadata
      const raw = await kvGet(`datastore:${enc}:meta`);
      return res.status(200).json(raw ? JSON.parse(raw) : null);
    }

    // ── POST /api/data-store — ingest raw IS or GL data ──
    if (req.method === "POST") {
      const { property, period, action, rawIs, rawGl } = req.body;
      if (!property || !period) return res.status(400).json({ error: "property and period required" });

      const enc  = encodePropertyName(property);
      const slug = slugify(property);

      // ── Ingest IS ──
      if (action === "ingest-is" && rawIs) {
        // 1. Extract time series from raw IS
        const extracted = extractIsTimeSeries(rawIs);
        if (!extracted) return res.status(400).json({ error: "Could not extract time series from IS" });

        // 2. Load existing time series and merge
        const existingRaw = await kvGet(`datastore:${enc}:timeseries`);
        const existing = existingRaw ? JSON.parse(existingRaw) : null;
        const merged = mergeTimeSeries(existing, extracted);

        // 3. Store merged time series in KV (it's structured/compact)
        await kvSet(`datastore:${enc}:timeseries`, JSON.stringify(merged));

        // 4. Store raw IS in Blob as backup (latest only, overwrites)
        const isBlobPath = `data/${slug}/raw-is-latest.csv`;
        const isBlob = await put(isBlobPath, rawIs, {
          access: "private",
          contentType: "text/csv",
          addRandomSuffix: false,
          allowOverwrite: true,
        });

        // 5. Update property metadata
        const metaRaw = await kvGet(`datastore:${enc}:meta`);
        const meta = metaRaw ? JSON.parse(metaRaw) : {
          propertyName: property,
          firstSeen: new Date().toISOString(),
          periods: {},
        };
        meta.lastUpdated = new Date().toISOString();
        meta.latestRawIs = isBlob.url;
        if (!meta.periods[period]) meta.periods[period] = {};
        meta.periods[period].isIngestedAt = new Date().toISOString();
        meta.periods[period].isDateRange = extracted.dateRange;
        meta.periods[period].isAccountCount = extracted.totalAccounts;
        await kvSet(`datastore:${enc}:meta`, JSON.stringify(meta));

        // 6. Update global property index
        const idxRaw = await kvGet("datastore:property:index");
        const idx = idxRaw ? JSON.parse(idxRaw) : [];
        if (!idx.includes(property)) {
          idx.push(property);
          idx.sort();
          await kvSet("datastore:property:index", JSON.stringify(idx));
        }

        return res.status(200).json({
          ok: true,
          periodsExtracted: Object.keys(extracted.accounts[Object.keys(extracted.accounts)[0]]?.balances || {}),
          totalAccounts: extracted.totalAccounts,
          timeSeriesRange: merged.dateRange,
        });
      }

      // ── Ingest GL ──
      if (action === "ingest-gl" && rawGl) {
        // 1. Extract GL transactions grouped by posted month
        const extracted = extractGlTransactions(rawGl);
        if (!extracted) return res.status(400).json({ error: "Could not extract transactions from GL" });

        // 2. Store each month's transactions as its own Blob (overwrites if month already exists)
        const glIdxRaw = await kvGet(`datastore:${enc}:gl:index`);
        const glIdx = glIdxRaw ? JSON.parse(glIdxRaw) : [];

        for (const monthKey of extracted.monthKeys) {
          const monthData = extracted.months[monthKey];
          const glBlobPath = `data/${slug}/gl-${monthKey}.json`;
          const glBlob = await put(glBlobPath, JSON.stringify(monthData), {
            access: "private",
            contentType: "application/json",
            addRandomSuffix: false,
            allowOverwrite: true,
          });

          // Update or insert in GL month index
          const existing = glIdx.find(e => e.month === monthKey);
          if (existing) {
            existing.blobUrl = glBlob.url;
            existing.ingestedAt = new Date().toISOString();
            existing.totalEntries = monthData.totalEntries;
            existing.totalAccounts = monthData.totalAccounts;
            existing.vendorCount = monthData.vendors.length;
          } else {
            glIdx.push({
              month: monthKey,
              blobUrl: glBlob.url,
              ingestedAt: new Date().toISOString(),
              totalEntries: monthData.totalEntries,
              totalAccounts: monthData.totalAccounts,
              vendorCount: monthData.vendors.length,
            });
          }
        }

        glIdx.sort((a, b) => a.month.localeCompare(b.month));
        await kvSet(`datastore:${enc}:gl:index`, JSON.stringify(glIdx));

        // 3. Store raw GL in Blob as backup (latest only)
        const rawGlBlobPath = `data/${slug}/raw-gl-latest.csv`;
        const rawGlBlob = await put(rawGlBlobPath, rawGl, {
          access: "private",
          contentType: "text/csv",
          addRandomSuffix: false,
          allowOverwrite: true,
        });

        // 4. Update property metadata
        const metaRaw = await kvGet(`datastore:${enc}:meta`);
        const meta = metaRaw ? JSON.parse(metaRaw) : {
          propertyName: property,
          firstSeen: new Date().toISOString(),
          periods: {},
        };
        meta.lastUpdated = new Date().toISOString();
        meta.latestRawGl = rawGlBlob.url;
        meta.glMonths = extracted.monthKeys;
        if (!meta.periods[period]) meta.periods[period] = {};
        meta.periods[period].glIngestedAt = new Date().toISOString();
        meta.periods[period].glMonthsCovered = extracted.monthKeys;
        meta.periods[period].glTotalEntries = Object.values(extracted.months).reduce((s, m) => s + m.totalEntries, 0);
        await kvSet(`datastore:${enc}:meta`, JSON.stringify(meta));

        // 5. Update global property index
        const idxRaw = await kvGet("datastore:property:index");
        const idx = idxRaw ? JSON.parse(idxRaw) : [];
        if (!idx.includes(property)) {
          idx.push(property);
          idx.sort();
          await kvSet("datastore:property:index", JSON.stringify(idx));
        }

        // 6. Build response summary
        const totalEntries = Object.values(extracted.months).reduce((s, m) => s + m.totalEntries, 0);

        return res.status(200).json({
          ok: true,
          monthsStored: extracted.monthKeys,
          totalEntries,
          glMonthsInIndex: glIdx.length,
        });
      }

      // ── Ingest Budget ──
      if (action === "ingest-budget" && req.body.rawBudget) {
        const rawBudget = req.body.rawBudget;

        // 1. Extract budget data from raw CSV
        const extracted = extractBudgetData(rawBudget);
        if (!extracted) return res.status(400).json({ error: "Could not extract budget data from CSV" });

        // 2. Load existing budget data and merge (new months overwrite)
        const existingRaw = await kvGet(`datastore:${enc}:budget`);
        const existing = existingRaw ? JSON.parse(existingRaw) : null;
        const merged = mergeBudgetData(existing, extracted);

        // 3. Store merged budget in KV (structured/compact like IS timeseries)
        await kvSet(`datastore:${enc}:budget`, JSON.stringify(merged));

        // 4. Store raw budget in Blob as backup
        const budgetBlobPath = `data/${slug}/raw-budget-latest.csv`;
        const budgetBlob = await put(budgetBlobPath, rawBudget, {
          access: "private",
          contentType: "text/csv",
          addRandomSuffix: false,
          allowOverwrite: true,
        });

        // 5. Update budget period index (track which fiscal years we have)
        const budgetIdxRaw = await kvGet(`datastore:${enc}:budget:index`);
        const budgetIdx = budgetIdxRaw ? JSON.parse(budgetIdxRaw) : [];
        const fy = extracted.fiscalYear ? String(extracted.fiscalYear) : period;
        if (!budgetIdx.find(e => e.fiscalYear === fy)) {
          budgetIdx.push({
            fiscalYear: fy,
            ingestedAt: new Date().toISOString(),
            dateRange: extracted.dateRange,
            totalAccounts: extracted.totalAccounts,
          });
          budgetIdx.sort((a, b) => a.fiscalYear.localeCompare(b.fiscalYear));
          await kvSet(`datastore:${enc}:budget:index`, JSON.stringify(budgetIdx));
        } else {
          // Update existing entry
          const entry = budgetIdx.find(e => e.fiscalYear === fy);
          entry.ingestedAt = new Date().toISOString();
          entry.dateRange = extracted.dateRange;
          entry.totalAccounts = extracted.totalAccounts;
          await kvSet(`datastore:${enc}:budget:index`, JSON.stringify(budgetIdx));
        }

        // 6. Update property metadata
        const metaRaw = await kvGet(`datastore:${enc}:meta`);
        const meta = metaRaw ? JSON.parse(metaRaw) : {
          propertyName: property,
          firstSeen: new Date().toISOString(),
          periods: {},
        };
        meta.lastUpdated = new Date().toISOString();
        meta.latestRawBudget = budgetBlob.url;
        if (!meta.periods[period]) meta.periods[period] = {};
        meta.periods[period].budgetIngestedAt = new Date().toISOString();
        meta.periods[period].budgetDateRange = extracted.dateRange;
        meta.periods[period].budgetAccountCount = extracted.totalAccounts;
        meta.periods[period].budgetFiscalYear = fy;
        await kvSet(`datastore:${enc}:meta`, JSON.stringify(meta));

        // 7. Update global property index
        const idxRaw = await kvGet("datastore:property:index");
        const idx = idxRaw ? JSON.parse(idxRaw) : [];
        if (!idx.includes(property)) {
          idx.push(property);
          idx.sort();
          await kvSet("datastore:property:index", JSON.stringify(idx));
        }

        return res.status(200).json({
          ok: true,
          fiscalYear: fy,
          periodsExtracted: Object.keys(extracted.dateRange),
          totalAccounts: extracted.totalAccounts,
          budgetRange: merged.dateRange,
        });
      }

      return res.status(400).json({ error: "Invalid action. Use ingest-is, ingest-gl, or ingest-budget." });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("Data store API error:", e);
    return res.status(500).json({ error: e.message });
  }
}
