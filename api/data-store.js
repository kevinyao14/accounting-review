import { put } from "@vercel/blob";

export const config = { maxDuration: 30 };

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kvGet(key) {
  const res = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(["GET", key]),
  });
  const { result } = await res.json();
  return result;
}

async function kvSet(key, value) {
  await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(["SET", key, value]),
  });
}

function encodePropertyName(name) {
  return encodeURIComponent(name).replace(/%20/g, "_");
}

function slugify(name) {
  return (name || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
}

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
// Parses a raw GL CSV and returns structured transactions per account section
function extractGlTransactions(rawCsv) {
  const lines = rawCsv.split("\n");

  // Find header row
  const headerIdx = lines.findIndex(l => /Posted Dt\./i.test(l));
  if (headerIdx < 0) return null;

  const headerCols = lines[headerIdx].split(",").map(c => c.trim());
  const postedIdx  = headerCols.findIndex(c => /Posted Dt\./i.test(c));
  const descIdx    = headerCols.findIndex(c => /Description/i.test(c));
  const vendorIdx  = headerCols.findIndex(c => /Vendor/i.test(c));
  const debitIdx   = headerCols.length - 3;
  const creditIdx  = headerCols.length - 2;
  const balanceIdx = headerCols.length - 1;

  // Revenue (4[4-9]xxxx) and expense (5-9xxxxx) account header pattern
  const acctHdrRe = /^(?:4[4-9]\d{3,4}|[5-9]\d{4,5})\s+-/;

  const accounts = [];
  let currentAccount = null;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Check for account section header
    if (acctHdrRe.test(line)) {
      const match = line.match(/^(\d+)\s+-\s+(.+)/);
      if (match) {
        currentAccount = { number: match[1].trim(), name: match[2].trim(), entries: [] };
        accounts.push(currentAccount);
      }
      continue;
    }

    // Parse transaction row under current account
    if (currentAccount) {
      const cols = lines[i].split(",");
      const posted = (cols[postedIdx] ?? "").trim();
      // Skip non-data rows (subtotals, blanks, etc.)
      if (!posted || !/\d/.test(posted)) continue;

      const entry = {
        date: posted,
        description: descIdx >= 0 ? (cols[descIdx] ?? "").trim() : "",
        vendor: vendorIdx >= 0 ? (cols[vendorIdx] ?? "").trim() : "",
        debit: parseFloat((cols[debitIdx] ?? "").replace(/[",]/g, "")) || 0,
        credit: parseFloat((cols[creditIdx] ?? "").replace(/[",]/g, "")) || 0,
      };

      // Only store entries with actual values
      if (entry.debit !== 0 || entry.credit !== 0) {
        currentAccount.entries.push(entry);
      }
    }
  }

  // Filter to accounts with entries, compute stats
  const withEntries = accounts.filter(a => a.entries.length > 0);
  const allDates = withEntries.flatMap(a => a.entries.map(e => e.date)).filter(Boolean);
  const vendors = [...new Set(withEntries.flatMap(a => a.entries.map(e => e.vendor)).filter(Boolean))];

  return {
    accounts: withEntries.map(a => ({
      number: a.number,
      name: a.name,
      entryCount: a.entries.length,
      entries: a.entries,
    })),
    totalEntries: withEntries.reduce((sum, a) => sum + a.entries.length, 0),
    totalAccounts: withEntries.length,
    vendors,
    dateRange: allDates.length > 0
      ? { from: allDates.sort()[0], to: allDates.sort()[allDates.length - 1] }
      : null,
  };
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
        // 1. Extract GL transactions
        const extracted = extractGlTransactions(rawGl);
        if (!extracted) return res.status(400).json({ error: "Could not extract transactions from GL" });

        // 2. Store GL extract in Blob (per period, since GL entries are transactional)
        const glBlobPath = `data/${slug}/gl-${period}.json`;
        const glBlob = await put(glBlobPath, JSON.stringify(extracted), {
          access: "private",
          contentType: "application/json",
          addRandomSuffix: false,
        });

        // 3. Store raw GL in Blob as backup (latest only)
        const rawGlBlobPath = `data/${slug}/raw-gl-latest.csv`;
        const rawGlBlob = await put(rawGlBlobPath, rawGl, {
          access: "private",
          contentType: "text/csv",
          addRandomSuffix: false,
        });

        // 4. Update GL period index in KV
        const glIdxRaw = await kvGet(`datastore:${enc}:gl:index`);
        const glIdx = glIdxRaw ? JSON.parse(glIdxRaw) : [];
        const existing = glIdx.find(e => e.period === period);
        if (existing) {
          existing.blobUrl = glBlob.url;
          existing.ingestedAt = new Date().toISOString();
          existing.totalEntries = extracted.totalEntries;
          existing.totalAccounts = extracted.totalAccounts;
          existing.vendorCount = extracted.vendors.length;
        } else {
          glIdx.push({
            period,
            blobUrl: glBlob.url,
            ingestedAt: new Date().toISOString(),
            totalEntries: extracted.totalEntries,
            totalAccounts: extracted.totalAccounts,
            vendorCount: extracted.vendors.length,
          });
          glIdx.sort((a, b) => a.period.localeCompare(b.period));
        }
        await kvSet(`datastore:${enc}:gl:index`, JSON.stringify(glIdx));

        // 5. Update property metadata
        const metaRaw = await kvGet(`datastore:${enc}:meta`);
        const meta = metaRaw ? JSON.parse(metaRaw) : {
          propertyName: property,
          firstSeen: new Date().toISOString(),
          periods: {},
        };
        meta.lastUpdated = new Date().toISOString();
        meta.latestRawGl = rawGlBlob.url;
        if (!meta.periods[period]) meta.periods[period] = {};
        meta.periods[period].glIngestedAt = new Date().toISOString();
        meta.periods[period].glEntryCount = extracted.totalEntries;
        meta.periods[period].glAccountCount = extracted.totalAccounts;
        meta.periods[period].glVendorCount = extracted.vendors.length;
        meta.periods[period].glDateRange = extracted.dateRange;
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
          totalEntries: extracted.totalEntries,
          totalAccounts: extracted.totalAccounts,
          vendorCount: extracted.vendors.length,
          dateRange: extracted.dateRange,
        });
      }

      return res.status(400).json({ error: "Invalid action. Use ingest-is or ingest-gl." });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("Data store API error:", e);
    return res.status(500).json({ error: e.message });
  }
}
